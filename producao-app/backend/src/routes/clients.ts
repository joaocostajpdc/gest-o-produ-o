import { Router } from "express";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { requireFeature } from "../config/featureReleases";
import { asyncHandler } from "../utils/asyncHandler";

// ============================================================================
// Clientes (importados do Goldylocks via sincronização).
// Acesso à área comercial gated pela feature "clientes".
// A rota GET / (lista simples) continua acessível a quem tem serviceOrders:read,
// para preencher filtros de OS — sem requireFeature.
// ============================================================================

export const clientsRouter = Router();
clientsRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// Lista simples — usada para preencher filtros em OS e outros ecrãs.
// Não requer feature "clientes", só autenticação.
// ---------------------------------------------------------------------------
clientsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await prisma.client.findMany({ orderBy: { name: "asc" } }));
  })
);

// ---------------------------------------------------------------------------
// Área comercial — tudo abaixo requer feature "clientes"
// ---------------------------------------------------------------------------
clientsRouter.use("/comercial", requireFeature("clientes"));

// GET /clients/comercial — lista com filtros
clientsRouter.get(
  "/comercial",
  asyncHandler(async (req, res) => {
    const { zona, comercial, status, q } = req.query as Record<string, string>;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {};

    if (zona) where.zone = zona;
    if (comercial) where.comercial = comercial;
    if (status) where.status = status;
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { taxNumber: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
      ];
    }

    const clients = await prisma.client.findMany({
      where,
      orderBy: { name: "asc" },
      select: {
        id: true,
        externalId: true,
        name: true,
        taxNumber: true,
        email: true,
        phone: true,
        mobile: true,
        zone: true,
        comercial: true,
        status: true,
        newsletter: true,
        creditlimit: true,
        whatsappactive: true,
        syncedAt: true,
        _count: { select: { serviceOrders: true } },
      },
    });

    res.json(clients);
  })
);

// GET /clients/comercial/meta — valores únicos para filtros dropdown
clientsRouter.get(
  "/comercial/meta",
  asyncHandler(async (_req, res) => {
    const [zonas, comerciais, statuses] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.client as any).findMany({
        where: { zone: { not: null } },
        select: { zone: true },
        distinct: ["zone"],
        orderBy: { zone: "asc" },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.client as any).findMany({
        where: { comercial: { not: null } },
        select: { comercial: true },
        distinct: ["comercial"],
        orderBy: { comercial: "asc" },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.client as any).findMany({
        where: { status: { not: null } },
        select: { status: true },
        distinct: ["status"],
        orderBy: { status: "asc" },
      }),
    ]);

    res.json({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      zonas: zonas.map((r: any) => r.zone).filter(Boolean),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      comerciais: comerciais.map((r: any) => r.comercial).filter(Boolean),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      statuses: statuses.map((r: any) => r.status).filter(Boolean),
    });
  })
);

// GET /clients/comercial/analytics — totais de vendas por cliente / zona / comercial
clientsRouter.get(
  "/comercial/analytics",
  asyncHandler(async (_req, res) => {
    // Totais de OS por cliente (contagem e valor total se disponível)
    const porCliente = await prisma.serviceOrder.groupBy({
      by: ["clientId"],
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 20,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clientIds = porCliente.map((r: any) => r.clientId).filter((id: any): id is string => !!id);
    const clientNames = await prisma.client.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, name: true },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nameMap = Object.fromEntries(clientNames.map((c: any) => [c.id, c]));

    // Totais por zona (via clientes ligados a OS)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clientesComOS = await (prisma.client as any).findMany({
      where: { serviceOrders: { some: {} } },
      select: {
        zone: true,
        comercial: true,
        _count: { select: { serviceOrders: true } },
      },
    });

    const porZona: Record<string, number> = {};
    const porComercial: Record<string, number> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const c of clientesComOS as any[]) {
      const zona = c.zone ?? "Sem zona";
      const com = c.comercial ?? "Sem comercial";
      porZona[zona] = (porZona[zona] ?? 0) + c._count.serviceOrders;
      porComercial[com] = (porComercial[com] ?? 0) + c._count.serviceOrders;
    }

    res.json({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      porCliente: porCliente.map((r: any) => ({
        clientId: r.clientId,
        name: r.clientId ? (nameMap[r.clientId]?.name ?? "Desconhecido") : "Sem cliente",
        zone: r.clientId ? (nameMap[r.clientId]?.zone ?? null) : null,
        comercial: r.clientId ? (nameMap[r.clientId]?.comercial ?? null) : null,
        totalOS: r._count.id,
      })),
      porZona: Object.entries(porZona)
        .map(([zona, total]) => ({ zona, total }))
        .sort((a, b) => b.total - a.total),
      porComercial: Object.entries(porComercial)
        .map(([comercial, total]) => ({ comercial, total }))
        .sort((a, b) => b.total - a.total),
    });
  })
);

// GET /clients/comercial/:id — detalhe de um cliente com OS associadas
clientsRouter.get(
  "/comercial/:id",
  asyncHandler(async (req, res) => {
    const client = await prisma.client.findUnique({
      where: { id: req.params.id },
      include: {
        serviceOrders: {
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            createdAt: true,
            description: true,
          },
        },
      },
    });
    if (!client) return res.status(404).json({ error: "Cliente não encontrado." });
    res.json(client);
  })
);
