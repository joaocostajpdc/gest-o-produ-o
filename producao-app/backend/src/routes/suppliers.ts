import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { asyncHandler } from "../utils/asyncHandler";

export const suppliersRouter = Router();
suppliersRouter.use(requireAuth);

const supplierSchema = z.object({
  name: z.string().min(1),
  contact: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
});

// Prazo de entrega (dias) que o fornecedor pratica para uma categoria de
// produto — ver comentário no schema.prisma sobre SupplierLeadTime.
const leadTimeSchema = z.object({
  category: z.string().min(1),
  leadDays: z.number().int().nonnegative(),
});

suppliersRouter.get(
  "/",
  requirePermission("suppliers:read"),
  asyncHandler(async (_req, res) => {
    res.json(
      await prisma.supplier.findMany({
        orderBy: { name: "asc" },
        include: { leadTimes: { orderBy: { category: "asc" } } },
      })
    );
  })
);

suppliersRouter.get(
  "/:id",
  requirePermission("suppliers:read"),
  asyncHandler(async (req, res) => {
    const supplier = await prisma.supplier.findUnique({
      where: { id: req.params.id },
      include: {
        stageAssociations: { include: { stage: true, product: true } },
        stageInstances: {
          include: { serviceOrder: true, stage: true },
          orderBy: { enteredAt: "desc" },
          take: 20,
        },
        leadTimes: { orderBy: { category: "asc" } },
      },
    });
    if (!supplier) return res.status(404).json({ error: "Fornecedor não encontrado." });
    res.json(supplier);
  })
);

suppliersRouter.post(
  "/",
  requirePermission("suppliers:write"),
  asyncHandler(async (req, res) => {
    const data = supplierSchema.parse(req.body);
    res.status(201).json(await prisma.supplier.create({ data }));
  })
);

suppliersRouter.put(
  "/:id",
  requirePermission("suppliers:write"),
  asyncHandler(async (req, res) => {
    const data = supplierSchema.partial().parse(req.body);
    res.json(await prisma.supplier.update({ where: { id: req.params.id }, data }));
  })
);

suppliersRouter.delete(
  "/:id",
  requirePermission("suppliers:write"),
  asyncHandler(async (req, res) => {
    await prisma.supplier.delete({ where: { id: req.params.id } });
    res.status(204).send();
  })
);

// ---------------------------------------------------------------------------
// Prazos de entrega por categoria (usados atualmente na etapa "Lacagem"
// para calcular a data prevista de devolução de uma OS enviada a este
// fornecedor).
// ---------------------------------------------------------------------------
suppliersRouter.post(
  "/:id/lead-times",
  requirePermission("suppliers:write"),
  asyncHandler(async (req, res) => {
    const { category, leadDays } = leadTimeSchema.parse(req.body);
    const leadTime = await prisma.supplierLeadTime.upsert({
      where: { supplierId_category: { supplierId: req.params.id, category } },
      update: { leadDays },
      create: { supplierId: req.params.id, category, leadDays },
    });
    res.status(201).json(leadTime);
  })
);

suppliersRouter.put(
  "/:id/lead-times/:leadTimeId",
  requirePermission("suppliers:write"),
  asyncHandler(async (req, res) => {
    const { leadDays } = leadTimeSchema.pick({ leadDays: true }).parse(req.body);
    const leadTime = await prisma.supplierLeadTime.update({
      where: { id: req.params.leadTimeId },
      data: { leadDays },
    });
    res.json(leadTime);
  })
);

suppliersRouter.delete(
  "/:id/lead-times/:leadTimeId",
  requirePermission("suppliers:write"),
  asyncHandler(async (req, res) => {
    await prisma.supplierLeadTime.delete({ where: { id: req.params.leadTimeId } });
    res.status(204).send();
  })
);
