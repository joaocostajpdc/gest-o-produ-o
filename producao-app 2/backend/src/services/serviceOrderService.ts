import { prisma } from "../config/prisma";
import { getGoldylocksAdapter } from "../integrations/goldylocks/factory";
import { GoldylocksServiceOrder } from "../integrations/goldylocks/types";
import { logHistoryEvent } from "./historyService";
import { initializeStageInstances } from "./stageFlowService";

// ============================================================================
// Serviço de Ordens de Serviço
//
// As Ordens de Serviço são criadas no Goldylocks; este serviço trata da
// importação para a aplicação de produção (associação a cliente/produto já
// existentes, cálculo da data-limite a partir do prazo padrão da categoria,
// e inicialização da linha de etapas).
//
// A criação de uma única Ordem de Serviço a partir dos dados do Goldylocks
// (`importSingleGoldylocksOrder`) é partilhada por dois caminhos de
// importação: em lote, via adaptador (mock ou API real do Goldylocks), e
// individualmente, a partir de um PDF de "Ordem Serviço" carregado pelo
// utilizador (ver `goldylocksPdfParser.ts`).
// ============================================================================

export type ImportResult =
  | { status: "created"; externalId: string }
  | { status: "skipped"; externalId: string; reason: string };

export async function importSingleGoldylocksOrder(
  goldOrder: GoldylocksServiceOrder,
  actingUserId?: string
): Promise<ImportResult> {
  const product = await prisma.product.findUnique({
    where: { externalId: goldOrder.product.externalId },
    include: { category: true },
  });

  if (!product) {
    return {
      status: "skipped",
      externalId: goldOrder.externalId,
      reason: `Produto "${goldOrder.product.name}" (${goldOrder.product.externalId}) não está configurado na aplicação.`,
    };
  }

  const client = await prisma.client.upsert({
    where: { externalId: goldOrder.client.externalId },
    update: { name: goldOrder.client.name, taxNumber: goldOrder.client.taxNumber, syncedAt: new Date() },
    create: {
      externalId: goldOrder.client.externalId,
      name: goldOrder.client.name,
      taxNumber: goldOrder.client.taxNumber,
      email: goldOrder.client.email,
      phone: goldOrder.client.phone,
    },
  });

  const existing = await prisma.serviceOrder.findUnique({ where: { externalId: goldOrder.externalId } });
  if (existing) {
    return { status: "skipped", externalId: goldOrder.externalId, reason: "Já importada anteriormente." };
  }

  const now = new Date();
  const deadlineAt = new Date(now.getTime() + product.category.defaultProductionHours * 60 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    const order = await tx.serviceOrder.create({
      data: {
        externalId: goldOrder.externalId,
        clientId: client.id,
        productId: product.id,
        categoryId: product.categoryId,
        status: "NAO_INICIADA",
        deadlineAt,
      },
    });

    await initializeStageInstances(order.id, product.categoryId, tx);

    // Especificações desta encomenda (Modelo, Dimensões, Acabamento,
    // Enchimento, referência à Encomenda Cliente, etc.), tal como vieram
    // da Ordem Serviço do Goldylocks — guardadas como Observação inicial
    // em vez de campos estruturados próprios (decisão tomada por não
    // exigir alterações ao modelo de dados por agora).
    if (goldOrder.notes && actingUserId) {
      await tx.observation.create({
        data: { serviceOrderId: order.id, text: goldOrder.notes, userId: actingUserId },
      });
    }

    await logHistoryEvent({
      serviceOrderId: order.id,
      type: "CRIACAO",
      description: `Ordem de Serviço "${order.externalId}" importada do Goldylocks para o cliente "${client.name}".`,
      userId: actingUserId,
      tx,
    });
  });

  return { status: "created", externalId: goldOrder.externalId };
}

/**
 * Importa as Ordens de Serviço novas disponibilizadas pelo Goldylocks (em
 * lote, através do adaptador configurado — mock ou API real).
 */
export async function importPendingServiceOrders(actingUserId?: string) {
  const adapter = getGoldylocksAdapter();
  const pending = await adapter.fetchNewServiceOrders();

  const created: string[] = [];
  const skipped: { externalId: string; reason: string }[] = [];

  for (const goldOrder of pending) {
    const result = await importSingleGoldylocksOrder(goldOrder, actingUserId);
    if (result.status === "created") created.push(result.externalId);
    else skipped.push({ externalId: result.externalId, reason: result.reason });
  }

  return { created, skipped };
}

export async function cancelServiceOrder(serviceOrderId: string, reason: string, userId?: string) {
  return prisma.$transaction(async (tx) => {
    await tx.serviceOrder.update({
      where: { id: serviceOrderId },
      data: { status: "CANCELADA" },
    });
    await logHistoryEvent({
      serviceOrderId,
      type: "ALTERACAO_ESTADO",
      description: `Ordem de Serviço cancelada. Motivo: ${reason}`,
      userId,
      tx,
    });
  });
}
