import { Router } from "express";
import { z } from "zod";
import { GlassOrderStatus, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { requireFeature } from "../config/featureReleases";
import { asyncHandler } from "../utils/asyncHandler";
import { logHistoryEvent } from "../services/historyService";

// ============================================================================
// Pedidos de Vidros (pedido do utilizador de 2026-10-14) — substitui a folha
// "Pedidos vidros" do Excel. Cada linha é um vidro pedido a um fornecedor
// (ex.: Vitralia), opcionalmente ligado à Ordem de Serviço a que se destina.
// Lança-se na página "Pedidos de Vidros" ou no separador "Vidros" da própria
// OS; os dois mostram os mesmos registos.
//
// Em teste: só o administrador vê/usa enquanto não for aprovado (ver
// config/featureReleases.ts).
// ============================================================================

export const glassOrdersRouter = Router();
glassOrdersRouter.use(requireAuth);
glassOrdersRouter.use(requireFeature("glassOrders"));

const INCLUDE = {
  supplier: { select: { id: true, name: true } },
  serviceOrder: { select: { id: true, externalId: true, client: { select: { name: true } } } },
  createdBy: { select: { id: true, name: true } },
} as const;

const optionalText = z.string().trim().nullable().optional();
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (AAAA-MM-DD).")
  .optional();

const createSchema = z.object({
  date: dateOnly,
  nRef: optionalText,
  serviceOrderId: z.string().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  medida: z.string().trim().min(1),
  caixa: z.string().trim().min(1),
  quantity: z.coerce.number().int().min(1).max(10000).default(1),
  status: z.nativeEnum(GlassOrderStatus).optional(),
  orderNumber: optionalText,
  expectedDelivery: optionalText,
  notes: optionalText,
});

const updateSchema = createSchema.partial();

/**
 * Liga o vidro à Ordem de Serviço: pelo id (quando lançado a partir da OS)
 * ou, se não vier id, pelo N/Ref. escrito (procura a OS com esse número).
 * Devolve também o N/Ref. a guardar (o número da OS, quando ligada).
 */
async function resolveServiceOrder(serviceOrderId: string | null | undefined, nRef: string | null | undefined) {
  if (serviceOrderId) {
    const so = await prisma.serviceOrder.findUnique({ where: { id: serviceOrderId } });
    if (!so) throw new Error("Ordem de Serviço não encontrada.");
    return { serviceOrderId: so.id, nRef: so.externalId };
  }
  const ref = nRef?.trim() || null;
  if (!ref) return { serviceOrderId: null, nRef: null };
  const so = await prisma.serviceOrder.findFirst({
    where: { externalId: { equals: ref, mode: "insensitive" } },
  });
  return { serviceOrderId: so?.id ?? null, nRef: so?.externalId ?? ref };
}

function toDate(value: string | undefined) {
  return value ? new Date(`${value}T00:00:00Z`) : undefined;
}

function describe(o: { quantity: number; medida: string; caixa: string }) {
  return `${o.quantity}× ${o.medida} — ${o.caixa}`;
}

const STATUS_LABELS: Record<GlassOrderStatus, string> = {
  POR_ENCOMENDAR: "Por encomendar",
  ENCOMENDADO: "Encomendado",
  FINALIZADO: "Finalizado",
};

glassOrdersRouter.get(
  "/",
  requirePermission("glassOrders:read"),
  asyncHandler(async (req, res) => {
    const where: Prisma.GlassOrderWhereInput = {};
    if (typeof req.query.serviceOrderId === "string") where.serviceOrderId = req.query.serviceOrderId;
    const status = req.query.status;
    if (status === "POR_ENCOMENDAR" || status === "ENCOMENDADO" || status === "FINALIZADO") where.status = status;
    const items = await prisma.glassOrder.findMany({
      where,
      include: INCLUDE,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });
    res.json(items);
  })
);

glassOrdersRouter.post(
  "/",
  requirePermission("glassOrders:write"),
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const link = await resolveServiceOrder(data.serviceOrderId, data.nRef);
    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.glassOrder.create({
        data: {
          date: toDate(data.date),
          ...link,
          supplierId: data.supplierId || null,
          medida: data.medida,
          caixa: data.caixa,
          quantity: data.quantity,
          status: data.status,
          orderNumber: data.orderNumber || null,
          expectedDelivery: data.expectedDelivery || null,
          notes: data.notes || null,
          createdById: req.user?.id,
        },
        include: INCLUDE,
      });
      if (created.serviceOrderId) {
        await logHistoryEvent({
          tx,
          serviceOrderId: created.serviceOrderId,
          type: "OUTRA_ALTERACAO",
          description: `Vidro pedido: ${describe(created)}${created.supplier ? ` (${created.supplier.name})` : ""}`,
          userId: req.user?.id,
          metadata: { glassOrderId: created.id },
        });
      }
      return created;
    });
    res.status(201).json(item);
  })
);

glassOrdersRouter.put(
  "/:id",
  requirePermission("glassOrders:write"),
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const existing = await prisma.glassOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new Error("Pedido de vidro não encontrado.");

    const link =
      data.serviceOrderId !== undefined || data.nRef !== undefined
        ? await resolveServiceOrder(data.serviceOrderId, data.nRef)
        : {};

    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.glassOrder.update({
        where: { id: existing.id },
        data: {
          date: toDate(data.date),
          ...link,
          supplierId: data.supplierId === undefined ? undefined : data.supplierId || null,
          medida: data.medida,
          caixa: data.caixa,
          quantity: data.quantity,
          status: data.status,
          orderNumber: data.orderNumber === undefined ? undefined : data.orderNumber || null,
          expectedDelivery: data.expectedDelivery === undefined ? undefined : data.expectedDelivery || null,
          notes: data.notes === undefined ? undefined : data.notes || null,
        },
        include: INCLUDE,
      });
      // Mudança de estado fica no histórico da OS (ex.: vidro finalizado).
      if (updated.serviceOrderId && data.status && data.status !== existing.status) {
        await logHistoryEvent({
          tx,
          serviceOrderId: updated.serviceOrderId,
          type: "OUTRA_ALTERACAO",
          description: `Vidro ${describe(updated)}: ${STATUS_LABELS[existing.status]} → ${STATUS_LABELS[data.status]}`,
          userId: req.user?.id,
          metadata: { glassOrderId: updated.id },
        });
      }
      return updated;
    });
    res.json(item);
  })
);

glassOrdersRouter.delete(
  "/:id",
  requirePermission("glassOrders:write"),
  asyncHandler(async (req, res) => {
    await prisma.glassOrder.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);
