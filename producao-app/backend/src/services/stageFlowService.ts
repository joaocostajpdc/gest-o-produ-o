import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { logHistoryEvent } from "./historyService";
import { settleProductionMinutes } from "./timeTrackingService";

// ============================================================================
// Serviço de Fluxo de Etapas (Linhas de Produção)
//
// Cada categoria tem uma linha de produção predefinida (ProductionLineStep,
// sequência ordenada de etapas). Ao criar uma OS, essa sequência é copiada
// para ServiceOrderStageInstance (uma "cópia de trabalho" por OS), o que
// permite alterações pontuais (avançar, recuar, inserir, omitir) sem afetar
// a linha predefinida da categoria nem outras Ordens de Serviço.
//
// A ordenação usa incrementos de 10 (10, 20, 30, ...) para permitir inserir
// etapas entre posições existentes sem ter de renumerar tudo.
// ============================================================================

const ORDER_STEP = 10;

/** Cria as instâncias de etapa (todas PENDENTE) a partir da linha predefinida da categoria. */
export async function initializeStageInstances(
  serviceOrderId: string,
  categoryId: string,
  tx: Prisma.TransactionClient
) {
  const lineSteps = await tx.productionLineStep.findMany({
    where: { categoryId },
    orderBy: { order: "asc" },
  });

  if (lineSteps.length === 0) {
    throw new Error(
      "A categoria do produto não tem uma linha de produção configurada (nenhuma etapa definida)."
    );
  }

  for (const step of lineSteps) {
    await tx.serviceOrderStageInstance.create({
      data: {
        serviceOrderId,
        stageId: step.stageId,
        order: step.order * ORDER_STEP,
        supplierId: step.defaultSupplierId,
        status: "PENDENTE",
      },
    });
  }
}

/** Ativa a primeira etapa pendente (chamado quando a produção arranca). */
export async function enterFirstStage(serviceOrderId: string, userId?: string) {
  return prisma.$transaction(async (tx) => {
    const first = await tx.serviceOrderStageInstance.findFirst({
      where: { serviceOrderId, status: "PENDENTE" },
      orderBy: { order: "asc" },
    });
    if (!first) throw new Error("Não existem etapas configuradas para esta OS.");
    await enterStage(serviceOrderId, first.id, tx, userId);
  });
}

async function enterStage(
  serviceOrderId: string,
  stageInstanceId: string,
  tx: Prisma.TransactionClient,
  userId?: string
) {
  const now = new Date();
  const instance = await tx.serviceOrderStageInstance.update({
    where: { id: stageInstanceId },
    data: { status: "ATIVA", enteredAt: now },
    include: { stage: true },
  });
  await tx.serviceOrder.update({
    where: { id: serviceOrderId },
    data: { currentStageInstanceId: stageInstanceId },
  });
  await logHistoryEvent({
    serviceOrderId,
    type: "ENTRADA_ETAPA",
    description: `Entrada na etapa "${instance.stage.name}".`,
    userId,
    metadata: { stageInstanceId, stageId: instance.stageId },
    tx,
  });
}

async function exitCurrentStage(
  serviceOrderId: string,
  tx: Prisma.TransactionClient,
  userId?: string
) {
  const order = await tx.serviceOrder.findUniqueOrThrow({ where: { id: serviceOrderId } });
  if (!order.currentStageInstanceId) return;

  const now = new Date();
  const instance = await tx.serviceOrderStageInstance.update({
    where: { id: order.currentStageInstanceId },
    data: { status: "CONCLUIDA", exitedAt: now },
    include: { stage: true },
  });
  await logHistoryEvent({
    serviceOrderId,
    type: "SAIDA_ETAPA",
    description: `Saída da etapa "${instance.stage.name}".`,
    userId,
    metadata: { stageInstanceId: instance.id, stageId: instance.stageId },
    tx,
  });
}

/** Avança a OS para a etapa seguinte (ou conclui a OS se não houver mais etapas). */
export async function advanceStage(serviceOrderId: string, userId?: string) {
  return prisma.$transaction(async (tx) => {
    await exitCurrentStage(serviceOrderId, tx, userId);

    const order = await tx.serviceOrder.findUniqueOrThrow({ where: { id: serviceOrderId } });
    const exitedInstance = await tx.serviceOrderStageInstance.findFirst({
      where: { serviceOrderId, status: "CONCLUIDA" },
      orderBy: { order: "desc" },
    });

    const next = await tx.serviceOrderStageInstance.findFirst({
      where: {
        serviceOrderId,
        status: "PENDENTE",
        order: { gt: exitedInstance?.order ?? 0 },
      },
      orderBy: { order: "asc" },
    });

    if (next) {
      await enterStage(serviceOrderId, next.id, tx, userId);
      return { completed: false };
    }

    // Não há mais etapas: conclui a Ordem de Serviço.
    await settleProductionMinutes(serviceOrderId, tx);
    await tx.serviceOrder.update({
      where: { id: serviceOrderId },
      data: { status: "CONCLUIDA", completedAt: new Date(), currentStageInstanceId: null },
    });
    await logHistoryEvent({
      serviceOrderId,
      type: "ALTERACAO_ESTADO",
      description: "Todas as etapas concluídas. Ordem de Serviço concluída.",
      userId,
      tx,
    });
    return { completed: true };
  });
}

/**
 * Regressa a uma etapa anterior já visitada. Cria uma nova instância dessa
 * etapa (nova passagem), inserida imediatamente a seguir à etapa atual, sem
 * alterar a linha de produção predefinida da categoria.
 */
