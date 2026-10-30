import { prisma } from "../config/prisma";
import { advanceStage, enterFirstStage, insertStage } from "./stageFlowService";
import { startProduction } from "./timeTrackingService";
import { logHistoryEvent } from "./historyService";

// ============================================================================
// Guias da Lacagem — pedido do utilizador de 2026-10-30: "faz um botão onde
// possa submeter a guia como está aqui e ele passa para a lacagem ou tira da
// lacagem, pondo a guia da lacagem".
//
// 1. analyzeGuiaText: recebe o texto da guia (lido do PDF no servidor ou da
//    fotografia por OCR no browser) e encontra o nº da guia, o fornecedor e
//    as Ordens de Serviço referidas ("Referente a: Ordem Serviço 2026/438,
//    …" e "N/ Ref.: 2026/438" em cada linha). Só conta números que existem
//    de facto como OS — o OCR de uma foto às vezes inventa algarismos.
// 2. applyGuia: envia para a Lacagem (avança a OS até à etapa Lacagem e
//    define o fornecedor) ou retira da Lacagem (sai da etapa Lacagem), e
//    anexa a guia a cada OS, com registo no histórico.
// ============================================================================

export const LACAGEM_STAGE = "Lacagem";

export type GuiaDirection = "enviar" | "retirar";

const OS_NUMBER = /\b(20\d{2})\s*\/\s*(\d{1,4})\b/g;

function normalize(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Nº da própria guia (ex.: "130 2026/170 - Pagina 1 de 2", ou na caixa "Guia de transporte"), para não o confundir com uma OS. */
function findGuiaNumber(text: string): string | null {
  const byFooter = text.match(/\b\d{2,3}\s+(20\d{2}\/\d{1,5})\s*-\s*P[aá]gina/i);
  if (byFooter) return byFooter[1];
  const atcud = text.match(/ATCUD:\s*[A-Z0-9]+-(\d{1,5})/i);
  const year = text.match(/\b(20\d{2})-\d{2}-\d{2}/);
  if (atcud && year) return `${year[1]}/${atcud[1]}`;
  return null;
}

function findDocumentKind(text: string): GuiaDirection | null {
  const t = normalize(text);
  if (/guia de transporte a fornecedor|transporte a fornecedor/.test(t)) return "enviar";
  if (/guia de remessa|guia de devolucao/.test(t) && !/minho ?ferragens/.test(t.slice(0, 300))) return "retirar";
  return null;
}

export async function analyzeGuiaText(text: string) {
  const guiaNumber = findGuiaNumber(text);

  // Números com contexto forte (Ordem Serviço …, N/ Ref., V/ Ref.) e os
  // restantes números "AAAA/NNN" do texto; ambos só contam se a OS existir.
  const strong = new Set<string>();
  const all = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const nline = normalize(line);
    const encomenda = /encomenda/.test(nline);
    for (const m of line.matchAll(OS_NUMBER)) {
      const id = `${m[1]}/${m[2]}`;
      if (id === guiaNumber) continue;
      const before = nline.slice(Math.max(0, (m.index ?? 0) - 25), m.index ?? 0);
      if (/encomenda/.test(before)) continue;
      all.add(id);
      if (/ordem|serv|ref/.test(before) && !encomenda) strong.add(id);
    }
  }

  const candidates = Array.from(all);
  const orders = candidates.length
    ? await prisma.serviceOrder.findMany({
        where: { externalId: { in: candidates } },
        include: {
          client: true,
          product: true,
          currentStageInstance: { include: { stage: true, supplier: true } },
        },
      })
    : [];
  const found = new Set(orders.map((o) => o.externalId));

  const suppliers = await prisma.supplier.findMany({ orderBy: { name: "asc" } });
  const ntext = normalize(text);
  const supplier =
    suppliers.find((s) => {
      const name = normalize(s.name).replace(/\b(lda|sa|unipessoal)\b\.?/g, "").trim();
      return name.length >= 3 && ntext.includes(name);
    }) ?? null;

  const documentKind = findDocumentKind(text);

  const result = orders
    .map((o) => {
      const stage = o.currentStageInstance?.stage.name ?? null;
      const inLacagem = stage === LACAGEM_STAGE;
      return {
        id: o.id,
        externalId: o.externalId,
        status: o.status,
        client: o.client.name,
        product: o.product.name,
        currentStage: stage,
        currentSupplier: o.currentStageInstance?.supplier?.name ?? null,
        inLacagem,
        confident: strong.has(o.externalId),
      };
    })
    .sort((a, b) => a.externalId.localeCompare(b.externalId, "pt-PT", { numeric: true }));

  // Sugestão: o tipo de documento manda; senão, se todas já estão na
  // Lacagem é para as retirar, caso contrário é para as enviar.
  const suggestedDirection: GuiaDirection =
    documentKind ??
    (result.length > 0 && result.every((r) => r.inLacagem) ? "retirar" : "enviar");

  return {
    guiaNumber,
    supplierId: supplier?.id ?? null,
    supplierName: supplier?.name ?? null,
    suggestedDirection,
    orders: result,
    notFound: candidates.filter((c) => !found.has(c) && strong.has(c)),
  };
}

export interface GuiaFile {
  filename: string;
  mimeType: string;
  data: Buffer;
}

export interface ApplyGuiaInput {
  direction: GuiaDirection;
  orderIds: string[];
  supplierId?: string | null;
  guiaNumber?: string | null;
  notes?: Record<string, string>;
  files: GuiaFile[];
  userId?: string;
}

