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
//  - Etiqueta de código de barras: pequena, para colar na peça, com um
//    código de barras (Code128) que identifica a Ordem de Serviço (ver
//    pedido do utilizador de 2026-09-01: trocar o QR por código de barras).
//    Ao contrário de um QR de URL, um código de barras não tem capacidade
//    de "abrir" nada sozinho ao ser fotografado — em vez disso, lê-se com o
//    botão "Ler Código" dentro da aplicação, que localiza e abre a OS
//    correspondente. O número da OS, produto e cliente também ficam
//    identificados em texto legível, para quem não tiver o telemóvel à mão.
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

// Código de barras 1D (Code128) com o número da OS impresso por baixo das
// barras (includetext) — serve de apoio de leitura manual caso o código não
// seja lido pela câmara à primeira.
async function generateBarcode(text: string): Promise<Buffer> {
  return bwipjs.toBuffer({
    bcid: "code128",
    text,
    scale: 3,
    height: 10,
    includetext: true,
    textxalign: "center",
    textsize: 8,
  });
}

// ---------------------------------------------------------------------------
// Etiqueta de código de barras (pequena, tipo autocolante) — 90mm x 55mm.
// ---------------------------------------------------------------------------
const QR_LABEL_WIDTH = 90 * 2.83465; // mm -> pt
const QR_LABEL_HEIGHT = 55 * 2.83465;

export async function streamBarcodeLabelPdf(res: Response, data: LabelOrderData) {
  const barcodePng = await generateBarcode(data.externalId);

  const doc = new PDFDocument({
    size: [QR_LABEL_WIDTH, QR_LABEL_HEIGHT],
    margin: 10,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="etiqueta-barras-${sanitizeFilename(data.externalId)}.pdf"`
  );
  doc.pipe(res);

  // Todo o texto usa coordenadas (x, y) absolutas — em vez de deixar o
  // pdfkit "fluir" o cursor doc.y entre chamadas — porque esta é uma página
  // pequena e fixa (etiqueta): se o conteúdo acumulado ultrapassar a altura
  // da página, o pdfkit insere silenciosamente uma segunda página, o que
  // arruinaria uma etiqueta que tem de sair sempre numa única folha.
  const textX = 10;
  const textWidth = QR_LABEL_WIDTH - 20;

  doc
    .fontSize(7)
    .fillColor(COLORS.muted)
    .font("Helvetica-Bold")
    .text("ORDEM DE SERVIÇO", textX, 10, { width: textWidth, height: 9, ellipsis: true });
  doc
    .fontSize(18)
    .fillColor(COLORS.ink)
    .font("Helvetica-Bold")
    .text(data.externalId, textX, 20, { width: textWidth, height: 22, ellipsis: true });

  doc
    .fontSize(7)
    .fillColor(COLORS.muted)
    .font("Helvetica-Bold")
    .text("PRODUTO", textX, 46, { width: textWidth, height: 9, ellipsis: true });
  doc
    .fontSize(11)
    .fillColor(COLORS.ink)
    .font("Helvetica-Bold")
    .text(`${data.productExternalId} — ${data.productName}`, textX, 55, {
      width: textWidth,
      height: 14,
      ellipsis: true,
    });

  doc
    .fontSize(8)
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .text(data.clienteName, textX, 72, { width: textWidth, height: 10, ellipsis: true });

  // Código de barras a toda a largura, alinhado ao fundo da etiqueta — usa
  // "fit" (escala uniforme) em vez de "width"/"height" fixos, para nunca
  // esticar as barras de forma desigual e arriscar tornar o código ilegível.
  const footerHeight = 10;
  const barcodeAreaHeight = QR_LABEL_HEIGHT - 88 - footerHeight - 10;
  doc.image(barcodePng, textX, 88, { fit: [textWidth, barcodeAreaHeight], align: "center" });

  doc
    .fontSize(6)
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .text("Ler o código com o botão \"Ler Código\" na aplicação para abrir esta OS", textX, QR_LABEL_HEIGHT - footerHeight - 4, {
      width: textWidth,
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
  // como "V/Ref." (Vossa Referência), tal como no modelo físico. Quando a OS
  // não tem referência, mostra-se um traço (----------), tal como no modelo
  // físico, em vez de omitir a linha.
  const vRef = specs["referente a"] ?? specs["v/ref"] ?? specs["v/ref."];
  fields.push({ label: "V/Ref.", value: vRef ?? "----------" });
  // N.O.S. (Nº da nossa Ordem de Serviço) é sempre o nosso próprio número —
  // não depende do texto de especificações.
  fields.push({ label: "N.O.S.", value: data.externalId });
  return fields;
}

// Link para a presença online da Minho Ferragens — o segundo código QR da
// etiqueta, tal como no modelo físico já usado (pedido do utilizador de
// 2026-08-21: "quero que saia o QR para o gestão e um QR para o que já
// estava"). Usa-se o link "limpo", sem os parâmetros de rastreio (utm_*,
// fbclid) que vinham anexados ao link partilhado — esses parâmetros são
// específicos de um clique/partilha (rede social) e não fazem sentido
// impressos permanentemente numa etiqueta.
const SITE_QR_URL = "https://linktr.ee/jpdcmynhoferragens";

export async function streamProductLabelPdf(res: Response, data: LabelOrderData) {
  const [orderQrPng, siteQrPng] = await Promise.all([
    generateQrCode(data.orderUrl),
    generateQrCode(SITE_QR_URL),
  ]);
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

  // Dois códigos QR lado a lado, alinhados ao fundo da etiqueta: um abre
  // esta Ordem de Serviço na aplicação de gestão (mesmo comportamento da
  // Etiqueta QR), o outro é o mesmo link que já vinha no modelo físico
  // (site/redes da empresa) — cada um com uma legenda por baixo para não
  // haver confusão sobre qual é qual.
  const qrSize = 62;
  const qrY = PRODUCT_LABEL_HEIGHT - PL_MARGIN - qrSize - 12;
  const dateY = qrY - 14;

  doc
    .fontSize(8.5)
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .text(formatDate(data.createdAt), PL_MARGIN, dateY, { width, align: "right" });

  const qr2X = PL_MARGIN + width - qrSize;

  // As legendas usam { height, ellipsis: true } — sem isto, se o texto
  // fosse largo de mais para a coluna, o pdfkit "flui" o cursor para além
  // do fundo da página e insere silenciosamente uma segunda página em
  // branco (mesmo problema já documentado na etiqueta QR, acima).
  doc.image(orderQrPng, PL_MARGIN, qrY, { width: qrSize, height: qrSize });
  doc
    .fontSize(6.5)
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .text("Abrir OS", PL_MARGIN, qrY + qrSize + 3, { width: qrSize, height: 9, align: "center", ellipsis: true });

  doc.image(siteQrPng, qr2X, qrY, { width: qrSize, height: qrSize });
  doc
    .fontSize(6.5)
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .text("Minho Ferragens", qr2X, qrY + qrSize + 3, {
      width: qrSize,
      height: 9,
      align: "center",
      ellipsis: true,
    });

  doc.end();
}
