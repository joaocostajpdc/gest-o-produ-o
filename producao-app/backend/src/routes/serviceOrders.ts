import express, { Router } from "express";
import { z } from "zod";
import { InterruptionReason } from "@prisma/client";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { asyncHandler } from "../utils/asyncHandler";
import { comparePriority, computePriority, PRIORITY_COLORS, PRIORITY_LABELS } from "../services/priorityService";
import { getCurrentProductionMinutes, getStageResidenceMinutes, startProduction } from "../services/timeTrackingService";
import {
  advanceStage,
  enterFirstStage,
  insertStage,
  returnToStage,
  revertToDefaultLine,
  skipStage,
} from "../services/stageFlowService";
import { startInterruption, endInterruption } from "../services/interruptionService";
import {
  importPendingServiceOrders,
  importSingleGoldylocksOrder,
  cancelServiceOrder,
} from "../services/serviceOrderService";
import { parseOrdemServicoPdf } from "../services/goldylocksPdfParser";
import { streamServiceOrderTravelerPdf, TravelerData } from "../services/serviceOrderPdfService";
import { getServiceOrderHistory, logHistoryEvent } from "../services/historyService";

export const serviceOrdersRouter = Router();
serviceOrdersRouter.use(requireAuth);

const LIST_INCLUDE = {
  client: true,
  product: true,
  currentStageInstance: {
    include: { stage: true, supplier: { include: { leadTimes: true } } },
  },
} as const;

// Data prevista de devolução quando a OS está atualmente na etapa
// "Lacagem" junto de um fornecedor: entrada na etapa + prazo (dias)
// configurado em Fornecedores para [fornecedor, categoria do produto].
// Por agora aplica-se apenas a esta etapa (ver AppProdução — pedido do
// utilizador de 2026-08-19).
const LACAGEM_STAGE_NAME = "Lacagem";

function computeLacagemExpectedReturn(order: any) {
  const csi = order.currentStageInstance;
  if (!csi || csi.stage.name !== LACAGEM_STAGE_NAME || !csi.supplier || !csi.enteredAt) {
    return { expectedReturnAt: null, leadDays: null };
  }
  const leadTime = (csi.supplier.leadTimes as any[] | undefined)?.find(
    (lt) => lt.category === order.product.category
  );
  if (!leadTime) return { expectedReturnAt: null, leadDays: null };
  const expectedReturnAt = new Date(
    new Date(csi.enteredAt).getTime() + leadTime.leadDays * 24 * 60 * 60 * 1000
  ).toISOString();
  return { expectedReturnAt, leadDays: leadTime.leadDays };
}

function serializeListItem(order: any, now: Date) {
  const priority = computePriority(order.deadlineAt, order.status, now);
  const { expectedReturnAt, leadDays } = computeLacagemExpectedReturn(order);
  return {
    id: order.id,
    externalId: order.externalId,
    status: order.status,
    client: { id: order.client.id, name: order.client.name },
    product: { id: order.product.id, name: order.product.name, category: order.product.category },
    deadlineAt: order.deadlineAt,
    priority,
    priorityLabel: priority ? PRIORITY_LABELS[priority] : null,
    priorityColor: priority ? PRIORITY_COLORS[priority] : null,
    currentStage: order.currentStageInstance
      ? {
          id: order.currentStageInstance.id,
          name: order.currentStageInstance.stage.name,
          supplier: order.currentStageInstance.supplier?.name ?? null,
          residenceMinutes: getStageResidenceMinutes(order.currentStageInstance, now),
          expectedReturnAt,
          leadDays,
        }
      : null,
    productionMinutes: getCurrentProductionMinutes(order, now),
  };
}

