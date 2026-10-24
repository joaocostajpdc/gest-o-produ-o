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
// ---------------------------------------------------------------------------
// Preços bloqueados (pedido do utilizador de 2026-10-24: "podes lançar mas
// bloqueia os preços para todos, só o admin pode mudar; os outros podem é
// pedir autorização caso a caso"). Quem não é administrador pode criar e
// editar orçamentos, mas não muda as tabelas de preços, a margem, o desconto
// nem a margem de cada painel: o servidor repõe sempre os valores guardados
// (ou os por defeito, num orçamento novo). Pode pedir autorização (margem e/ou
// desconto) e o administrador aprova ou recusa; ao aprovar, os valores pedidos
// passam para o orçamento. O pedido em si só muda pelas rotas próprias.
// ---------------------------------------------------------------------------
const isAdmin = (req: { user?: { role: string } }) => req.user?.role === "ADMINISTRADOR";

async function defaultMargem(): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { key: "orcamentos.precos" } });
  const P = (row?.value as { P?: { margem?: unknown } } | null)?.P;
  const n = Number(P?.margem);
  return Number.isFinite(n) ? n : 0.25;
}

/** Repõe os campos de preço bloqueados a partir do orçamento guardado (ou dos valores por defeito). */
async function aplicarBloqueio(data: Record<string, unknown>, stored: Record<string, unknown> | null) {
  if (stored) {
    data.margem = stored.margem;
    data.desconto = stored.desconto;
  } else {
    data.margem = await defaultMargem();
    data.desconto = 0;
  }
  const oldLines = Array.isArray(stored?.linhas) ? (stored!.linhas as Record<string, unknown>[]) : [];
  if (Array.isArray(data.linhas)) {
    data.linhas = (data.linhas as Record<string, unknown>[]).map((l) => {
      if (!isObject(l)) return l;
      const old = oldLines.find((o) => isObject(o) && o.id === l.id);
      return { ...l, margem: old ? old.margem ?? "" : "" };
    });
  }
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
    if (key === "precos" && !isAdmin(req)) {
      return res.status(403).json({ error: "Só o administrador pode alterar as tabelas de preços." });
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

orcamentosRouter.put(
  "/:id",
  bigJson,
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!ID_RE.test(id) || !isObject(req.body)) return res.status(400).json({ error: "Dados inválidos." });
    const { id: _ignored, ...rest } = req.body as Record<string, unknown>;
    const row = await prisma.orcamento.findUnique({ where: { id } });
    const stored = row ? (row.data as Record<string, unknown>) : null;
    // O pedido de autorização só muda pelas rotas próprias (abaixo).
    if (stored && stored.pedidoAut !== undefined) rest.pedidoAut = stored.pedidoAut;
    else delete rest.pedidoAut;
    if (!isAdmin(req)) await aplicarBloqueio(rest, stored);
    const data = rest as Prisma.InputJsonValue;
    await prisma.orcamento.upsert({ where: { id }, create: { id, data }, update: { data } });
    res.json({ ok: true, margem: rest.margem, desconto: rest.desconto, pedidoAut: rest.pedidoAut ?? null });
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
    const { id: _ignored, pedidoAut: _p, ...rest } = req.body as Record<string, unknown>;
    if (!isAdmin(req)) {
      delete rest.margem;
      delete rest.desconto;
      delete rest.linhas;
    }
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

// ---------------------------------------------------------------------------
// Pedidos de autorização de preço (caso a caso)
// ---------------------------------------------------------------------------
async function avisarChat(fromId: string, toId: string, text: string) {
  // Aviso no chat interno (conversa direta). Uma falha aqui não estraga o pedido.
  try {
    const channel = "dm:" + [fromId, toId].sort().join(":");
    await prisma.chatMessage.create({ data: { channel, userId: fromId, text } });
  } catch {
    /* ignora */
  }
}
const pct = (v: unknown) => `${(Number(v) * 100).toFixed(1).replace(/\.0$/, "").replace(".", ",")}%`;

orcamentosRouter.post(
  "/:id/autorizacao",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const row = await prisma.orcamento.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: "Guarde o orçamento antes de pedir autorização." });
    const b = isObject(req.body) ? req.body : {};
    const margem = b.margem === null || b.margem === undefined || b.margem === "" ? null : Number(b.margem);
    const desconto = b.desconto === null || b.desconto === undefined || b.desconto === "" ? null : Number(b.desconto);
    if ((margem === null || !Number.isFinite(margem)) && (desconto === null || !Number.isFinite(desconto))) {
      return res.status(400).json({ error: "Indique a margem e/ou o desconto que pretende." });
    }
    if (margem !== null && (margem < -0.5 || margem > 5)) return res.status(400).json({ error: "Margem inválida." });
    if (desconto !== null && (desconto < 0 || desconto > 100)) return res.status(400).json({ error: "Desconto inválido." });
    const pedido = {
      estado: "pendente",
      margem,
      desconto,
      motivo: String(b.motivo ?? "").slice(0, 500),
      porId: req.user!.id,
      porNome: req.user!.name,
      em: new Date().toISOString(),
    };
    const data = { ...(row.data as Record<string, unknown>), pedidoAut: pedido } as Prisma.InputJsonValue;
    await prisma.orcamento.update({ where: { id }, data: { data } });
    const d = row.data as { num?: string; cliente?: { nome?: string } };
    const admins = await prisma.user.findMany({ where: { role: "ADMINISTRADOR", active: true, NOT: { id: req.user!.id } }, select: { id: true } });
    const partes = [margem !== null ? `margem ${pct(margem)}` : "", desconto !== null ? `desconto ${String(desconto).replace(".", ",")}%` : ""].filter(Boolean).join(" e ");
    for (const a of admins) {
      await avisarChat(
        req.user!.id,
        a.id,
        `Peço autorização para ${partes} no orçamento ${d.num ?? ""}${pedido.motivo ? ` — ${pedido.motivo}` : ""}\n[[doc:orc:${id}|${String(d.num ?? "Orçamento").replace(/[|\]\[]/g, " ")} — ${String(d.cliente?.nome || "sem cliente").replace(/[|\]\[]/g, " ")}|Autorização pendente]]`
      );
    }
    res.json({ ok: true, pedidoAut: pedido });
  })
);

