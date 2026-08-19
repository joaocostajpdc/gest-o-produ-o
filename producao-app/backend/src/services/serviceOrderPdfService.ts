import PDFDocument from "pdfkit";
import bwipjs from "bwip-js";
import { Response } from "express";
import { PriorityLevel, PRIORITY_COLORS } from "./priorityService";

// ============================================================================
// Ficha de Produção (PDF por Ordem de Serviço)
//
// Documento pronto a imprimir e a acompanhar a peça física ao longo da
// produção: identificação da OS, código de barras (para leitura rápida do
// número da OS num leitor de código de barras ou app de telemóvel),
// características do produto em destaque, e um checklist das etapas da
// linha de produção — incluindo, junto de cada etapa, as observações que
// lhe foram associadas, para que uma nota registada (ex.: um defeito
// detetado na Fresagem) continue visível quando a peça passa para a etapa
// seguinte, em vez de ficar "perdida" numa lista separada.
// ============================================================================

export interface TravelerStageRow {
  stageName: string;
  status: "PENDENTE" | "ATIVA" | "CONCLUIDA" | "OMITIDA";
  supplierName?: string | null;
  observations: { text: string; userName: string; createdAt: string }[];
}

export interface TravelerObservation {
  text: string;
  userName: string;
  createdAt: string;
}

export interface TravelerData {
  externalId: string;
  clienteName: string;
  produtoName: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  deadlineAt: string | null;
  priorityNivel: PriorityLevel | null;
  priorityLabel: string | null;
  specifications?: string | null;
  stages: TravelerStageRow[];
  generalObservations: TravelerObservation[];
}

const COLORS = {
  ink: "#161b2c",
  muted: "#667085",
  border: "#e2e4e9",
  headerBg: "#f4f5f7",
  specBg: "#f4f7ff",
  noteBg: "#fff8ec",
  primary: "#2f5ce0",
};

const STATUS_LABELS: Record<string, string> = {
  NAO_INICIADA: "Não iniciada",
  EM_PRODUCAO: "Em produção",
  SUSPENSA: "Suspensa",
  CONCLUIDA: "Concluída",
  CANCELADA: "Cancelada",
};

const PRIORITY_PILL_LABELS: Record<PriorityLevel, string> = {
  PRAZO_ULTRAPASSADO: "Atrasado",
  URGENTE: "Urgente",
  PROXIMO: "Próximo",
  COM_MARGEM: "Com margem",
};

const STAGE_STATUS_LABEL: Record<TravelerStageRow["status"], string> = {
  CONCLUIDA: "Concluída",
  ATIVA: "Etapa atual",
  PENDENTE: "Pendente",
  OMITIDA: "Omitida",
};

const PAGE_MARGIN = 40;

