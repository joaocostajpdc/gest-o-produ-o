import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { asyncHandler } from "../utils/asyncHandler";

export const categoriesRouter = Router();
categoriesRouter.use(requireAuth);

const categorySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  defaultProductionHours: z.number().int().nonnegative(),
});

categoriesRouter.get(
  "/",
  requirePermission("categories:read"),
  asyncHandler(async (_req, res) => {
    const categories = await prisma.productCategory.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { products: true, serviceOrders: true } } },
    });
    res.json(categories);
  })
);

categoriesRouter.get(
  "/:id",
  requirePermission("categories:read"),
  asyncHandler(async (req, res) => {
    const category = await prisma.productCategory.findUnique({
      where: { id: req.params.id },
      include: {
        products: true,
        lineSteps: { orderBy: { order: "asc" }, include: { stage: true, defaultSupplier: true } },
      },
    });
    if (!category) return res.status(404).json({ error: "Categoria não encontrada." });
    res.json(category);
  })
);

categoriesRouter.post(
  "/",
  requirePermission("categories:write"),
  asyncHandler(async (req, res) => {
    const data = categorySchema.parse(req.body);
    const category = await prisma.productCategory.create({ data });
    res.status(201).json(category);
  })
);

categoriesRouter.put(
  "/:id",
  requirePermission("categories:write"),
  asyncHandler(async (req, res) => {
    const data = categorySchema.partial().parse(req.body);
    const category = await prisma.productCategory.update({ where: { id: req.params.id }, data });
    res.json(category);
  })
);

categoriesRouter.delete(
  "/:id",
  requirePermission("categories:write"),
  asyncHandler(async (req, res) => {
    await prisma.productCategory.delete({ where: { id: req.params.id } });
    res.status(204).send();
  })
);