async function current(orderId: string) {
  return prisma.serviceOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: { currentStageInstance: { include: { stage: true, supplier: true } } },
  });
}

/** Leva a OS até à etapa Lacagem (inicia a produção se for preciso). */
async function sendToLacagem(orderId: string, userId?: string) {
  let order = await current(orderId);
  if (order.status === "CONCLUIDA" || order.status === "CANCELADA") {
    throw new Error(`A OS está ${order.status === "CONCLUIDA" ? "concluída" : "cancelada"}.`);
  }
  if (order.status === "NAO_INICIADA") {
    await startProduction(orderId, userId);
    await enterFirstStage(orderId, userId);
    order = await current(orderId);
  }
  if (order.currentStageInstance?.stage.name === LACAGEM_STAGE) return { already: true };

  const curOrder = order.currentStageInstance?.order ?? 0;
  const lacagemAhead = await prisma.serviceOrderStageInstance.findFirst({
    where: { serviceOrderId: orderId, status: "PENDENTE", order: { gt: curOrder }, stage: { name: LACAGEM_STAGE } },
  });
  if (!lacagemAhead) {
    const stage = await prisma.stage.findFirst({ where: { name: LACAGEM_STAGE } });
    if (!stage) throw new Error('Não existe a etapa "Lacagem".');
    await insertStage(orderId, stage.id, userId);
  }
  for (let i = 0; i < 20; i++) {
    order = await current(orderId);
    if (!order.currentStageInstance || order.currentStageInstance.stage.name === LACAGEM_STAGE) break;
    const r = await advanceStage(orderId, userId);
    if (r.completed) throw new Error("A OS ficou concluída antes de chegar à Lacagem.");
  }
  order = await current(orderId);
  if (order.currentStageInstance?.stage.name !== LACAGEM_STAGE) {
    throw new Error("Não foi possível levar a OS até à Lacagem.");
  }
  return { already: false };
}

export async function applyGuia(input: ApplyGuiaInput) {
  const supplier = input.supplierId
    ? await prisma.supplier.findUnique({ where: { id: input.supplierId } })
    : null;
  const guiaLabel = input.guiaNumber ? `guia ${input.guiaNumber}` : "guia";
  const results: { id: string; externalId: string; ok: boolean; message: string }[] = [];

  for (const orderId of input.orderIds) {
    const before = await prisma.serviceOrder.findUnique({
      where: { id: orderId },
      include: { currentStageInstance: { include: { stage: true } } },
    });
    if (!before) {
      results.push({ id: orderId, externalId: "?", ok: false, message: "OS não encontrada." });
      continue;
    }
    try {
      let message: string;
      if (input.direction === "enviar") {
        const { already } = await sendToLacagem(orderId, input.userId);
        const after = await current(orderId);
        if (supplier && after.currentStageInstanceId && after.currentStageInstance?.supplierId !== supplier.id) {
          await prisma.serviceOrderStageInstance.update({
            where: { id: after.currentStageInstanceId },
            data: { supplierId: supplier.id },
          });
        }
        message = already
          ? `Já estava na Lacagem${supplier ? ` (${supplier.name})` : ""}.`
          : `Passou de "${before.currentStageInstance?.stage.name ?? "Não iniciada"}" para a Lacagem${supplier ? ` (${supplier.name})` : ""}.`;
        await logHistoryEvent({
          serviceOrderId: orderId,
          type: "ENVIO_TRABALHO_EXTERNO",
          description: `Enviada para a Lacagem${supplier ? ` (${supplier.name})` : ""} pela ${guiaLabel}.${input.notes?.[orderId] ? ` ${input.notes[orderId]}` : ""}`,
          userId: input.userId,
          metadata: { guia: input.guiaNumber ?? null, supplierId: supplier?.id ?? null },
        });
      } else {
        if (before.currentStageInstance?.stage.name !== LACAGEM_STAGE) {
          throw new Error(`Não está na Lacagem (etapa atual: ${before.currentStageInstance?.stage.name ?? "nenhuma"}).`);
        }
        const r = await advanceStage(orderId, input.userId);
        const after = await current(orderId);
        message = r.completed
          ? "Saiu da Lacagem e ficou concluída."
          : `Saiu da Lacagem para "${after.currentStageInstance?.stage.name ?? "—"}".`;
        await logHistoryEvent({
          serviceOrderId: orderId,
          type: "RETORNO_TRABALHO_EXTERNO",
          description: `Recebida da Lacagem pela ${guiaLabel}.${input.notes?.[orderId] ? ` ${input.notes[orderId]}` : ""}`,
          userId: input.userId,
          metadata: { guia: input.guiaNumber ?? null },
        });
      }

      // A guia fica anexada à OS (todas as páginas).
      for (const f of input.files) {
        await prisma.attachment.create({
          data: {
            serviceOrderId: orderId,
            filename: f.filename,
            mimeType: f.mimeType,
            size: f.data.length,
            data: f.data,
            uploadedById: input.userId,
          },
        });
      }
      if (input.files.length) {
        await logHistoryEvent({
          serviceOrderId: orderId,
          type: "OUTRA_ALTERACAO",
          description: `Anexada a ${guiaLabel} da Lacagem (${input.files.length} ficheiro${input.files.length > 1 ? "s" : ""}).`,
          userId: input.userId,
        });
      }
      results.push({ id: orderId, externalId: before.externalId, ok: true, message });
    } catch (err) {
      results.push({
        id: orderId,
        externalId: before.externalId,
        ok: false,
        message: err instanceof Error ? err.message : "Erro.",
      });
    }
  }
  return results;
}
