import PDFDocument from "pdfkit";
import bwipjs from "bwip-js";
import { Response } from "express";

// ============================================================================
// Etiquetas para colar no produto físico (inicialmente apenas para a
// categoria "Painéis" — ver pedido do utilizador de 2026-08-20).
//
// São dois documentos separados, com propósitos distintos:
//
//  - Etiqueta de código QR: pequena, para colar na peça, com um código QR
//    que identifica tanto o produto como a Ordem de Serviço e que, ao ser
//    lido num telemóvel, abre diretamente a página da OS na aplicação (só é
//    possível "abrir" algo com um código QR de URL — um código de barras
//    tradicional (1D) não tem essa capacidade). O código, produto e OS
//    também ficam identificados em texto legível, para quem não tiver o
//    telemóvel à mão.
//
//  - Etiqueta do produto: uma ficha mais detalhada com as características
//    da encomenda (modelo, dimensões, acabamento, enchimento, cliente,
//    datas), para acompanhar o produto sem necessidade de o escanear.
// ============================================================================

export interface LabelOrderData {
  externalId: string;
  clienteName: string;
  clienteExternalId?: string | null;
  productExternalId: string;
  productName: string;
  category?: string | null;
  createdAt: string;
  deadlineAt: string | null;
  specifications?: string | null;
  /** URL completo da página da OS na aplicação — o que o código QR abre ao ser lido. */
  orderUrl: string;
}

const COLORS = {
  ink: "#161b2c",
  muted: "#667085",
  border: "#e2e4e9",
  primary: "#2f5ce0",
  specBg: "#f4f7ff",
};

function sanitizeFilename(value: string): string {
  return value.replace(/[^a-z0-9-_]+/gi, "-");
}

function formatDate(iso: string | null, withTime = false): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

async function generateQrCode(text: string): Promise<Buffer> {
  return bwipjs.toBuffer({ bcid: "qrcode", text, scale: 4 });
}

// ---------------------------------------------------------------------------
// Etiqueta de código QR (pequena, tipo autocolante) — 90mm x 55mm.
// ---------------------------------------------------------------------------
const QR_LABEL_WIDTH = 90 * 2.83465; // mm -> pt
const QR_LABEL_HEIGHT = 55 * 2.83465;

