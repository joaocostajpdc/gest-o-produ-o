import { prisma } from "../config/prisma";
import { GoldylocksServiceOrder } from "../integrations/goldylocks/types";
import { importSingleGoldylocksOrder } from "../services/serviceOrderService";
import { advanceStage, enterFirstStage } from "../services/stageFlowService";
import { startProduction } from "../services/timeTrackingService";
import { logHistoryEvent } from "../services/historyService";

// ============================================================================
// Lançamento pontual das OS 2026/557 e 2026/558 — pedido do utilizador de
// 2026-10-29 (com os PDFs das duas OS): "lança já … esta ordem de serviço
// foi para a lacagem nesse mesmo dia — Alumiasas".
//
// Importa as duas OS (dados lidos dos PDFs pelo goldylocksPdfParser), inicia
// a produção e avança até à Lacagem com o fornecedor Alumiasas, com as datas
// acertadas para o próprio dia da OS (27/10/2026). Corre no arranque e é
// seguro repetir: uma OS que já esteja na Lacagem (ou mais à frente) não é
// tocada.
// ============================================================================

const ORDERS: GoldylocksServiceOrder[] = [
  {
    externalId: "2026/557",
    client: { externalId: "134", name: "JPDC - MYNHOFERRAGENS LDA", taxNumber: "515854662" },
    product: { externalId: "DCLP000", name: "Lacagem de Perfis/Acessórios" },
    createdAt: "2026-10-27T13:29:10Z",
    notes: "Quant.: 1,00 uni\n23 c/2400; 6 c/2000; 6 c/1800; 2 c/1000;\nLacar 7016 Txt fino;\npefis portas inovalu",
  },
  {
    externalId: "2026/558",
    client: { externalId: "57", name: "JOSE DIONISIO GOMES COELHO", taxNumber: "253483549" },
    product: { externalId: "DCLP000", name: "Lacagem de Perfis/Acessórios" },
    createdAt: "2026-10-27T13:51:32Z",
    notes: "Quant.: 1,00 uni\n1 un c/1500\n1un c/1650",
  },
];

const TARGET_STAGE = "Lacagem";
const SUPPLIER = "Alumiasas";

async function currentStageName(id: string) {
  const o = await prisma.serviceOrder.findUnique({
    where: { id },
    include: { currentStageInstance: { include: { stage: true } } },
  });
  return { status: o?.status, stage: o?.currentStageInstance?.stage.name ?? null, instanceId: o?.currentStageInstanceId ?? null };
}

export async function launchOS20261029(): Promise<void> {
  for (const g of ORDERS) {
    try {
      const r = await importSingleGoldylocksOrder(g);
      const order = await prisma.serviceOrder.findUnique({ where: { externalId: g.externalId } });
      if (!order) {
        // eslint-disable-next-line no-console
        console.warn(`[lançar ${g.externalId}] não importada: ${r.status === "skipped" ? r.reason : "?"}`);
        continue;
      }
      if (order.status !== "NAO_INICIADA") continue; // já foi tratada (agora ou à mão)

      const day = new Date(g.createdAt);
      await startProduction(order.id);
      await enterFirstStage(order.id);
      for (let i = 0; i < 10; i++) {
        const cur = await currentStageName(order.id);
        if (!cur.stage || cur.stage === TARGET_STAGE) break;
        await advanceStage(order.id);
      }

      const cur = await currentStageName(order.id);
      const supplier = await prisma.supplier.findFirst({ where: { name: { equals: SUPPLIER, mode: "insensitive" } } });
      if (cur.stage === TARGET_STAGE && cur.instanceId && supplier) {
        await prisma.serviceOrderStageInstance.update({ where: { id: cur.instanceId }, data: { supplierId: supplier.id } });
        await logHistoryEvent({
          serviceOrderId: order.id,
          type: "OUTRA_ALTERACAO",
          description: `Fornecedor da etapa "${TARGET_STAGE}" definido para "${supplier.name}".`,
        });
      }

      // Datas do próprio dia da OS: foi para a lacagem nesse mesmo dia.
      await prisma.serviceOrder.update({ where: { id: order.id }, data: { startedAt: day, lastResumedAt: day } });
      await prisma.serviceOrderStageInstance.updateMany({
        where: { serviceOrderId: order.id, status: "CONCLUIDA" },
        data: { enteredAt: day, exitedAt: day },
      });
      if (cur.instanceId) {
        await prisma.serviceOrderStageInstance.update({ where: { id: cur.instanceId }, data: { enteredAt: day } });
      }
      await logHistoryEvent({
        serviceOrderId: order.id,
        type: "OUTRA_ALTERACAO",
        description: `Lançada a pedido do administrador: enviada para a ${TARGET_STAGE} (${SUPPLIER}) no próprio dia da OS, ${day.toLocaleDateString("pt-PT")}.`,
      });
      // eslint-disable-next-line no-console
      console.log(`[lançar ${g.externalId}] ok — etapa atual: ${cur.stage}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[lançar ${g.externalId}] falhou`, err);
    }
  }
}