// ---------------------------------------------------------------------------
// Listagem com filtros: prioridade, etapa, fornecedor, cliente.
// A ordenação por prioridade (mais urgente primeiro, data-limite como
// critério secundário) é sempre aplicada automaticamente.
// ---------------------------------------------------------------------------
serviceOrdersRouter.get(
  "/",
  requirePermission("serviceOrders:read"),
  asyncHandler(async (req, res) => {
    const { status, stageId, supplierId, clientId, priority, search, category } = req.query;

    const where: any = {};
    if (status) where.status = String(status);
    if (clientId) where.clientId = String(clientId);
    // Filtra pela categoria "leve" do produto associado (ex.: "Mosquiteiras"),
    // útil quando há muitas OS de categorias diferentes em simultâneo.
    if (category) where.product = { category: String(category) };
    if (search) {
      where.OR = [
        { externalId: { contains: String(search), mode: "insensitive" } },
        { client: { name: { contains: String(search), mode: "insensitive" } } },
        { product: { name: { contains: String(search), mode: "insensitive" } } },
      ];
    }
    if (stageId || supplierId) {
      where.currentStageInstance = {
        ...(stageId ? { stageId: String(stageId) } : {}),
        ...(supplierId ? { supplierId: String(supplierId) } : {}),
      };
    }

    const orders = await prisma.serviceOrder.findMany({ where, include: LIST_INCLUDE });
    const now = new Date();
    let items = orders.map((o) => serializeListItem(o, now));

    if (priority) {
      items = items.filter((i) => i.priority === String(priority));
    }

    items.sort((a, b) =>
      comparePriority(
        { priority: a.priority, deadlineAt: a.deadlineAt },
        { priority: b.priority, deadlineAt: b.deadlineAt }
      )
    );

    res.json(items);
  })
);

serviceOrdersRouter.get(
  "/:id",
  requirePermission("serviceOrders:read"),
  asyncHandler(async (req, res) => {
    const order = await prisma.serviceOrder.findUnique({
      where: { id: req.params.id },
      include: {
        ...LIST_INCLUDE,
        stageInstances: {
          orderBy: { order: "asc" },
          include: { stage: true, supplier: true, changedBy: { select: { id: true, name: true } } },
        },
        interruptions: { orderBy: { startedAt: "desc" }, include: { user: { select: { id: true, name: true } } } },
        observations: {
          orderBy: { createdAt: "desc" },
          include: { user: { select: { id: true, name: true } }, stageInstance: { include: { stage: true } } },
        },
      },
    });
    if (!order) return res.status(404).json({ error: "Ordem de Serviço não encontrada." });

    const now = new Date();
    res.json({
      ...serializeListItem(order, now),
      createdAt: order.createdAt,
      startedAt: order.startedAt,
      completedAt: order.completedAt,
      specifications: order.specifications,
      stageInstances: order.stageInstances.map((si) => ({
        ...si,
        residenceMinutes: getStageResidenceMinutes(si, now),
      })),
      interruptions: order.interruptions,
      observations: order.observations,
    });
  })
);

serviceOrdersRouter.get(
  "/:id/history",
  requirePermission("serviceOrders:read"),
  asyncHandler(async (req, res) => {
    res.json(await getServiceOrderHistory(req.params.id));
  })
);

