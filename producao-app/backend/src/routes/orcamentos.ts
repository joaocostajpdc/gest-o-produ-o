import express, { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { requireFeature } from "../config/featureReleases";
import { asyncHandler } from "../utils/asyncHandler";

// ============================================================================
// Orçamentos de chapas quinadas e painéis (pedido do utilizador de
// 2026-10-20). O ecrã (frontend/public/orcamentos-app) faz todos os cálculos
// — custo das chapas, plano de corte, acabamentos, mão de obra, margem — e
// guarda aqui o orçamento inteiro; os desenhos do cliente e o logótipo são
// guardados como ficheiros. Acesso restrito: só os administradores e os
// utilizadores autorizados (João Costa e David Costa) — ver
// config/featureReleases.ts.
// ============================================================================

export const orcamentosRouter = Router();
orcamentosRouter.use(requireAuth);
orcamentosRouter.use(requireFeature("orcamentos"));

const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,120}$/;
const CONFIG_KEYS = ["precos", "empresa"] as const;
const bigJson = express.json({ limit: "2mb" });

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function present(row: { id: string; data: Prisma.JsonValue }) {
  return { ...(row.data as Record<string, unknown>), id: row.id };
}

// Tudo o que o ecrã precisa ao abrir: tabelas de preços, empresa e orçamentos.
orcamentosRouter.get(
  "/bootstrap",
  asyncHandler(async (_req, res) => {
    const [settings, rows] = await Promise.all([
      prisma.appSetting.findMany({ where: { key: { in: CONFIG_KEYS.map((k) => `orcamentos.${k}`) } } }),
      prisma.orcamento.findMany(),
    ]);
    const cfg = (k: string) => settings.find((s) => s.key === `orcamentos.${k}`)?.value ?? null;
    res.json({ precos: cfg("precos"), empresa: cfg("empresa"), orcamentos: rows.map(present) });
  })
);

orcamentosRouter.get(
  "/lista",
  asyncHandler(async (_req, res) => {
    const rows = await prisma.orcamento.findMany();
    res.json(rows.map(present));
  })
);

orcamentosRouter.put(
  "/config/:key",
  bigJson,
  asyncHandler(async (req, res) => {
    const key = req.params.key;
    if (!(CONFIG_KEYS as readonly string[]).includes(key) || !isObject(req.body)) {
      return res.status(400).json({ error: "Dados inválidos." });
    }
    const value = req.body as Prisma.InputJsonValue;
    await prisma.appSetting.upsert({
      where: { key: `orcamentos.${key}` },
      create: { key: `orcamentos.${key}`, value, updatedById: req.user!.id },
      update: { value, updatedById: req.user!.id },
    });
    res.json({ ok: true });
  })
);

// Desenhos do cliente e logótipo (JPG/PNG, já reduzidos no ecrã).
const IMAGE_TYPES = ["image/jpeg", "image/png"];
orcamentosRouter.post(
  "/files",
  express.raw({ type: IMAGE_TYPES, limit: "15mb" }),
  asyncHandler(async (req, res) => {
    const mime = String(req.headers["content-type"] ?? "").split(";")[0].trim();
    if (!IMAGE_TYPES.includes(mime) || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "Envie uma imagem JPG ou PNG." });
    }
    const file = await prisma.orcamentoFile.create({ data: { mime, bytes: req.body } });
    res.json({ id: file.id });
  })
);

orcamentosRouter.get(
  "/files/:id",
  asyncHandler(async (req, res) => {
    const file = await prisma.orcamentoFile.findUnique({ where: { id: req.params.id } });
    if (!file) return res.status(404).json({ error: "Ficheiro não encontrado." });
    res.set("Content-Type", file.mime).set("Cache-Control", "private, max-age=31536000, immutable").send(Buffer.from(file.bytes));
  })
);

