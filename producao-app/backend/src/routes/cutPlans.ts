import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { requireFeature } from "../config/featureReleases";
import { asyncHandler } from "../utils/asyncHandler";
import { logHistoryEvent } from "../services/historyService";
import { CutResult, optimizeBars, optimizeSheets } from "../services/cutOptimizer";

// ============================================================================
// Otimização de Corte (pedido do utilizador de 2026-10-16) — planos de corte
// de chapas (2D) e de barras (1D), opcionalmente ligados a uma Ordem de
// Serviço. O cálculo é sempre feito aqui no servidor (services/cutOptimizer),
// tanto na pré-visualização como ao gravar, para o plano guardado bater certo
// com as medidas.
//
// Em teste: só o administrador vê/usa enquanto não for aprovado (ver
// config/featureReleases.ts).
// ============================================================================

export const cutPlansRouter = Router();
cutPlansRouter.use(requireAuth);
cutPlansRouter.use(requireFeature("cutPlans"));

const MAX_SHEET_UNITS = 600;
const MAX_BAR_UNITS = 5000;

const mm = z.coerce.number().positive().max(20000);
const optionalText = z.string().trim().max(500).nullable().optional();
const stockQty = z.coerce.number().int().min(1).max(10000).nullable().optional();

const sheetInput = z.object({
  mode: z.literal("CHAPAS"),
  pieces: z
    .array(
      z.object({
        ref: z.string().trim().min(1).max(40),
        description: optionalText,
        width: mm,
        length: mm,
        qty: z.coerce.number().int().min(1).max(1000),
        rotate: z.boolean().default(true),
        bends: z.coerce.number().int().min(0).max(50).nullable().optional(),
        cornerCuts: z.coerce.number().int().min(0).max(50).nullable().optional(),
      })
    )
    .min(1, "Indica pelo menos uma peça.")
    .max(200),
  stock: z
    .array(z.object({ length: mm, width: mm, qty: stockQty }))
    .min(1, "Indica pelo menos um formato de chapa.")
    .max(20),
  settings: z.object({
    kerf: z.coerce.number().min(0).max(20).default(0),
    trim: z.coerce.number().min(0).max(100).default(0),
  }),
});

const barInput = z.object({
  mode: z.literal("BARRAS"),
  pieces: z
    .array(
      z.object({
        ref: z.string().trim().min(1).max(40),
        description: optionalText,
        length: mm,
        qty: z.coerce.number().int().min(1).max(5000),
      })
    )
    .min(1, "Indica pelo menos uma peça.")
    .max(200),
  stock: z
    .array(z.object({ length: mm, qty: stockQty }))
    .min(1, "Indica pelo menos um comprimento de barra.")
    .max(20),
  settings: z.object({
    kerf: z.coerce.number().min(0).max(20).default(3),
    trim: z.coerce.number().min(0).max(500).default(0),
    minRemnant: z.coerce.number().min(0).max(20000).default(500),
  }),
});

const inputSchema = z.discriminatedUnion("mode", [sheetInput, barInput]);
type CutInput = z.infer<typeof inputSchema>;

const planSchema = z.object({
  name: z.string().trim().min(1, "Dá um nome ao plano.").max(120),
  material: optionalText,
  notes: optionalText,
  serviceOrderId: z.string().nullable().optional(),
  serviceOrderRef: optionalText, // nº da OS escrito à mão
  input: inputSchema,
});

function compute(input: CutInput): CutResult {
  const units = input.pieces.reduce((a, p) => a + p.qty, 0);
  if (input.mode === "CHAPAS") {
    if (units > MAX_SHEET_UNITS) throw new Error(`Máximo de ${MAX_SHEET_UNITS} peças por plano de chapas.`);
    return optimizeSheets(input.pieces, input.stock, input.settings);
  }
  if (units > MAX_BAR_UNITS) throw new Error(`Máximo de ${MAX_BAR_UNITS} peças por plano de barras.`);
  return optimizeBars(input.pieces, input.stock, input.settings);
}

async function resolveServiceOrder(id: string | null | undefined, ref: string | null | undefined) {
  if (id) {
    const so = await prisma.serviceOrder.findUnique({ where: { id } });
    if (!so) throw new Error("Ordem de Serviço não encontrada.");
    return so.id;
  }
  const r = ref?.trim();
  if (!r) return null;
  const so = await prisma.serviceOrder.findFirst({ where: { externalId: { equals: r, mode: "insensitive" } } });
  if (!so) throw new Error(`Não encontrei a OS "${r}".`);
  return so.id;
}

