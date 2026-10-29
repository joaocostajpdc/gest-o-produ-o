import { prisma } from "../config/prisma";
import { parseOrdemServicoPdf } from "../services/goldylocksPdfParser";
import { logHistoryEvent } from "../services/historyService";

// ============================================================================
// Releitura pontual (pedido do utilizador de 2026-10-29: "não quero colocar
// as medidas à mão, quero uma melhor leitura das dimensões … e dos
// acabamentos"). As OS ainda abertas que têm o PDF da Ordem Serviço guardado
// voltam a ser lidas com a leitura melhorada, para ficarem já com as
// dimensões e acabamentos certos. Corre uma só vez (marca em app_settings).
// ============================================================================

const DONE_KEY = "reread_pdfs_20261029";

export async function rereadPdfs20261029(): Promise<void> {
  try {
    if (await prisma.appSetting.findUnique({ where: { key: DONE_KEY } })) return;
    await prisma.appSetting.deleteMany({ where: { key: "debug_pdf_text" } });

    const atts = await prisma.attachment.findMany({
      where: {
        mimeType: "application/pdf",
        filename: { startsWith: "Ordem Serviço" },
        serviceOrder: { status: { in: ["NAO_INICIADA", "EM_PRODUCAO", "SUSPENSA"] } },
      },
      select: { data: true, serviceOrder: { select: { id: true, externalId: true, specifications: true } } },
    });
    const changed: string[] = [];
    for (const a of atts) {
      try {
        const g = await parseOrdemServicoPdf(Buffer.from(a.data), { medidas: true });
        if (g.externalId !== a.serviceOrder.externalId || !g.notes) continue;
        if ((a.serviceOrder.specifications ?? "").trim() === g.notes.trim()) continue;
        await prisma.serviceOrder.update({ where: { id: a.serviceOrder.id }, data: { specifications: g.notes } });
        await logHistoryEvent({
          serviceOrderId: a.serviceOrder.id,
          type: "OUTRA_ALTERACAO",
          description: "Características do Produto lidas de novo do PDF (leitura melhorada das dimensões e acabamentos).",
        });
        changed.push(g.externalId);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[reler PDFs] ${a.serviceOrder.externalId} falhou:`, (err as Error).message);
      }
    }
    await prisma.appSetting.create({ data: { key: DONE_KEY, value: { at: new Date().toISOString(), changed } } });
    // eslint-disable-next-line no-console
    console.log(`[reler PDFs] ${changed.length} OS atualizadas: ${changed.join(", ")}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[reler PDFs] falhou", err);
  }
}