// ---------------------------------------------------------------------------
// Ler medidas do desenho do cliente (pedido do utilizador de 2026-10-20:
// "quero exportar o desenho e que ele calcule tudo"). As imagens do desenho
// são enviadas ao modelo de visão da Anthropic (Claude), que devolve as
// peças em JSON: abas, ângulos, comprimento e quantidade. O ecrã preenche as
// linhas e faz os cálculos; o utilizador confirma antes de enviar.
// Precisa da variável de ambiente ANTHROPIC_API_KEY (chave da API).
// ---------------------------------------------------------------------------
const AI_PROMPT = `És um técnico de serralharia de alumínio a ler o desenho (esboço à mão, fotografia ou desenho técnico) que um cliente enviou para orçamentar CHAPAS QUINADAS (chapa de alumínio dobrada numa quinadora).

Para cada peça diferente no desenho, identifica:
- "abas": as medidas de cada aba (troço reto) do perfil, em milímetros, pela ordem em que aparecem de uma ponta à outra do perfil. Ex.: um "U" de 20+120+20 é [20,120,20].
- "angulos": o ângulo entre cada par de abas seguidas (tem sempre abas-1 valores). 90 para uma dobra em esquadria. Usa um valor NEGATIVO quando a dobra vira para o lado contrário da dobra anterior (perfil em Z ou degrau). Se o desenho não indica ângulos, assume 90 e mantém o sentido que o desenho mostra.
- "comprimento": o comprimento da peça (ao longo da dobra), em mm. Se o desenho dá em metros ou cm, converte para mm. Se não houver, usa 0.
- "quantidade": número de peças iguais (se não houver, 1).
- "cortaCantos": número de corta-cantos/entalhes por peça, se indicado (senão 0).
- "descricao": nome curto da peça se o desenho o indicar (ex.: "Rufo", "Capeamento", "Pingadeira"); senão uma descrição curta pela forma.

Indica também, se aparecerem no desenho: "espessura" da chapa em mm, "acabamento" (cor/RAL/lacado/bruto), "cliente", "obra", "observacoes".
Em "duvidas", lista em português curto o que não conseguiste ler com certeza (medidas ilegíveis, valores assumidos).

Responde APENAS com um objeto JSON, sem texto à volta, neste formato:
{"pecas":[{"descricao":"","abas":[0],"angulos":[],"comprimento":0,"quantidade":1,"cortaCantos":0}],"espessura":null,"acabamento":null,"cliente":null,"obra":null,"observacoes":null,"duvidas":[]}`;

const lerSchemaLimit = express.json({ limit: "12mb" });
orcamentosRouter.post(
  "/ler-desenho",
  lerSchemaLimit,
  asyncHandler(async (req, res) => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return res.status(503).json({ error: "A leitura automática de desenhos ainda não está ativa (falta configurar a chave ANTHROPIC_API_KEY no servidor)" });
    }
    const body = isObject(req.body) ? req.body : {};
    const ids = Array.isArray(body.fileIds) ? body.fileIds.filter((x): x is string => typeof x === "string").slice(0, 6) : [];
    const inline = Array.isArray(body.imagens) ? body.imagens.filter((x): x is string => typeof x === "string").slice(0, 6) : [];
    const images: { mime: string; data: string }[] = [];
    if (ids.length) {
      const files = await prisma.orcamentoFile.findMany({ where: { id: { in: ids } } });
      for (const id of ids) {
        const f = files.find((x) => x.id === id);
        if (f) images.push({ mime: f.mime, data: Buffer.from(f.bytes).toString("base64") });
      }
    }
    for (const d of inline) {
      const m = /^data:(image\/(?:jpeg|png));base64,(.+)$/.exec(d);
      if (m) images.push({ mime: m[1], data: m[2] });
    }
    if (!images.length) return res.status(400).json({ error: "Não há imagens do desenho para ler." });

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: 4000,
        messages: [
          {
            role: "user",
            content: [
              ...images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.mime, data: im.data } })),
              { type: "text", text: AI_PROMPT },
            ],
          },
        ],
      }),
    });
    const out = (await r.json().catch(() => null)) as { content?: { type: string; text?: string }[]; error?: { message?: string } } | null;
    if (!r.ok || !out) {
      // eslint-disable-next-line no-console
      console.error("ler-desenho: erro da API", r.status, out?.error?.message);
      return res.status(502).json({ error: "O serviço de leitura de desenhos respondeu com erro (" + r.status + ")" });
    }
    const text = (out.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    const start = text.indexOf("{"), end = text.lastIndexOf("}");
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      res.json(parsed);
    } catch {
      return res.status(502).json({ error: "Não foi possível interpretar a resposta da leitura do desenho" });
    }
  })
);

orcamentosRouter.put(
  "/:id",
  bigJson,
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!ID_RE.test(id) || !isObject(req.body)) return res.status(400).json({ error: "Dados inválidos." });
    const { id: _ignored, ...rest } = req.body as Record<string, unknown>;
    const data = rest as Prisma.InputJsonValue;
    await prisma.orcamento.upsert({ where: { id }, create: { id, data }, update: { data } });
    res.json({ ok: true });
  })
);

// Altera só alguns campos (ex.: o estado, a partir da lista).
orcamentosRouter.patch(
  "/:id",
  bigJson,
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!ID_RE.test(id) || !isObject(req.body)) return res.status(400).json({ error: "Dados inválidos." });
    const row = await prisma.orcamento.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: "Orçamento não encontrado." });
    const { id: _ignored, ...rest } = req.body as Record<string, unknown>;
    const data = { ...(row.data as Record<string, unknown>), ...rest } as Prisma.InputJsonValue;
    await prisma.orcamento.update({ where: { id }, data: { data } });
    res.json({ ok: true });
  })
);

orcamentosRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.orcamento.deleteMany({ where: { id: req.params.id } });
    res.json({ ok: true });
  })
);