const INCLUDE = {
  serviceOrder: { select: { id: true, externalId: true, client: { select: { name: true } } } },
  createdBy: { select: { id: true, name: true } },
} as const;

function summary(totals: CutResult["totals"], mode: string) {
  return mode === "CHAPAS"
    ? `${(totals as { sheetsCount: number }).sheetsCount} chapa(s), aproveitamento ${totals.yieldPct}%`
    : `${(totals as { barsCount: number }).barsCount} barra(s), aproveitamento ${totals.yieldPct}%`;
}

// Pré-visualização: calcula sem gravar.
cutPlansRouter.post(
  "/optimize",
  requirePermission("cutPlans:read"),
  asyncHandler(async (req, res) => {
    res.json(compute(inputSchema.parse(req.body)));
  })
);

cutPlansRouter.get(
  "/",
  requirePermission("cutPlans:read"),
  asyncHandler(async (req, res) => {
    const where: Prisma.CutPlanWhereInput = {};
    if (typeof req.query.serviceOrderId === "string") where.serviceOrderId = req.query.serviceOrderId;
    const plans = await prisma.cutPlan.findMany({ where, include: INCLUDE, orderBy: { createdAt: "desc" }, take: 300 });
    // Na lista só vão os totais, não o desenho completo.
    res.json(
      plans.map(({ result, input, ...p }) => ({
        ...p,
        piecesTypes: (input as { pieces?: unknown[] })?.pieces?.length ?? 0,
        totals: (result as unknown as CutResult)?.totals ?? null,
        unplacedCount: ((result as unknown as CutResult)?.unplaced ?? []).reduce((a, u) => a + u.qty, 0),
      }))
    );
  })
);

cutPlansRouter.get(
  "/:id",
  requirePermission("cutPlans:read"),
  asyncHandler(async (req, res) => {
    const plan = await prisma.cutPlan.findUnique({ where: { id: req.params.id }, include: INCLUDE });
    if (!plan) throw new Error("Plano de corte não encontrado.");
    res.json(plan);
  })
);

cutPlansRouter.post(
  "/",
  requirePermission("cutPlans:write"),
  asyncHandler(async (req, res) => {
    const data = planSchema.parse(req.body);
    const serviceOrderId = await resolveServiceOrder(data.serviceOrderId, data.serviceOrderRef);
    const result = compute(data.input);
    const plan = await prisma.$transaction(async (tx) => {
      const created = await tx.cutPlan.create({
        data: {
          name: data.name,
          mode: data.input.mode,
          material: data.material || null,
          notes: data.notes || null,
          serviceOrderId,
          input: data.input as unknown as Prisma.InputJsonValue,
          result: result as unknown as Prisma.InputJsonValue,
          createdById: req.user?.id,
        },
        include: INCLUDE,
      });
      if (serviceOrderId) {
        await logHistoryEvent({
          tx,
          serviceOrderId,
          type: "OUTRA_ALTERACAO",
          description: `Plano de corte PC-${created.number} "${created.name}": ${summary(result.totals, created.mode)}`,
          userId: req.user?.id,
          metadata: { cutPlanId: created.id },
        });
      }
      return created;
    });
    res.status(201).json(plan);
  })
);

cutPlansRouter.put(
  "/:id",
  requirePermission("cutPlans:write"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.cutPlan.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new Error("Plano de corte não encontrado.");
    const data = planSchema.parse(req.body);
    const serviceOrderId = await resolveServiceOrder(data.serviceOrderId, data.serviceOrderRef);
    const result = compute(data.input);
    const plan = await prisma.$transaction(async (tx) => {
      const updated = await tx.cutPlan.update({
        where: { id: existing.id },
        data: {
          name: data.name,
          mode: data.input.mode,
          material: data.material || null,
          notes: data.notes || null,
          serviceOrderId,
          input: data.input as unknown as Prisma.InputJsonValue,
          result: result as unknown as Prisma.InputJsonValue,
        },
        include: INCLUDE,
      });
      if (serviceOrderId) {
        await logHistoryEvent({
          tx,
          serviceOrderId,
          type: "OUTRA_ALTERACAO",
          description: `Plano de corte PC-${updated.number} "${updated.name}" ${
            existing.serviceOrderId === serviceOrderId ? "alterado" : "ligado a esta OS"
          }: ${summary(result.totals, updated.mode)}`,
          userId: req.user?.id,
          metadata: { cutPlanId: updated.id },
        });
      }
      return updated;
    });
    res.json(plan);
  })
);

cutPlansRouter.delete(
  "/:id",
  requirePermission("cutPlans:write"),
  asyncHandler(async (req, res) => {
    await prisma.cutPlan.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);
