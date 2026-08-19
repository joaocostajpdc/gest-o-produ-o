import PDFDocument from "pdfkit";
import { Response } from "express";
import { PriorityLevel, PRIORITY_COLORS } from "./priorityService";

// ============================================================================
// Geração do PDF da Listagem de Ordens de Serviço
//
// Gera um PDF "pronto a imprimir/enviar" com a mesma informação da listagem
// em ecrã (ver PrintableListPage no frontend), com cabeçalho, resumo dos
// filtros aplicados, tabela com paginação automática e código de cores de
// prioridade — para ser descarregado e partilhado fora da aplicação.
// ============================================================================

export interface PdfReportRow {
  externalId: string;
  cliente: string;
  produto: string;
  estado: string;
  etapaAtual: string;
  prazo: string; // ISO ou "-"
  prioridade: string; // rótulo já traduzido
  prioridadeNivel: PriorityLevel | null;
}

const COLORS = {
  ink: "#161b2c",
  muted: "#667085",
  border: "#e2e4e9",
  headerBg: "#f4f5f7",
  rowAlt: "#fafbfd",
  primary: "#2f5ce0",
};

const COLUMNS: { key: keyof PdfReportRow; label: string; width: number }[] = [
  { key: "externalId", label: "OS", width: 60 },
  { key: "cliente", label: "Cliente", width: 155 },
  { key: "produto", label: "Produto", width: 150 },
  { key: "estado", label: "Estado", width: 85 },
  { key: "etapaAtual", label: "Etapa atual", width: 105 },
  { key: "prazo", label: "Prazo", width: 105 },
  { key: "prioridade", label: "Prioridade", width: 110 },
];

const PRIORITY_PILL_LABELS: Record<PriorityLevel, string> = {
  PRAZO_ULTRAPASSADO: "Atrasado",
  URGENTE: "Urgente",
  PROXIMO: "Próximo",
  COM_MARGEM: "Com margem",
};

const ROW_HEIGHT = 22;
const HEADER_ROW_HEIGHT = 22;

export function streamServiceOrdersPdf(res: Response, rows: PdfReportRow[], filtersSummary: string) {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 40, bufferPages: true });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="listagem-ordens-servico.pdf"');
  doc.pipe(res);

  drawHeader(doc, filtersSummary, rows.length);
  drawTableHeader(doc);

  rows.forEach((row, i) => {
    ensureSpaceForRow(doc);
    drawRow(doc, row, i);
  });

  if (rows.length === 0) {
    doc
      .fontSize(10)
      .fillColor(COLORS.muted)
      .text("Sem Ordens de Serviço para os filtros selecionados.", doc.page.margins.left, doc.y + 10);
  }

  addPageNumbers(doc);
  doc.end();
}

function drawHeader(doc: PDFKit.PDFDocument, filtersSummary: string, total: number) {
  doc.fontSize(18).fillColor(COLORS.ink).font("Helvetica-Bold").text("Gestão de Produção");
  doc.fontSize(13).fillColor(COLORS.primary).font("Helvetica-Bold").text("Listagem de Ordens de Serviço");
  doc.moveDown(0.4);
  doc
    .fontSize(9)
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .text(
      `Gerado em ${new Date().toLocaleString("pt-PT")}  ·  ${total} Ordem(ns) de Serviço  ·  ${filtersSummary}`
    );
  doc.moveDown(0.8);
  const lineY = doc.y;
  doc
    .moveTo(doc.page.margins.left, lineY)
    .lineTo(doc.page.width - doc.page.margins.right, lineY)
    .strokeColor(COLORS.border)
    .lineWidth(1)
    .stroke();
  doc.moveDown(0.6);
}

function drawTableHeader(doc: PDFKit.PDFDocument) {
  const x0 = doc.page.margins.left;
  const y = doc.y;
  const totalWidth = COLUMNS.reduce((sum, c) => sum + c.width, 0);

  doc.rect(x0, y, totalWidth, HEADER_ROW_HEIGHT).fill(COLORS.headerBg);

  let x = x0;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLORS.muted);
  for (const col of COLUMNS) {
    doc.text(col.label.toUpperCase(), x + 6, y + 7, { width: col.width - 10, height: HEADER_ROW_HEIGHT });
    x += col.width;
  }
  doc.y = y + HEADER_ROW_HEIGHT;
}

function ensureSpaceForRow(doc: PDFKit.PDFDocument) {
  // Reserva algum espaço extra para o rodapé (número de página) não colidir
  // com a última linha da tabela.
  const bottom = doc.page.height - doc.page.margins.bottom - 20;
  if (doc.y + ROW_HEIGHT > bottom) {
    doc.addPage();
    drawTableHeader(doc);
  }
}

function drawRow(doc: PDFKit.PDFDocument, row: PdfReportRow, index: number) {
  const x0 = doc.page.margins.left;
  const y = doc.y;
  const totalWidth = COLUMNS.reduce((sum, c) => sum + c.width, 0);

  if (index % 2 === 1) {
    doc.rect(x0, y, totalWidth, ROW_HEIGHT).fill(COLORS.rowAlt);
  }

  let x = x0;
  for (const col of COLUMNS) {
    if (col.key === "prioridade") {
      drawPriorityPill(doc, row, x, y, col.width);
    } else {
      const value = col.key === "prazo" ? formatDate(row.prazo) : String(row[col.key] ?? "-");
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor(COLORS.ink)
        .text(value, x + 6, y + 6, {
          width: col.width - 10,
          height: ROW_HEIGHT - 4,
          ellipsis: true,
          lineBreak: false,
        });
    }
    x += col.width;
  }

  doc
    .moveTo(x0, y + ROW_HEIGHT)
    .lineTo(x0 + totalWidth, y + ROW_HEIGHT)
    .strokeColor(COLORS.border)
    .lineWidth(0.5)
    .stroke();

  doc.y = y + ROW_HEIGHT;
}

function drawPriorityPill(doc: PDFKit.PDFDocument, row: PdfReportRow, x: number, y: number, colWidth: number) {
  if (!row.prioridadeNivel) {
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.muted).text("—", x + 6, y + 6);
    return;
  }
  const color = PRIORITY_COLORS[row.prioridadeNivel];
  const label = PRIORITY_PILL_LABELS[row.prioridadeNivel];
  doc.font("Helvetica-Bold").fontSize(8);
  const textWidth = Math.min(doc.widthOfString(label) + 16, colWidth - 8);
  const pillHeight = 15;
  const pillY = y + (ROW_HEIGHT - pillHeight) / 2;

  doc.roundedRect(x + 4, pillY, textWidth, pillHeight, pillHeight / 2).fill(color);
  doc.fillColor("#ffffff").text(label, x + 4, pillY + 4, {
    width: textWidth,
    height: pillHeight - 2,
    align: "center",
    ellipsis: true,
    lineBreak: false,
  });
}

function formatDate(iso: string): string {
  if (!iso || iso === "-") return "-";
  return new Date(iso).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function addPageNumbers(doc: PDFKit.PDFDocument) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Nota: o texto tem de ficar DENTRO da caixa de margens (não abaixo dela)
    // — escrever fora da margem inferior faz o pdfkit inserir automaticamente
    // uma nova página em branco antes de desenhar o texto.
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text(
        `Gestão de Produção · Página ${i - range.start + 1} de ${range.count}`,
        doc.page.margins.left,
        doc.page.height - doc.page.margins.bottom - 10,
        {
          width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
          align: "center",
          lineBreak: false,
        }
      );
  }
}
