import PDFDocument from "pdfkit";
import { LOGO_MARK_PNG_BASE64 } from "../assets/logoMark";

// ============================================================================
// PDF dos avisos semanais (pedido do utilizador de 2026-10-24: "este aviso
// quero que seja em PDF"). A4 ao baixo, uma tabela por secção, cabeçalho da
// tabela repetido quando muda de página e números de página no rodapé.
// ============================================================================

export interface ReportSection {
  title: string;
  tone?: "danger" | "muted";
  headers: string[];
  widths: number[];
  rows: string[][];
  lateRows?: boolean[];
  empty?: string;
}

const C = {
  ink: "#161b2c",
  muted: "#667085",
  border: "#e2e4e9",
  head: "#1b2033",
  alt: "#f6f7fa",
  primary: "#1f3fe0",
  danger: "#dc2626",
};

export function renderReportPdf(opts: { title: string; subtitle: string; sections: ReportSection[]; link?: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const L = doc.page.margins.left;
    const R = doc.page.width - doc.page.margins.right;
    const W = R - L;
    const bottom = () => doc.page.height - doc.page.margins.bottom - 18;

    // Cabeçalho
    try {
      doc.image(Buffer.from(LOGO_MARK_PNG_BASE64, "base64"), L, 30, { height: 30 });
    } catch {
      /* sem logótipo */
    }
    doc.font("Helvetica-Bold").fontSize(10).fillColor(C.primary).text("MINHO FERRAGENS", L + 40, 34);
    doc.font("Helvetica").fontSize(8).fillColor(C.muted).text("Central · aviso semanal", L + 40, 47);
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(C.muted)
      .text(`Gerado em ${new Date().toLocaleString("pt-PT", { timeZone: "Europe/Lisbon" })}`, L, 36, { width: W, align: "right" });
    doc.font("Helvetica-Bold").fontSize(17).fillColor(C.ink).text(opts.title, L, 74, { width: W });
    doc.font("Helvetica").fontSize(10.5).fillColor(C.muted).text(opts.subtitle, L, doc.y + 2, { width: W });
    doc.moveTo(L, doc.y + 8).lineTo(R, doc.y + 8).strokeColor(C.border).lineWidth(1).stroke();
    doc.y += 18;

    for (const sec of opts.sections) {
      const scale = W / sec.widths.reduce((a, b) => a + b, 0);
      const ws = sec.widths.map((w) => w * scale);
      const headH = 20;

      const drawHead = () => {
        const y = doc.y;
        doc.rect(L, y, W, headH).fill(C.head);
        let x = L;
        doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff");
        sec.headers.forEach((h, i) => {
          doc.text(h.toUpperCase(), x + 6, y + 6.5, { width: ws[i] - 10, lineBreak: false, ellipsis: true });
          x += ws[i];
        });
        doc.y = y + headH;
      };

      if (doc.y + 26 + headH + 22 > bottom()) doc.addPage();
      const titleColor = sec.tone === "danger" ? C.danger : sec.tone === "muted" ? C.muted : C.ink;
      doc.font("Helvetica-Bold").fontSize(12).fillColor(titleColor).text(sec.title, L, doc.y, { width: W });
      doc.y += 5;

      if (!sec.rows.length) {
        doc.font("Helvetica").fontSize(10).fillColor(C.muted).text(sec.empty ?? "Sem registos.", L, doc.y, { width: W });
        doc.y += 14;
        continue;
      }
      drawHead();
      sec.rows.forEach((row, ri) => {
        doc.font("Helvetica").fontSize(9.5);
        const hs = row.map((v, i) => doc.heightOfString(v || "—", { width: ws[i] - 10 }));
        const rh = Math.max(20, Math.max(...hs) + 10);
        if (doc.y + rh > bottom()) {
          doc.addPage();
          drawHead();
        }
        const y = doc.y;
        if (ri % 2) doc.rect(L, y, W, rh).fill(C.alt);
        const late = sec.tone === "danger" || !!sec.lateRows?.[ri];
        let x = L;
        row.forEach((v, i) => {
          const isLast = i === row.length - 1;
          const bold = i === 0 || isLast;
          doc
            .font(bold ? "Helvetica-Bold" : "Helvetica")
            .fontSize(9.5)
            .fillColor(isLast && late ? C.danger : i === 0 ? C.primary : C.ink)
            .text(v || "—", x + 6, y + 5.5, { width: ws[i] - 10 });
          x += ws[i];
        });
        doc.moveTo(L, y + rh).lineTo(R, y + rh).strokeColor(C.border).lineWidth(0.5).stroke();
        doc.y = y + rh;
      });
      doc.y += 16;
    }

    // Rodapé com páginas
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const y = doc.page.height - doc.page.margins.bottom - 10;
      doc.font("Helvetica").fontSize(7.5).fillColor(C.muted);
      if (opts.link) doc.text(opts.link, L, y, { width: W / 2, lineBreak: false });
      doc.text(`Página ${i - range.start + 1} de ${range.count}`, L, y, { width: W, align: "right", lineBreak: false });
    }
    doc.end();
  });
}
