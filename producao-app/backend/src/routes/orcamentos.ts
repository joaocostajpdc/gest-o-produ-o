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
