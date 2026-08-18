import { Prisma, ServiceOrder } from "@prisma/client";
import { prisma } from "../config/prisma";
import { logHistoryEvent } from "./historyService";

// ============================================================================
// Serviço de Cronometragem
//
// Implementa a distinção entre:
//   - Tempo de Produção: tempo efetivamente contabilizado como produção,
//     excluindo períodos de suspensão.
//   - Tempo de Permanência (por etapa): tempo total desde a entrada até à
//     saída de uma etapa, independentemente de a produção estar ativa ou
//     suspensa.
//
// A OS acumula `productionMinutes` sempre que está em produção; quando está
// EM_PRODUCAO, `lastResumedAt` marca o início do troço em curso, que é
// somado a `productionMinutes` no cálculo em tempo real (ver
// `getCurrentProductionMinutes`) e consolidado sempre que a produção pára
// (suspensão, conclusão ou cancelamento).
// ============================================================================

function diffMinutes(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));
}

/** Tempo de produção acumulado até este momento (inclui o troço em curso, se ativo). */
export function getCurrentProductionMinutes(order: ServiceOrder, now: Date = new Date()): number {
  if (order.status === "EM_PRODUCAO" && order.lastResumedAt) {
    return order.productionMinutes + diffMinutes(order.lastResumedAt, now);
  }
  return order.productionMinutes;
}

/** Tempo de permanência na etapa atual (desde a entrada até agora, ou até à saída). */
export function getStageResidenceMinutes(
  stageInstance: { enteredAt: Date | null; exitedAt: Date | null },
  now: Date = new Date()
): number {
  if (!stageInstance.enteredAt) return 0;
  const end = stageInstance.exitedAt ?? now;
  return diffMinutes(stageInstance.enteredAt, end);
}

/** Inicia a produção de uma OS (transição Não Iniciada -> Em Produção). */
export async function startProduction(serviceOrderId: string, userId?: string) {
  const now = new Date();
  const order = await prisma.serviceOrder.update({
    where: { id: serviceOrderId },
    data: { status: "EM_PRODUCAO", startedAt: now, lastResumedAt: now },
  });
  await logHistoryEvent({
    serviceOrderId,
    type: "ALTERACAO_ESTADO",
    description: "Produção iniciada.",
    userId,
  });
  return order;
}

/** Consolida o troço de produção em curso na OS (soma à productionMinutes acumulada). */
export async function settleProductionMinutes(
  serviceOrderId: string,
  tx: Prisma.TransactionClient,
  now: Date = new Date()
) {
  const order = await tx.serviceOrder.findUniqueOrThrow({ where: { id: serviceOrderId } });
  if (order.status === "EM_PRODUCAO" && order.lastResumedAt) {
    const extra = diffMinutes(order.lastResumedAt, now);
    await tx.serviceOrder.update({
      where: { id: serviceOrderId },
      data: { productionMinutes: order.productionMinutes + extra, lastResumedAt: null },
    });
  }
}
