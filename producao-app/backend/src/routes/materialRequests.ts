import { Router } from "express";
import { z } from "zod";
import { MaterialRequestStatus } from "@prisma/client";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { asyncHandler } from "../utils/asyncHandler";

// ============================================================================
// Material a pedir aos fornecedores — lista simples de matéria-prima/
// encomendas (ex.: vidro, alumínio, parafusos) a acompanhar até chegarem,
// independente das Ordens de Serviço.
// ============================================================================

export const materialRequestsRouter = Router();
materialRequestsRouter.use(requireAuth);

const createSchema = z.object({
  description: z.string().min(1),
  quantity: z.string().optional(),
  supplierId: z.string().optional(),
  notes: z.string().optional(),
});

const updateSchema = z.object({
  description: z.string().min(1).optional(),
  quantity: z.string().optional(),
  supplierId: z.string().nullable().optional(),
  notes: z.string().optional(),
  status: z.nativeEnum(MaterialRequestStatus).optional(),
});

const INCLUDE = {
  supplier: { select: { id: true, name: true } },
  requestedBy: { select: { id: true, name: true } },
};

materialRequestsRouter.get(
  "/",
  requirePermission("materialRequests:read"),
  asyncHandler(async (_req, res) => {
    const items = await prisma.materialRequest.findMany({
      include: INCLUDE,
      orderBy: [{ createdAt: "desc" }],
    });
    // "Por tratar" à frente de "Tratado", que fica arquivado no fim.
    const order: Record<string, number> = { A_PEDIR: 0, RECEBIDO: 1 };
    items.sort((a, b) => order[a.status] - order[b.status]);
    res.json(items);
  })
);

materialRequestsRouter.post(
  "/",
  requirePermission("materialRequests:write"),
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const item = await prisma.materialRequest.create({
      data: { ...data, requestedById: req.user?.id },
      include: INCLUDE,
    });
    res.status(201).json(item);
  })
);

materialRequestsRouter.put(
  "/:id",
  requirePermission("materialRequests:write"),
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const existing = await prisma.materialRequest.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      throw new Error("Pedido de material não encontrado.");
    }

    // Regista automaticamente quando o pedido passou a "Tratado", sem
    // apagar a data se o estado for alterado outra vez para trás.
    const extra: { receivedAt?: Date } = {};
    if (data.status === "RECEBIDO" && !existing.receivedAt) extra.receivedAt = new Date();

    const item = await prisma.materialRequest.update({
      where: { id: req.params.id },
      data: { ...data, ...extra },
      include: INCLUDE,
    });
    res.json(item);
  })
);

materialRequestsRouter.delete(
  "/:id",
  requirePermission("materialRequests:write"),
  asyncHandler(async (req, res) => {
    await prisma.materialRequest.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);
