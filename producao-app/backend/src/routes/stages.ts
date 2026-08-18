import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { asyncHandler } from "../utils/asyncHandler";

export const stagesRouter = Router();
stagesRouter.use(requireAuth);

const stageSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  requiresSupplier: z.boolean().optional(),
});

// Catálogo global de etapas (ex.: Corte, Fresagem, Lacagem, Embalagem).
stagesRouter.get(
  "/",
  requirePermission("stages:read"),
  asyncHandler(async (_req, res) => {
    res.json(await prisma.stage.findMany({ orderBy: { name: "asc" } }));
  })
);

stagesRouter.post(
  "/",
  requirePermission("stages:write"),
  asyncHandler(async (req, res) => {
    const data = stageSchema.parse(req.body);
    res.status(201).json(await prisma.stage.create({ data }));
  })
);

stagesRouter.put(
  "/:id",
  requirePermission("stages:write"),
  asyncHandler(async (req, res) => {
    const data = stageSchema.partial().parse(req.body);
    res.json(await prisma.stage.update({ where: { id: req.params.id }, data }));
  })
);

stagesRouter.delete(
  "/:id",
  requirePermission("stages:write"),
  asyncHandler(async (req, res) => {
    await prisma.stage.delete({ where: { id: req.params.id } });
    res.status(204).send();
  })
);

// ---------------------------------------------------------------------------
// Linhas de Produção predefinidas por categoria (sequência ordenada de etapas)
// ---------------------------------------------------------------------------

const lineStepSchema = z.object({
  categoryId: z.string().min(1),
  stageId: z.string().min(1),
  order: z.number().int().positive(),
  defaultSupplierId: z.string().optional().nullable(),
});

export const productionLinesRouter = Router();
productionLinesRouter.use(requireAuth);

productionLinesRouter.get(
  "/",
  requirePermission("productionLines:read"),
  asyncHandler(async (req, res) => {
    const { categoryId } = req.query;
    const steps = await prisma.productionLineStep.findMany({
      where: categoryId ? { categoryId: String(categoryId) } : undefined,
      orderBy: [{ categoryId: "asc" }, { order: "asc" }],
      include: { stage: true, defaultSupplier: true, category: true },
    });
    res.json(steps);
  })
);

productionLinesRouter.post(
  "/",
  requirePermission("productionLines:write"),
  asyncHandler(async (req, res) => {
    const data = lineStepSchema.parse(req.body);
    const step = await prisma.productionLineStep.create({ data });
    res.status(201).json(step);
  })
);

productionLinesRouter.put(
  "/:id",
  requirePermission("productionLines:write"),
  asyncHandler(async (req, res) => {
    const data = lineStepSchema.partial().parse(req.body);
    const step = await prisma.productionLineStep.update({ where: { id: req.params.id }, data });
    res.json(step);
  })
);

productionLinesRouter.delete(
  "/:id",
  requirePermission("productionLines:write"),
  asyncHandler(async (req, res) => {
    await prisma.productionLineStep.delete({ where: { id: req.params.id } });
    res.status(204).send();
  })
);
