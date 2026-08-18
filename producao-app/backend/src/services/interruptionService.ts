import { InterruptionReason } from "@prisma/client";
import { prisma } from "../config/prisma";
import { logHistoryEvent } from "./historyService";
import { settleProductionMinutes } from "./timeTrackingService";

// ============================================================================
// Serviço de Interrupções de Produção
//
// Sempre que uma interrupção é registada, o motivo é obrigatório (lista
// pré-configurada; "Outro" exige descrição adicional). A interrupção
// suspende a contagem do tempo de produção (mas não o tempo de permanência
// na etapa) e fica associada ao histórico da respetiva Ordem de Serviço.
// ============================================================================

interface StartInterruptionInput {
  serviceOrderId: string;
  reason: InterruptionReason;
  otherDescription?: string;
  userId: string;
}

export async function startInterruption({
  serviceOrderId,
  reason,
  otherDescription,
  userId,
}: StartInterruptionInput) {
  if (reason === "OUTRO" && !otherDescription?.trim()) {
    throw new Error('É obrigatório indicar uma descrição quando o motivo é "Outro".');
  }

  return prisma.$transaction(async (tx) => {
    const order = await tx.serviceOrder.findUniqueOrThrow({ where: { id: serviceOrderId } });
    if (order.status !== "EM_PRODUCAO") {
      throw new Error("Só é possível registar uma interrupção numa OS em produção.");
    }

    await settleProductionMinutes(serviceOrderId, tx);

    const interruption = await tx.interruption.create({
      data: { serviceOrderId, reason, otherDescription, userId },
    });

    await tx.serviceOrder.update({
      where: { id: serviceOrderId },
      data: { status: "SUSPENSA" },
    });

    await logHistoryEvent({
      serviceOrderId,
      type: "INICIO_INTERRUPCAO",
      description: `Interrupção iniciada. Motivo: ${reason}${otherDescription ? ` (${otherDescription})` : ""}.`,
      userId,
      metadata: { interruptionId: interruption.id, reason, otherDescription: otherDescription ?? null },
      tx,
    });

    return interruption;
  });
}

export async function endInterruption(interruptionId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const interruption = await tx.interruption.findUniqueOrThrow({ where: { id: interruptionId } });
    if (interruption.endedAt) {
      throw new Error("Esta interrupção já foi terminada.");
    }
    const now = new Date();
    const durationMinutes = Math.round((now.getTime() - interruption.startedAt.getTime()) / 60000);

    const updated = await tx.interruption.update({
      where: { id: interruptionId },
      data: { endedAt: now, durationMinutes },
    });

    await tx.serviceOrder.update({
      where: { id: interruption.serviceOrderId },
      data: { status: "EM_PRODUCAO", lastResumedAt: now },
    });

    await logHistoryEvent({
      serviceOrderId: interruption.serviceOrderId,
      type: "FIM_INTERRUPCAO",
      description: `Interrupção terminada (duração: ${durationMinutes} min). Produção retomada.`,
      userId,
      metadata: { interruptionId, durationMinutes },
      tx,
    });

    return updated;
  });
}
