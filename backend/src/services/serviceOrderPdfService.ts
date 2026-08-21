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
//
// Nota de estilo (2026-08-21): paleta e "cartões" com borda arredondada
// alinhados com o visual já usado na aplicação web (ver --color-primary em
// frontend/src/styles/global.css e os .info-tile da página de detalhe da
// OS) — só o aspeto foi alterado nesta revisão, todo o conteúdo e lógica
// (estados, datas, checklist automático, observações) mantêm-se iguais.
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
  cardBg: "#fbfbfd",
  specBg: "#eef1ff",
  noteBg: "#fff8ec",
  primary: "#1f3fe0",
  primaryDark: "#16309e",
  primarySoft: "#eef1ff",
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

function drawSectionTitle(doc: PDFKit.PDFDocument, title: string) {
  const y = doc.y;
  doc.roundedRect(doc.page.margins.left, y + 3, 4, 12, 1.5).fill(COLORS.primary);
  doc
    .fontSize(12)
    .fillColor(COLORS.ink)
    .font("Helvetica-Bold")
    .text(title, doc.page.margins.left + 11, y);
}

function drawHeader(doc: PDFKit.PDFDocument, data: TravelerData, barcodePng: Buffer) {
  // Barra de destaque a toda a largura da página, para dar identidade
  // visual consistente com a cor primária já usada na aplicação web.
  doc.rect(0, 0, doc.page.width, 6).fill(COLORS.primary);

  const startY = doc.y;

  // Código de barras alinhado à direita do cabeçalho, dentro de um cartão
  // com borda arredondada, para se destacar como elemento "de leitura
  // rápida" separado do resto da identificação. O bloco de texto à
  // esquerda tem de reservar largura suficiente para não passar por baixo
  // desta caixa.
  const barcodeBoxWidth = 178;
  const barcodeBoxHeight = 82;
  const barcodeBoxX = doc.page.width - doc.page.margins.right - barcodeBoxWidth;
  const textWidth = barcodeBoxX - doc.page.margins.left - 16;

  doc
    .fontSize(9)
    .fillColor(COLORS.primary)
    .font("Helvetica-Bold")
    .text("GESTÃO DE PRODUÇÃO  ·  FICHA DE PRODUÇÃO", { characterSpacing: 0.3, width: textWidth });

  doc
    .fontSize(23)
    .fillColor(COLORS.ink)
    .font("Helvetica-Bold")
    .text(data.externalId, { paragraphGap: 2, width: textWidth });

  doc
    .fontSize(10.5)
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .text(`${data.clienteName}  ·  ${data.produtoName}`, { width: textWidth, ellipsis: true });
  doc
    .roundedRect(barcodeBoxX, startY, barcodeBoxWidth, barcodeBoxHeight, 6)
    .lineWidth(1)
    .fillAndStroke("#ffffff", COLORS.border);
  doc.image(barcodePng, barcodeBoxX + 9, startY + 9, { width: barcodeBoxWidth - 18 });

  doc.y = Math.max(doc.y, startY + barcodeBoxHeight);
  doc.moveDown(0.9);
  const lineY = doc.y;
  doc
    .moveTo(doc.page.margins.left, lineY)
    .lineTo(doc.page.width - doc.page.margins.right, lineY)
    .strokeColor(COLORS.border)
    .lineWidth(1)
    .stroke();
  doc.moveDown(0.9);
}

interface InfoTileCell {
  label: string;
  value: string;
  pillColor?: string;
}

