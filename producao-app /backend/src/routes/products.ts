import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { asyncHandler } from "../utils/asyncHandler";

export const productsRouter = Router();
productsRouter.use(requireAuth);

const productSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  categoryId: z.string().min(1),
  externalId: z.string().optional(),
});

productsRouter.get(
  "/",
  requirePermission("products:read"),
  asyncHandler(async (req, res) => {
    const { categoryId } = req.query;
    const products = await prisma.product.findMany({
      where: categoryId ? { categoryId: String(categoryId) } : undefined,
      orderBy: { name: "asc" },
      include: { category: true },
    });
    res.json(products);
  })
);

productsRouter.post(
  "/",
  requirePermission("products:write"),
  asyncHandler(async (req, res) => {
    const data = productSchema.parse(req.body);
    const product = await prisma.product.create({ data });
    res.status(201).json(product);
  })
);

productsRouter.put(
  "/:id",
  requirePermission("products:write"),
  asyncHandler(async (req, res) => {
    const data = productSchema.partial().parse(req.body);
    const product = await prisma.product.update({ where: { id: req.params.id }, data });
    res.json(product);
  })
);

productsRouter.delete(
  "/:id",
  requirePermission("products:write"),
  asyncHandler(async (req, res) => {
    await prisma.product.delete({ where: { id: req.params.id } });
    res.status(204).send();
  })
);