orcamentosRouter.post(
  "/:id/autorizacao/decisao",
  asyncHandler(async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Só o administrador pode autorizar." });
    const id = req.params.id;
    const row = await prisma.orcamento.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: "Orçamento não encontrado." });
    const cur = row.data as Record<string, unknown> & { pedidoAut?: Record<string, unknown>; num?: string };
    const p = cur.pedidoAut;
    if (!p || p.estado !== "pendente") return res.status(400).json({ error: "Não há pedido pendente neste orçamento." });
    const aprovar = !!(isObject(req.body) && req.body.aprovar);
    const novo: Record<string, unknown> = {
      ...cur,
      pedidoAut: { ...p, estado: aprovar ? "aprovado" : "recusado", decididoPor: req.user!.name, decididoEm: new Date().toISOString() },
    };
    if (aprovar) {
      if (p.margem !== null && p.margem !== undefined) novo.margem = p.margem;
      if (p.desconto !== null && p.desconto !== undefined) novo.desconto = p.desconto;
    }
    await prisma.orcamento.update({ where: { id }, data: { data: novo as Prisma.InputJsonValue } });
    if (typeof p.porId === "string") {
      await avisarChat(req.user!.id, p.porId, `${aprovar ? "✅ Autorizado" : "❌ Não autorizado"}: pedido de preço no orçamento ${cur.num ?? ""}.`);
    }
    res.json({ ok: true, margem: novo.margem, desconto: novo.desconto, pedidoAut: novo.pedidoAut });
  })
);
