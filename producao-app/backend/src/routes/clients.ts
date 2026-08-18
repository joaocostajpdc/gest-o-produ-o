import { Router } from "express";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { asyncHandler } from "../utils/asyncHandler";

// Clientes são geridos no Goldylocks (software de faturação); esta rota é
// apenas de consulta, usada sobretudo para preencher filtros (por cliente)
// nas listagens de Ordens de Serviço.
export const clientsRouter = Router();
clientsRouter.use(requireAuth);

clientsRouter.get(
  "/",
  requirePermission("serviceOrders:read"),
  asyncHandler(async (_req, res) => {
    res.json(await prisma.client.findMany({ orderBy: { name: "asc" } }));
  })
);