export async function streamServiceOrderTravelerPdf(res: Response, data: TravelerData) {
  const barcodePng = await generateBarcode(data.externalId);

  const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN, bufferPages: true });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="ficha-producao-${sanitizeFilename(data.externalId)}.pdf"`
  );
  doc.pipe(res);

  drawHeader(doc, data, barcodePng);
  drawInfoGrid(doc, data);
  if (data.specifications) drawSpecifications(doc, data.specifications);
  drawStagesChecklist(doc, data.stages);
  if (data.generalObservations.length) drawGeneralObservations(doc, data.generalObservations);

  addPageNumbers(doc);
  doc.end();
}

async function generateBarcode(externalId: string): Promise<Buffer> {
  return bwipjs.toBuffer({
    bcid: "code128",
    text: externalId,
    scale: 2,
    height: 12,
    includetext: true,
    textxalign: "center",
  });
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^a-z0-9-_]+/gi, "-");
}

function contentWidth(doc: PDFKit.PDFDocument): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function ensureSpace(doc: PDFKit.PDFDocument, neededHeight: number) {
  // Reserva 20pt extra para o rodapé (número de página), desenhado depois
  // do conteúdo — ver a nota em addPageNumbers sobre não escrever fora da
  // caixa de margens (isso faria o pdfkit inserir uma página em branco).
  const bottom = doc.page.height - doc.page.margins.bottom - 20;
  if (doc.y + neededHeight > bottom) {
    doc.addPage();
  }
}

function drawHeader(doc: PDFKit.PDFDocument, data: TravelerData, barcodePng: Buffer) {
  const startY = doc.y;
  doc.fontSize(18).fillColor(COLORS.ink).font("Helvetica-Bold").text("Gestão de Produção");
  doc.fontSize(13).fillColor(COLORS.primary).font("Helvetica-Bold").text("Ficha de Produção");
  doc.fontSize(20).fillColor(COLORS.ink).font("Helvetica-Bold").text(data.externalId, { paragraphGap: 2 });
  doc.fontSize(10).fillColor(COLORS.muted).font("Helvetica").text(`${data.clienteName} · ${data.produtoName}`);

  // Código de barras alinhado à direita do cabeçalho.
  const barcodeWidth = 170;
  const barcodeX = doc.page.width - doc.page.margins.right - barcodeWidth;
  doc.image(barcodePng, barcodeX, startY, { width: barcodeWidth });

  doc.y = Math.max(doc.y, startY + 70);
  doc.moveDown(0.6);
  const lineY = doc.y;
  doc
    .moveTo(doc.page.margins.left, lineY)
    .lineTo(doc.page.width - doc.page.margins.right, lineY)
    .strokeColor(COLORS.border)
    .lineWidth(1)
    .stroke();
  doc.moveDown(0.6);
}

function drawInfoGrid(doc: PDFKit.PDFDocument, data: TravelerData) {
  const width = contentWidth(doc);
  const colWidth = width / 3;
  const rowY = doc.y;

  const cells: { label: string; value: string; color?: string }[] = [
    { label: "ESTADO", value: STATUS_LABELS[data.status] ?? data.status },
    {
      label: "PRIORIDADE",
      value: data.priorityNivel ? PRIORITY_PILL_LABELS[data.priorityNivel] : "—",
      color: data.priorityNivel ? PRIORITY_COLORS[data.priorityNivel] : undefined,
    },
    { label: "DATA-LIMITE", value: formatDate(data.deadlineAt) },
    { label: "DATA DE ENTRADA", value: formatDate(data.createdAt) },
    { label: "INÍCIO DA PRODUÇÃO", value: formatDate(data.startedAt) },
  ];

  let x = doc.page.margins.left;
  let y = rowY;
  cells.forEach((cell, i) => {
    if (i > 0 && i % 3 === 0) {
      y += 42;
      x = doc.page.margins.left;
    }
    doc.fontSize(8).fillColor(COLORS.muted).font("Helvetica-Bold").text(cell.label, x, y, { width: colWidth - 10 });
    doc
      .fontSize(12)
      .fillColor(cell.color ?? COLORS.ink)
      .font("Helvetica-Bold")
      .text(cell.value, x, y + 12, { width: colWidth - 10 });
    x += colWidth;
  });

  doc.y = y + 42;
  doc.moveDown(0.4);
}

function drawSpecifications(doc: PDFKit.PDFDocument, specifications: string) {
  const width = contentWidth(doc);
  const lines = specifications.split("\n").filter(Boolean);
  const lineHeight = 16;
  const padding = 12;
  const boxHeight = padding * 2 + 14 + lines.length * lineHeight;

  ensureSpace(doc, boxHeight + 10);

  const x = doc.page.margins.left;
  const y = doc.y;
  doc.rect(x, y, width, boxHeight).fill(COLORS.specBg);
  doc.rect(x, y, 4, boxHeight).fill(COLORS.primary);

  doc
    .fontSize(9)
    .fillColor(COLORS.primary)
    .font("Helvetica-Bold")
    .text("CARACTERÍSTICAS DO PRODUTO", x + padding + 6, y + padding);

  let ly = y + padding + 16;
  doc.fontSize(11).font("Helvetica-Bold").fillColor(COLORS.ink);
  for (const line of lines) {
    doc.text(line, x + padding + 6, ly, { width: width - padding * 2 - 6 });
    ly += lineHeight;
  }

  doc.y = y + boxHeight + 12;
}

// Os símbolos Unicode de checklist (☑ ▶ ☐ ⊘) não são suportados pelos
// tipos de letra base do pdfkit (Helvetica só cobre WinAnsiEncoding) — em
// vez de texto, desenham-se os ícones como formas vetoriais.
function drawStageIcon(doc: PDFKit.PDFDocument, status: TravelerStageRow["status"], x: number, y: number) {
  const size = 14;
  doc.save();
  if (status === "PENDENTE") {
    doc.rect(x, y, size, size).lineWidth(1.3).strokeColor(COLORS.muted).stroke();
  } else if (status === "OMITIDA") {
    doc.rect(x, y, size, size).lineWidth(1.3).strokeColor(COLORS.muted).stroke();
    doc.moveTo(x + 2, y + 2).lineTo(x + size - 2, y + size - 2).lineWidth(1.3).strokeColor(COLORS.muted).stroke();
  } else if (status === "CONCLUIDA") {
    doc.roundedRect(x, y, size, size, 2).fill(COLORS.primary);
    doc
      .moveTo(x + 3, y + 7.5)
      .lineTo(x + 6, y + 10.5)
      .lineTo(x + 11, y + 3.5)
      .lineWidth(1.6)
      .strokeColor("#ffffff")
      .stroke();
  } else {
    // ATIVA — círculo com seta (play) a apontar para a direita.
    doc.circle(x + size / 2, y + size / 2, size / 2).fill(COLORS.primary);
    doc
      .polygon([x + 5, y + 3.5], [x + 5, y + 10.5], [x + 11, y + 7])
      .fill("#ffffff");
  }
  doc.restore();
}

function drawStagesChecklist(doc: PDFKit.PDFDocument, stages: TravelerStageRow[]) {
  const width = contentWidth(doc);

  ensureSpace(doc, 24);
  doc.fontSize(11).fillColor(COLORS.ink).font("Helvetica-Bold").text("Checklist de Etapas");
  doc.moveDown(0.3);

  stages.forEach((stage) => {
    const statusLabel = STAGE_STATUS_LABEL[stage.status];
    const isMuted = stage.status === "PENDENTE" || stage.status === "OMITIDA";

    const rowHeight = 20;
    ensureSpace(doc, rowHeight + estimateObservationsHeight(doc, stage.observations, width));

    const x = doc.page.margins.left;
    const y = doc.y;

    drawStageIcon(doc, stage.status, x, y + 2);

    doc
      .fontSize(11)
      .fillColor(isMuted ? COLORS.muted : COLORS.ink)
      .font("Helvetica-Bold")
      .text(stage.stageName, x + 22, y, { width: width - 160, continued: false });

    doc
      .fontSize(9)
      .fillColor(COLORS.muted)
      .font("Helvetica")
      .text(
        stage.supplierName ? `${statusLabel} · Fornecedor: ${stage.supplierName}` : statusLabel,
        x + 22,
        y + 14
      );

    doc.y = y + rowHeight + 4;

    if (stage.observations.length) {
      drawStageObservations(doc, stage.observations, width);
    }

    doc.moveDown(0.2);
  });
}

function estimateObservationsHeight(
  doc: PDFKit.PDFDocument,
  observations: TravelerStageRow["observations"],
  width: number
): number {
  if (!observations.length) return 0;
  let total = 8;
  doc.fontSize(9).font("Helvetica");
  for (const obs of observations) {
    total += doc.heightOfString(obs.text, { width: width - 60 }) + 18;
  }
  return total;
}

function drawStageObservations(doc: PDFKit.PDFDocument, observations: TravelerStageRow["observations"], width: number) {
  const x = doc.page.margins.left + 22;
  const boxWidth = width - 22;

  observations.forEach((obs) => {
    doc.fontSize(9).font("Helvetica");
    const textHeight = doc.heightOfString(obs.text, { width: boxWidth - 24 });
    const boxHeight = textHeight + 22;

    ensureSpace(doc, boxHeight + 4);
    const y = doc.y;

    doc.rect(x, y, boxWidth, boxHeight).fill(COLORS.noteBg);
    doc
      .fontSize(8)
      .fillColor(COLORS.muted)
      .font("Helvetica-Bold")
      .text(`Nota de ${obs.userName} · ${formatDate(obs.createdAt)}`, x + 10, y + 6, { width: boxWidth - 20 });
    doc
      .fontSize(9)
      .fillColor(COLORS.ink)
      .font("Helvetica")
      .text(obs.text, x + 10, y + 17, { width: boxWidth - 20 });

    doc.y = y + boxHeight + 4;
  });
}

function drawGeneralObservations(doc: PDFKit.PDFDocument, observations: TravelerObservation[]) {
  const width = contentWidth(doc);
  ensureSpace(doc, 24);
  doc.moveDown(0.4);
  doc.fontSize(11).fillColor(COLORS.ink).font("Helvetica-Bold").text("Observações gerais");
  doc.moveDown(0.3);

  observations.forEach((obs) => {
    doc.fontSize(9).font("Helvetica");
    const textHeight = doc.heightOfString(obs.text, { width: width - 20 });
    const boxHeight = textHeight + 22;
    ensureSpace(doc, boxHeight + 4);

    const x = doc.page.margins.left;
    const y = doc.y;
    doc.rect(x, y, width, boxHeight).fill(COLORS.noteBg);
    doc
      .fontSize(8)
      .fillColor(COLORS.muted)
      .font("Helvetica-Bold")
      .text(`${obs.userName} · ${formatDate(obs.createdAt)}`, x + 10, y + 6, { width: width - 20 });
    doc.fontSize(9).fillColor(COLORS.ink).font("Helvetica").text(obs.text, x + 10, y + 17, { width: width - 20 });

    doc.y = y + boxHeight + 4;
  });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function addPageNumbers(doc: PDFKit.PDFDocument) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
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
