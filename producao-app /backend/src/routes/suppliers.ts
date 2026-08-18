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

suppliersRouter.get(
  "/",
  requirePermission("suppliers:read"),
  asyncHandler(async (_req, res) => {
    res.json(await prisma.supplier.findMany({ orderBy: { name: "asc" } }));
  })
);

suppliersRouter.get(
  "/:id",
  requirePermission("suppliers:read"),
  asyncHandler(async (req, res) => {
    const supplier = await prisma.supplier.findUnique({
      where: { id: req.params.id },
      include: {
        stageAssociations: { include: { stage: true, category: true } },
        stageInstances: {
          include: { serviceOrder: true, stage: true },
          orderBy: { enteredAt: "desc" },
          take: 20,
        },
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