// ---------------------------------------------------------------------------
// Ficha de Produção (PDF por OS) — documento pronto a imprimir e a
// acompanhar a peça física, com código de barras, características do
// produto e checklist de etapas (com as observações de cada etapa, para
// que uma nota registada numa etapa continue visível nas seguintes).
// ---------------------------------------------------------------------------
serviceOrdersRouter.get(
  "/:id/pdf",
  requirePermission("serviceOrders:read"),
  asyncHandler(async (req, res) => {
    const order = await prisma.serviceOrder.findUnique({
      where: { id: req.params.id },
      include: {
        client: true,
        product: true,
        stageInstances: {
          orderBy: { order: "asc" },
          include: {
            stage: true,
            supplier: true,
            observations: {
              orderBy: { createdAt: "asc" },
              include: { user: { select: { id: true, name: true } } },
            },
          },
        },
        observations: {
          where: { stageInstanceId: null },
          orderBy: { createdAt: "asc" },
          include: { user: { select: { id: true, name: true } } },
        },
      },
    });
    if (!order) return res.status(404).json({ error: "Ordem de Serviço não encontrada." });

    const now = new Date();
    const priority = computePriority(order.deadlineAt, order.status, now);

    const data: TravelerData = {
      externalId: order.externalId,
      clienteName: order.client.name,
      produtoName: order.product.name,
      status: order.status,
      createdAt: order.createdAt.toISOString(),
      startedAt: order.startedAt ? order.startedAt.toISOString() : null,
      deadlineAt: order.deadlineAt ? order.deadlineAt.toISOString() : null,
      priorityNivel: priority,
      priorityLabel: priority ? PRIORITY_LABELS[priority] : null,
      specifications: order.specifications,
      stages: order.stageInstances.map((si) => ({
        stageName: si.stage.name,
        status: si.status,
        supplierName: si.supplier?.name ?? null,
        observations: si.observations.map((o) => ({
          text: o.text,
          userName: o.user.name,
          createdAt: o.createdAt.toISOString(),
        })),
      })),
      generalObservations: order.observations.map((o) => ({
        text: o.text,
        userName: o.user.name,
        createdAt: o.createdAt.toISOString(),
      })),
    };

    await streamServiceOrderTravelerPdf(res, data);
  })
);

// ---------------------------------------------------------------------------
// Importação a partir do Goldylocks
// ---------------------------------------------------------------------------
serviceOrdersRouter.post(
  "/import",
  requirePermission("serviceOrders:changeStatus"),
  asyncHandler(async (req, res) => {
    const result = await importPendingServiceOrders(req.user?.id);
    res.json(result);
  })
);

// Importação a partir de um PDF de "Ordem Serviço" exportado do Goldylocks
// (alternativa/complemento à importação pela API, útil enquanto essa
// integração não estiver totalmente validada). O corpo do pedido é o
// ficheiro PDF em bruto (Content-Type: application/pdf), não JSON.
serviceOrdersRouter.post(
  "/import-pdf",
  requirePermission("serviceOrders:changeStatus"),
  express.raw({ type: ["application/pdf", "application/octet-stream"], limit: "15mb" }),
  asyncHandler(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "Nenhum ficheiro PDF recebido." });
    }
    const goldOrder = await parseOrdemServicoPdf(req.body);
    const result = await importSingleGoldylocksOrder(goldOrder, req.user?.id);
    res.json(result);
  })
);

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------
serviceOrdersRouter.post(
  "/:id/start",
  requirePermission("serviceOrders:changeStatus"),
  asyncHandler(async (req, res) => {
    const order = await startProduction(req.params.id, req.user?.id);
    await enterFirstStage(req.params.id, req.user?.id);
    res.json(order);
  })
);

const cancelSchema = z.object({ reason: z.string().min(1) });
serviceOrdersRouter.post(
  "/:id/cancel",
  requirePermission("serviceOrders:changeStatus"),
  asyncHandler(async (req, res) => {
    const { reason } = cancelSchema.parse(req.body);
    await cancelServiceOrder(req.params.id, reason, req.user?.id);
    res.status(204).send();
  })
);

// ---------------------------------------------------------------------------
// Fluxo de etapas (alterações pontuais)
// ---------------------------------------------------------------------------
serviceOrdersRouter.post(
  "/:id/stage-flow/advance",
  requirePermission("serviceOrders:changeStatus"),
  asyncHandler(async (req, res) => {
    res.json(await advanceStage(req.params.id, req.user?.id));
  })
);

const stageIdSchema = z.object({ stageId: z.string().min(1) });
serviceOrdersRouter.post(
  "/:id/stage-flow/return",
  requirePermission("serviceOrders:changeFlow"),
  asyncHandler(async (req, res) => {
    const { stageId } = stageIdSchema.parse(req.body);
    await returnToStage(req.params.id, stageId, req.user?.id);
    res.status(204).send();
  })
);