function drawInfoGrid(doc: PDFKit.PDFDocument, data: TravelerData) {
  const width = contentWidth(doc);
  const gap = 10;
  const tileWidth = (width - gap * 2) / 3;
  const tileHeight = 48;
  const startX = doc.page.margins.left;
  const rowY = doc.y;

  const row1: InfoTileCell[] = [
    { label: "ESTADO", value: STATUS_LABELS[data.status] ?? data.status },
    {
      label: "PRIORIDADE",
      value: data.priorityNivel ? PRIORITY_PILL_LABELS[data.priorityNivel] : "—",
      pillColor: data.priorityNivel ? PRIORITY_COLORS[data.priorityNivel] : undefined,
    },
    { label: "DATA-LIMITE", value: formatDate(data.deadlineAt) },
  ];
  const row2: InfoTileCell[] = [
    { label: "DATA DE ENTRADA", value: formatDate(data.createdAt) },
    { label: "INÍCIO DA PRODUÇÃO", value: formatDate(data.startedAt) },
  ];

  const drawTile = (cell: InfoTileCell, x: number, y: number) => {
    doc.roundedRect(x, y, tileWidth, tileHeight, 6).lineWidth(1).fillAndStroke(COLORS.cardBg, COLORS.border);
    doc
      .fontSize(7.5)
      .fillColor(COLORS.muted)
      .font("Helvetica-Bold")
      .text(cell.label, x + 10, y + 10, { width: tileWidth - 20, characterSpacing: 0.2 });

    if (cell.pillColor) {
      doc.font("Helvetica-Bold").fontSize(9.5);
      const pillWidth = Math.min(tileWidth - 20, doc.widthOfString(cell.value) + 16);
      const pillY = y + 23;
      doc.roundedRect(x + 10, pillY, pillWidth, 17, 8.5).fill(cell.pillColor);
      doc
        .fillColor("#ffffff")
        .text(cell.value, x + 10, pillY + 4.5, { width: pillWidth, align: "center", lineBreak: false });
    } else {
      doc
        .fontSize(12)
        .fillColor(COLORS.ink)
        .font("Helvetica-Bold")
        .text(cell.value, x + 10, y + 23, { width: tileWidth - 20, height: 18, ellipsis: true });
    }
  };

  row1.forEach((cell, i) => drawTile(cell, startX + i * (tileWidth + gap), rowY));
  const row2Y = rowY + tileHeight + gap;
  row2.forEach((cell, i) => drawTile(cell, startX + i * (tileWidth + gap), row2Y));

  doc.y = row2Y + tileHeight;
  doc.moveDown(0.9);
}

function drawSpecifications(doc: PDFKit.PDFDocument, specifications: string) {
  const width = contentWidth(doc);
  const lines = specifications.split("\n").filter(Boolean);
  const lineHeight = 15;
  const padding = 12;
  const boxHeight = padding * 2 + 16 + lines.length * lineHeight;

  ensureSpace(doc, boxHeight + 14);

  const x = doc.page.margins.left;
  const y = doc.y;
  doc.roundedRect(x, y, width, boxHeight, 6).lineWidth(1).fillAndStroke(COLORS.specBg, COLORS.border);

  doc
    .fontSize(9)
    .fillColor(COLORS.primaryDark)
    .font("Helvetica-Bold")
    .text("CARACTERÍSTICAS DO PRODUTO", x + padding, y + padding, { characterSpacing: 0.2 });

  let ly = y + padding + 16;
  doc.fontSize(11).font("Helvetica-Bold").fillColor(COLORS.ink);
  for (const line of lines) {
    doc.text(line, x + padding, ly, { width: width - padding * 2 });
    ly += lineHeight;
  }

  doc.y = y + boxHeight + 14;
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

  ensureSpace(doc, 26);
  drawSectionTitle(doc, "Checklist de Etapas");
  doc.moveDown(0.7);

  const cardPadding = 12;
  const headerHeight = 34;

  stages.forEach((stage) => {
    const statusLabel = STAGE_STATUS_LABEL[stage.status];
    const isMuted = stage.status === "PENDENTE" || stage.status === "OMITIDA";
    const isActive = stage.status === "ATIVA";

    const obsWidth = width - cardPadding * 2;
    const obsHeight = estimateObservationsHeight(doc, stage.observations, obsWidth);
    const cardHeight = cardPadding * 2 + headerHeight + obsHeight;

    ensureSpace(doc, cardHeight + 10);

    const x = doc.page.margins.left;
    const y = doc.y;

    doc
      .roundedRect(x, y, width, cardHeight, 6)
      .lineWidth(1)
      .fillAndStroke(isActive ? COLORS.primarySoft : COLORS.cardBg, COLORS.border);
    if (isActive) {
      doc.save();
      doc.roundedRect(x, y, 4, cardHeight, 2).fill(COLORS.primary);
      doc.restore();
    }

    drawStageIcon(doc, stage.status, x + cardPadding, y + cardPadding);

    doc
      .fontSize(11)
      .fillColor(isMuted ? COLORS.muted : COLORS.ink)
      .font("Helvetica-Bold")
      .text(stage.stageName, x + cardPadding + 22, y + cardPadding - 1, { width: width - cardPadding * 2 - 22 });

    doc
      .fontSize(9)
      .fillColor(COLORS.muted)
      .font("Helvetica")
      .text(
        stage.supplierName ? `${statusLabel} · Fornecedor: ${stage.supplierName}` : statusLabel,
        x + cardPadding + 22,
        y + cardPadding + 14
      );

    if (stage.observations.length) {
      doc.y = y + cardPadding + headerHeight;
      drawStageObservations(doc, stage.observations, x + cardPadding, obsWidth);
    }

    doc.y = y + cardHeight + 10;
  });
}

