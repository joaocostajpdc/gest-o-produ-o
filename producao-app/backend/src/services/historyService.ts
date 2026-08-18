import { HistoryEventType, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";

// ============================================================================
// Serviço de Histórico Global da Ordem de Serviço
//
// Centraliza a criação de eventos de histórico para garantir que todos os
// pontos da aplicação registam consistentemente: data, hora, utilizador,
// tipo de evento e informação relativa à alteração efetuada.
// ============================================================================

interface LogEventInput {
  serviceOrderId: string;
  type: HistoryEventType;
  description: string;
  userId?: string | null;
  metadata?: Prisma.InputJsonValue;
  tx?: Prisma.TransactionClient;
}

export async function logHistoryEvent({
  serviceOrderId,
  type,
  description,
  userId,
  metadata,
  tx,
}: LogEventInput) {
  const client = tx ?? prisma;
  return client.historyEvent.create({
    data: {
      serviceOrderId,
      type,
      description,
      userId: userId ?? undefined,
      metadata,
    },
  });
}

export async function getServiceOrderHistory(serviceOrderId: string) {
  return prisma.historyEvent.findMany({
    where: { serviceOrderId },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, name: true, role: true } } },
  });
}
