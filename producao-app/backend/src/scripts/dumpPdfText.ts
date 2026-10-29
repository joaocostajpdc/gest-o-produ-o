import pdfParse from "pdf-parse";
import { prisma } from "../config/prisma";
import { renderPageWithColumns } from "../services/goldylocksPdfParser";

// ============================================================================
// Diagnóstico temporário (2026-10-29): guarda o texto (com colunas) dos PDFs
// de Ordem Serviço já anexados às OS, para afinar a leitura das dimensões e
// acabamentos com documentos reais. Só corre com DUMP_PDF_TEXT=1 e escreve
// em app_settings ("debug_pdf_text"). Não altera nenhuma OS.
// ============================================================================

export async function dumpPdfText(): Promise<void> {
  if (process.env.DUMP_PDF_TEXT !== "1") return;
  try {
    const atts = await prisma.attachment.findMany({
      where: { mimeType: "application/pdf", filename: { startsWith: "Ordem Serviço" } },
      select: { filename: true, data: true },
      orderBy: { createdAt: "desc" },
    });
    const out: Record<string, string> = {};
    for (const a of atts) {
      try {
        const d = await pdfParse(Buffer.from(a.data), { pagerender: renderPageWithColumns });
        const t = d.text;
        const start = t.indexOf("Cod.");
        const end = t.search(/\n\s*ATCUD/);
        out[a.filename] = t.slice(start >= 0 ? start : 0, end > 0 ? end : undefined);
      } catch (e) {
        out[a.filename] = `ERRO: ${(e as Error).message}`;
      }
    }
    await prisma.appSetting.upsert({
      where: { key: "debug_pdf_text" },
      create: { key: "debug_pdf_text", value: out },
      update: { value: out },
    });
    // eslint-disable-next-line no-console
    console.log(`[dump pdf] ${Object.keys(out).length} PDFs`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[dump pdf] falhou", err);
  }
}