serviceOrdersRouter.post(
  "/:id/stage-flow/insert",
  requirePermission("serviceOrders:changeFlow"),
  asyncHandler(async (req, res) => {
    const { stageId } = stageIdSchema.parse(req.body);
    res.json(await insertStage(req.params.id, stageId, req.user?.id));
  })
);

const stageInstanceIdSchema = z.object({ stageInstanceId: z.string().min(1) });
serviceOrdersRouter.post(
  "/:id/stage-flow/skip",
  requirePermission("serviceOrders:changeFlow"),
  asyncHandler(async (req, res) => {
    const { stageInstanceId } = stageInstanceIdSchema.parse(req.body);
    await skipStage(req.params.id, stageInstanceId, req.user?.id);
    res.status(204).send();
  })
);

serviceOrdersRouter.post(
  "/:id/stage-flow/revert-to-default",
  requirePermission("serviceOrders:changeFlow"),
  asyncHandler(async (req, res) => {
    const { stageId } = stageIdSchema.parse(req.body);
    await revertToDefaultLine(req.params.id, stageId, req.user?.id);
    res.status(204).send();
  })
);

// ---------------------------------------------------------------------------
// Interrupções
// ---------------------------------------------------------------------------
const startInterruptionSchema = z.object({
  reason: z.nativeEnum(InterruptionReason),
  otherDescription: z.string().optional(),
});
serviceOrdersRouter.post(
  "/:id/interruptions",
  requirePermission("interruptions:write"),
  asyncHandler(async (req, res) => {
    const body = startInterruptionSchema.parse(req.body);
    const interruption = await startInterruption({
      serviceOrderId: req.params.id,
      reason: body.reason,
      otherDescription: body.otherDescription,
      userId: req.user!.id,
    });
    res.status(201).json(interruption);
  })
);

serviceOrdersRouter.post(
  "/:id/interruptions/:interruptionId/end",
  requirePermission("interruptions:write"),
  asyncHandler(async (req, res) => {
    const interruption = await endInterruption(req.params.interruptionId, req.user!.id);
    res.json(interruption);
  })
);

// ---------------------------------------------------------------------------
// Observações
// ---------------------------------------------------------------------------
const observationSchema = z.object({
  text: z.string().min(1),
  // Etapa a que a observação diz respeito (opcional — omitir para uma
  // observação geral, não associada a nenhuma etapa em particular).
  stageInstanceId: z.string().optional().nullable(),
});
serviceOrdersRouter.post(
  "/:id/observations",
  requirePermission("observations:write"),
  asyncHandler(async (req, res) => {
    const { text, stageInstanceId } = observationSchema.parse(req.body);

    if (stageInstanceId) {
      const belongsToOrder = await prisma.serviceOrderStageInstance.findFirst({
        where: { id: stageInstanceId, serviceOrderId: req.params.id },
        select: { id: true },
      });
      if (!belongsToOrder) {
        return res.status(400).json({ error: "A etapa indicada não pertence a esta Ordem de Serviço." });
      }
    }

    const observation = await prisma.observation.create({
      data: { serviceOrderId: req.params.id, text, userId: req.user!.id, stageInstanceId: stageInstanceId || null },
      include: { user: { select: { id: true, name: true } }, stageInstance: { include: { stage: true } } },
    });
    await logHistoryEvent({
      serviceOrderId: req.params.id,
      type: "OBSERVACAO_REGISTADA",
      description: stageInstanceId
        ? `Nova observação registada na etapa "${observation.stageInstance?.stage.name}".`
        : "Nova observação registada.",
      userId: req.user!.id,
      metadata: { observationId: observation.id },
    });
    res.status(201).json(observation);
  })
);

serviceOrdersRouter.put(
  "/:id/observations/:observationId",
  requirePermission("observations:write"),
  asyncHandler(async (req, res) => {
    const { text } = observationSchema.parse(req.body);
    const observation = await prisma.observation.update({
      where: { id: req.params.observationId },
      data: { text, editedAt: new Date() },
    });
    res.json(observation);
  })
);
