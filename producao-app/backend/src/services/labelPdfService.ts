import PDFDocument from "pdfkit";
import bwipjs from "bwip-js";
import { Response } from "express";
import { LOGO_MARK_PNG_BASE64 } from "../assets/logoMark";

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
  primary: "#1f3fe0",
  specBg: "#eef1ff",
};

const LOGO_PNG = Buffer.from(LOGO_MARK_PNG_BASE64, "base64");

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
  res.setHeader("Cache-Control", "no-store");
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
//
// Segue o modelo de etiqueta já usado nas caixas físicas (logótipo, campos
// Modelo/Acabamento/Enchimento/Espessura/Vidro/Medida/Quant./V.Ref./N.O.S.,
// código QR e data) — ver pedido do utilizador de 2026-08-21. Os valores dos
// campos são lidos do mesmo texto livre de "Características do Produto" já
// usado na Ficha de Produção e na página da OS (sem exigir novos campos
// estruturados na aplicação); os campos ausentes desse texto são omitidos.
// ---------------------------------------------------------------------------
const PRODUCT_LABEL_WIDTH = 100 * 2.83465;
const PRODUCT_LABEL_HEIGHT = 150 * 2.83465;
const PL_MARGIN = 16;

/** Lê linhas "Rótulo: valor" do texto livre de especificações. */
function parseSpecLines(specifications?: string | null): Record<string, string> {
  const map: Record<string, string> = {};
  if (!specifications) return map;
  for (const rawLine of specifications.split("\n")) {
    const match = rawLine.match(/^([^:]+):\s*(.+)$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim().replace(/,\s*$/, "");
    if (value) map[key] = value;
  }
  return map;
}

function buildProductLabelFields(data: LabelOrderData): { label: string; value: string }[] {
  const specs = parseSpecLines(data.specifications);
  const fields: { label: string; value: string }[] = [];
  const push = (label: string, ...keys: string[]) => {
    const value = keys.map((k) => specs[k]).find((v) => !!v);
    if (value) fields.push({ label, value });
  };
  push("Modelo", "modelo");
  push("Acabamento", "acabamento");
  push("Enchimento", "enchimento");
  push("Espessura", "espessura");
  push("Vidro", "vidro");
  push("Medida", "medida", "dimensões", "dimensoes");
  push("Quant.", "quant.", "quant", "quantidade");
  // "Referente a" é a referência do cliente para esta encomenda — mostra-se
  // como "V/Ref." (Vossa Referência), tal como no modelo físico.
  const vRef = specs["referente a"] ?? specs["v/ref"] ?? specs["v/ref."];
  fields.push({ label: "V/Ref.", value: vRef ?? "—" });
  // N.O.S. (Nº da nossa Ordem de Serviço) é sempre o nosso próprio número —
  // não depende do texto de especificações.
  fields.push({ label: "N.O.S.", value: data.externalId });
  return fields;
}

export async function streamProductLabelPdf(res: Response, data: LabelOrderData) {
  const qrPng = await generateQrCode(data.orderUrl);
  const fields = buildProductLabelFields(data);

  const doc = new PDFDocument({
    size: [PRODUCT_LABEL_WIDTH, PRODUCT_LABEL_HEIGHT],
    margin: PL_MARGIN,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="etiqueta-produto-${sanitizeFilename(data.externalId)}.pdf"`
  );
  doc.pipe(res);

  const width = PRODUCT_LABEL_WIDTH - PL_MARGIN * 2;

  // Todo o texto usa coordenadas (x, y) absolutas em vez do cursor "fluido"
  // do pdfkit — mesma razão da etiqueta QR acima: o número de campos aqui é
  // sempre limitado (no máximo 9), o que torna seguro calcular a posição de
  // cada linha à partida, sem risco de o pdfkit inserir uma página extra.
  const logoSize = 42;
  const logoX = PL_MARGIN + (width - logoSize) / 2;
  doc.image(LOGO_PNG, logoX, PL_MARGIN, { width: logoSize, height: logoSize });

  let y = PL_MARGIN + logoSize + 8;
  doc
    .fontSize(13)
    .fillColor(COLORS.ink)
    .font("Helvetica-Bold")
    .text("MINHO FERRAGENS", PL_MARGIN, y, { width, align: "center" });
  y += 17;
  doc
    .fontSize(8)
    .fillColor(COLORS.muted)
    .font("Helvetica-Oblique")
    .text("JPDC - MYNHOFERRAGENS, LDA", PL_MARGIN, y, { width, align: "center" });
  y += 16;

  doc
    .moveTo(PL_MARGIN, y)
    .lineTo(PRODUCT_LABEL_WIDTH - PL_MARGIN, y)
    .strokeColor(COLORS.border)
    .lineWidth(1)
    .stroke();
  y += 12;

  doc.font("Helvetica-Bold").fontSize(11).fillColor(COLORS.ink);
  for (const f of fields) {
    doc.text(`${f.label}: ${f.value}`, PL_MARGIN, y, { width, height: 15, ellipsis: true });
    y += 16;
  }

  // Código QR + data, alinhados ao fundo da etiqueta, tal como no modelo
  // físico. Ao ser lido, abre esta Ordem de Serviço na aplicação — mesmo
  // comportamento da Etiqueta QR.
  const qrSize = 68;
  const qrY = PRODUCT_LABEL_HEIGHT - PL_MARGIN - qrSize;
  doc.image(qrPng, PL_MARGIN, qrY, { width: qrSize, height: qrSize });

  doc
    .fontSize(9)
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .text(formatDate(data.createdAt), PL_MARGIN, qrY + qrSize - 12, { width, align: "right" });

  doc.end();
}