export async function streamBarcodeLabelPdf(res: Response, data: LabelOrderData) {
  const qrPng = await generateQrCode(data.orderUrl);

  const doc = new PDFDocument({
    size: [QR_LABEL_WIDTH, QR_LABEL_HEIGHT],
    margin: 10,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="etiqueta-qr-${sanitizeFilename(data.externalId)}.pdf"`
  );
  doc.pipe(res);

  // Todo o texto usa coordenadas (x, y) absolutas — em vez de deixar o
  // pdfkit "fluir" o cursor doc.y entre chamadas — porque esta é uma página
  // pequena e fixa (etiqueta): se o conteúdo acumulado ultrapassar a altura
  // da página, o pdfkit insere silenciosamente uma segunda página, o que
  // arruinaria uma etiqueta que tem de sair sempre numa única folha.
  // Deixa sempre espaço reservado por baixo do QR para a nota de rodapé —
  // caso contrário o QR (alinhado à altura da página) sobrepõe-se ao texto.
  const footerHeight = 16;
  const qrSize = QR_LABEL_HEIGHT - 20 - footerHeight;
  doc.image(qrPng, 10, 10, { width: qrSize, height: qrSize });

  const textX = 10 + qrSize + 10;
  const textWidth = QR_LABEL_WIDTH - textX - 10;

  doc
    .fontSize(7)
    .fillColor(COLORS.muted)
    .font("Helvetica-Bold")
    .text("ORDEM DE SERVIÇO", textX, 10, { width: textWidth, height: 9, ellipsis: true });
  doc
    .fontSize(14)
    .fillColor(COLORS.ink)
    .font("Helvetica-Bold")
    .text(data.externalId, textX, 20, { width: textWidth, height: 17, ellipsis: true });

  doc
    .fontSize(7)
    .fillColor(COLORS.muted)
    .font("Helvetica-Bold")
    .text("PRODUTO", textX, 42, { width: textWidth, height: 9, ellipsis: true });
  doc
    .fontSize(12)
    .fillColor(COLORS.ink)
    .font("Helvetica-Bold")
    .text(data.productExternalId, textX, 51, { width: textWidth, height: 15, ellipsis: true });
  doc
    .fontSize(8)
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .text(data.productName, textX, 67, { width: textWidth, height: 20, ellipsis: true });

  doc
    .fontSize(7.5)
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .text(data.clienteName, textX, 90, { width: textWidth, height: 10, ellipsis: true });

  doc
    .fontSize(6)
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .text("Ler o código para abrir a OS na aplicação", 10, 10 + qrSize + 5, {
      width: QR_LABEL_WIDTH - 20,
      height: 9,
      align: "center",
      lineBreak: false,
      ellipsis: true,
    });

  doc.end();
}

// ---------------------------------------------------------------------------
// Etiqueta do produto (ficha detalhada, tipo tag) — 100mm x 150mm.
// ---------------------------------------------------------------------------
const PRODUCT_LABEL_WIDTH = 100 * 2.83465;
const PRODUCT_LABEL_HEIGHT = 150 * 2.83465;
const PL_MARGIN = 16;

export async function streamProductLabelPdf(res: Response, data: LabelOrderData) {
  const doc = new PDFDocument({
    size: [PRODUCT_LABEL_WIDTH, PRODUCT_LABEL_HEIGHT],
    margin: PL_MARGIN,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="etiqueta-produto-${sanitizeFilename(data.externalId)}.pdf"`
  );
  doc.pipe(res);

  const width = PRODUCT_LABEL_WIDTH - PL_MARGIN * 2;

  doc.fontSize(9).fillColor(COLORS.primary).font("Helvetica-Bold").text("MINHO FERRAGENS", { width });
  doc.fontSize(11).fillColor(COLORS.muted).font("Helvetica-Bold").text("Etiqueta do Produto", { width });
  doc.moveDown(0.6);

  const line = () => {
    doc
      .moveTo(PL_MARGIN, doc.y)
      .lineTo(PRODUCT_LABEL_WIDTH - PL_MARGIN, doc.y)
      .strokeColor(COLORS.border)
      .lineWidth(1)
      .stroke();
    doc.moveDown(0.5);
  };

  const field = (label: string, value: string, valueSize = 12) => {
    doc.fontSize(8).fillColor(COLORS.muted).font("Helvetica-Bold").text(label.toUpperCase(), { width });
    doc.fontSize(valueSize).fillColor(COLORS.ink).font("Helvetica-Bold").text(value || "—", { width });
    doc.moveDown(0.5);
  };

  line();
  field("Código do produto", data.productExternalId, 16);
  field("Descrição", data.productName);
  if (data.category) field("Categoria", data.category, 10);
  line();
  field("Nº Ordem de Serviço", data.externalId, 14);
  field("Cliente", data.clienteExternalId ? `${data.clienteExternalId} — ${data.clienteName}` : data.clienteName);
  line();

  if (data.specifications) {
    doc
      .fontSize(8)
      .fillColor(COLORS.primary)
      .font("Helvetica-Bold")
      .text("CARACTERÍSTICAS", { width });
    doc.moveDown(0.2);
    const specLines = data.specifications.split("\n").filter(Boolean);
    const boxY = doc.y;
    const boxHeight = specLines.length * 15 + 12;
    doc.rect(PL_MARGIN, boxY, width, boxHeight).fill(COLORS.specBg);
    let ly = boxY + 6;
    doc.fontSize(10).font("Helvetica-Bold").fillColor(COLORS.ink);
    for (const l of specLines) {
      doc.text(l, PL_MARGIN + 8, ly, { width: width - 16 });
      ly += 15;
    }
    doc.y = boxY + boxHeight + 10;
    line();
  }

  field("Data de início", formatDate(data.createdAt), 10);
  field("Data-limite", formatDate(data.deadlineAt), 10);

  doc.end();
}