function estimateObservationsHeight(
  doc: PDFKit.PDFDocument,
  observations: TravelerStageRow["observations"],
  width: number
): number {
  if (!observations.length) return 0;
  let total = 0;
  doc.fontSize(9).font("Helvetica");
  for (const obs of observations) {
    total += doc.heightOfString(obs.text, { width: width - 24 }) + 22 + 6;
  }
  return total;
}

function drawStageObservations(doc: PDFKit.PDFDocument, observations: TravelerStageRow["observations"], x: number, width: number) {
  observations.forEach((obs) => {
    doc.fontSize(9).font("Helvetica");
    const textHeight = doc.heightOfString(obs.text, { width: width - 24 });
    const boxHeight = textHeight + 22;

    const y = doc.y;

    doc.roundedRect(x, y, width, boxHeight, 4).fill(COLORS.noteBg);
    doc
      .fontSize(8)
      .fillColor(COLORS.muted)
      .font("Helvetica-Bold")
      .text(`Nota de ${obs.userName} · ${formatDate(obs.createdAt)}`, x + 10, y + 6, { width: width - 20 });
    doc
      .fontSize(9)
      .fillColor(COLORS.ink)
      .font("Helvetica")
      .text(obs.text, x + 10, y + 17, { width: width - 20 });

    doc.y = y + boxHeight + 6;
  });
}

function drawGeneralObservations(doc: PDFKit.PDFDocument, observations: TravelerObservation[]) {
  const width = contentWidth(doc);
  ensureSpace(doc, 26);
  doc.moveDown(0.4);
  drawSectionTitle(doc, "Observações gerais");
  doc.moveDown(0.7);

  observations.forEach((obs) => {
    doc.fontSize(9).font("Helvetica");
    const textHeight = doc.heightOfString(obs.text, { width: width - 20 });
    const boxHeight = textHeight + 22;
    ensureSpace(doc, boxHeight + 6);

    const x = doc.page.margins.left;
    const y = doc.y;
    doc.roundedRect(x, y, width, boxHeight, 4).fill(COLORS.noteBg);
    doc
      .fontSize(8)
      .fillColor(COLORS.muted)
      .font("Helvetica-Bold")
      .text(`${obs.userName} · ${formatDate(obs.createdAt)}`, x + 10, y + 6, { width: width - 20 });
    doc.fontSize(9).fillColor(COLORS.ink).font("Helvetica").text(obs.text, x + 10, y + 17, { width: width - 20 });

    doc.y = y + boxHeight + 6;
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
      .moveTo(doc.page.margins.left, doc.page.height - doc.page.margins.bottom - 16)
      .lineTo(doc.page.width - doc.page.margins.right, doc.page.height - doc.page.margins.bottom - 16)
      .strokeColor(COLORS.border)
      .lineWidth(1)
      .stroke();
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