export async function returnToStage(serviceOrderId: string, targetStageId: string, userId?: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.serviceOrder.findUniqueOrThrow({ where: { id: serviceOrderId } });
    const currentInstance = order.currentStageInstanceId
      ? await tx.serviceOrderStageInstance.findUnique({ where: { id: order.currentStageInstanceId } })
      : null;

    await exitCurrentStage(serviceOrderId, tx, userId);

    const stage = await tx.stage.findUniqueOrThrow({ where: { id: targetStageId } });
    const insertOrder = (currentInstance?.order ?? 0) + ORDER_STEP / 2;

    const newInstance = await tx.serviceOrderStageInstance.create({
      data: {
        serviceOrderId,
        stageId: targetStageId,
        order: insertOrder,
        status: "PENDENTE",
        wasManuallyAdded: true,
      },
    });

    await logHistoryEvent({
      serviceOrderId,
      type: "ALTERACAO_LINHA_PRODUCAO",
      description: `Regresso à etapa anterior "${stage.name}" (alteração pontual ao fluxo).`,
      userId,
      metadata: { stageInstanceId: newInstance.id, stageId: targetStageId },
      tx,
    });

    await enterStage(serviceOrderId, newInstance.id, tx, userId);
  });
}

/** Insere uma etapa adicional imediatamente a seguir à etapa atual (alteração pontual). */
export async function insertStage(serviceOrderId: string, stageId: string, userId?: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.serviceOrder.findUniqueOrThrow({ where: { id: serviceOrderId } });
    const referenceOrder =
      (order.currentStageInstanceId
        ? (await tx.serviceOrderStageInstance.findUnique({ where: { id: order.currentStageInstanceId } }))?.order
        : undefined) ?? 0;

    const nextInstance = await tx.serviceOrderStageInstance.findFirst({
      where: { serviceOrderId, order: { gt: referenceOrder } },
      orderBy: { order: "asc" },
    });
    const insertOrder = nextInstance
      ? (referenceOrder + nextInstance.order) / 2
      : referenceOrder + ORDER_STEP;

    const stage = await tx.stage.findUniqueOrThrow({ where: { id: stageId } });

    const instance = await tx.serviceOrderStageInstance.create({
      data: {
        serviceOrderId,
        stageId,
        order: insertOrder,
        status: "PENDENTE",
        wasManuallyAdded: true,
      },
    });

    await logHistoryEvent({
      serviceOrderId,
      type: "INSERCAO_ETAPA",
      description: `Etapa adicional "${stage.name}" inserida no fluxo desta Ordem de Serviço.`,
      userId,
      metadata: { stageInstanceId: instance.id, stageId },
      tx,
    });

    return instance;
  });
}

/** Omite uma etapa futura (ainda PENDENTE) do fluxo desta OS. */
export async function skipStage(serviceOrderId: string, stageInstanceId: string, userId?: string) {
  return prisma.$transaction(async (tx) => {
    const instance = await tx.serviceOrderStageInstance.findUniqueOrThrow({
      where: { id: stageInstanceId },
      include: { stage: true },
    });
    if (instance.serviceOrderId !== serviceOrderId) {
      throw new Error("Etapa não pertence a esta Ordem de Serviço.");
    }
    if (instance.status !== "PENDENTE") {
      throw new Error("Só é possível omitir etapas ainda não iniciadas.");
    }

    await tx.serviceOrderStageInstance.update({
      where: { id: stageInstanceId },
      data: { status: "OMITIDA", wasSkipped: true },
    });

    await logHistoryEvent({
      serviceOrderId,
      type: "OMISSAO_ETAPA",
      description: `Etapa "${instance.stage.name}" omitida do fluxo desta Ordem de Serviço.`,
      userId,
      metadata: { stageInstanceId, stageId: instance.stageId },
      tx,
    });
  });
}

/**
 * Retoma o fluxo produtivo predefinido da categoria a partir de uma etapa
 * escolhida ("Voltar à Linha de Produção"). Remove instâncias futuras ainda
 * PENDENTE (incluindo alterações pontuais) e recria a sequência predefinida
 * da categoria a partir da etapa indicada.
 */
export async function revertToDefaultLine(
  serviceOrderId: string,
  resumeFromStageId: string,
  userId?: string
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.serviceOrder.findUniqueOrThrow({ where: { id: serviceOrderId } });

    // Remove todas as instâncias futuras (PENDENTE) - a etapa ativa/concluída mantém-se.
    await tx.serviceOrderStageInstance.deleteMany({
      where: { serviceOrderId, status: "PENDENTE" },
    });

    const lineSteps = await tx.productionLineStep.findMany({
      where: { categoryId: order.categoryId },
      orderBy: { order: "asc" },
    });
    const resumeIndex = lineSteps.findIndex((s) => s.stageId === resumeFromStageId);
    if (resumeIndex === -1) {
      throw new Error("A etapa indicada não pertence à linha de produção predefinida desta categoria.");
    }

    const currentInstance = order.currentStageInstanceId
      ? await tx.serviceOrderStageInstance.findUnique({ where: { id: order.currentStageInstanceId } })
      : null;
    let cursor = currentInstance?.order ?? 0;

    for (const step of lineSteps.slice(resumeIndex)) {
      cursor += ORDER_STEP;
      await tx.serviceOrderStageInstance.create({
        data: {
          serviceOrderId,
          stageId: step.stageId,
          order: cursor,
          supplierId: step.defaultSupplierId,
          status: "PENDENTE",
        },
      });
    }

    const stage = await tx.stage.findUniqueOrThrow({ where: { id: resumeFromStageId } });
    await logHistoryEvent({
      serviceOrderId,
      type: "ALTERACAO_LINHA_PRODUCAO",
      description: `Fluxo retomado na linha de produção predefinida a partir da etapa "${stage.name}".`,
      userId,
      tx,
    });
  });
}
