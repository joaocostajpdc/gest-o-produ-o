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
// Etiqueta do produto (ficha detalhada, tipo tag) — 4" x 6" (101,6 x 152,4mm)
// para corresponder exatamente ao tamanho da etiqueta física já usada (ver
// pedido do utilizador de 2026-09-01, com imagem do software de etiquetas
// atual mostrando a régua em polegadas: "a etiqueta tem que ter estas
// medidas"). Antes desta alteração a etiqueta tinha 100mm x 150mm.
//
// Segue o modelo de etiqueta já usado nas caixas físicas (logótipo, campos
// Modelo/Acabamento/Enchimento/Espessura/Vidro/Medida/Quant., código QR e
// data) — ver pedido do utilizador de 2026-08-21. Os valores dos campos são
// lidos do mesmo texto livre de "Características do Produto" já usado na
// Ficha de Produção e na página da OS (sem exigir novos campos estruturados
// na aplicação); os campos ausentes desse texto são omitidos.
//
// Três referências distintas, tal como pedido pelo utilizador em
// 2026-09-01 ("é importante nas etiquetas destinguir a n/ ref, v/ ref. e
// ordem de serviço"):
//  - N/Ref.  — a encomenda do cliente a que este produto diz respeito (vem
//    do texto "Referente a:" importado do Goldylocks). Mostra-se sempre,
//    com traço quando não há informação, tal como no modelo físico.
//  - V/Ref.  — só aparece quando existir essa informação nas Características
//    do Produto (ao contrário do N/Ref, omite-se por completo quando não há
//    valor, em vez de mostrar um traço).
//  - Ordem de Serviço — o nosso próprio número, sempre presente, com o
//    rótulo por extenso (em vez da antiga abreviatura "N.O.S.") para não ser
//    confundido visualmente com "N/Ref" acima.
//
// O código que abre a OS na aplicação passou de QR para código de barras
// (Code128), tal como a Etiqueta de Código de Barras — ver pedido do
// utilizador de 2026-09-01: "tudo que esteja ligado ao programa de
// produção seja em código de barras". O segundo código (link para o
// site/redes da empresa) mantém-se QR, por não estar ligado à aplicação de
// gestão de produção.
// ---------------------------------------------------------------------------
const PRODUCT_LABEL_WIDTH = 4 * 72; // 4" -> pt (72pt/polegada)
const PRODUCT_LABEL_HEIGHT = 6 * 72; // 6" -> pt
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

  // N/Ref. (Nossa Referência) = a encomenda do cliente a que este produto
  // diz respeito — vem do texto "Referente a:" importado do Goldylocks (ver
  // goldylocksPdfParser.ts). Mostra-se sempre, com traço quando não há
  // informação, tal como no modelo físico (pedido do utilizador de
  // 2026-09-01: "n/ ref, é a encomenda do clinete").
  const nRef =
    specs["referente a"] ?? specs["n/ref"] ?? specs["n/ref."] ?? specs["nossa ref"] ?? specs["nossa referência"];
  fields.push({ label: "N/Ref.", value: nRef ?? "----------" });

  // V/Ref. (Vossa Referência) — campo distinto do N/Ref acima, só aparece
  // quando existir essa informação nas Características do Produto; omite-se
  // por completo quando não há valor, em vez de mostrar um traço (pedido do
  // utilizador de 2026-09-01: "v ref, apenas utilizas quando tiver inf. na
  // ordem de serviço").
  push("V/Ref.", "v/ref", "v/ref.", "vossa ref", "vossa referência");

  // Ordem de Serviço é sempre o nosso próprio número — não depende do texto
  // de especificações. Rótulo por extenso (em vez da antiga abreviatura
  // "N.O.S.") para não ser confundido com o N/Ref acima.
  fields.push({ label: "Ordem de Serviço", value: data.externalId });
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
  const [barcodePng, siteQrPng] = await Promise.all([
    generateBarcode(data.externalId),
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
  // sempre limitado (no máximo 10: Modelo/Acabamento/Enchimento/Espessura/
  // Vidro/Medida/Quant./N.Ref./V.Ref./Ordem de Serviço), o que torna seguro
  // calcular a posição de cada linha à partida, sem risco de o pdfkit
  // inserir uma página extra.
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

  // Código de barras (abre a OS na aplicação, lido pelo botão "Ler Código")
  // e QR do site, lado a lado, alinhados ao fundo da etiqueta — mesma
  // disposição que já existia com os dois QR, só que a coluna esquerda
  // passou a código de barras (pedido do utilizador de 2026-09-01: "tudo
  // que esteja ligado ao programa de produção seja em código de barras" — o
  // QR do site, à direita, fica QR por não estar ligado à aplicação).
  const qrSize = 62;
  const codesGap = 10;
  const barcodeColWidth = width - qrSize - codesGap;
  const qrY = PRODUCT_LABEL_HEIGHT - PL_MARGIN - qrSize - 12;
  const dateY = qrY - 14;

  doc
    .fontSize(8.5)
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .text(formatDate(data.createdAt), PL_MARGIN, dateY, { width, align: "right" });

  const qr2X = PL_MARGIN + width - qrSize;

  // O código de barras usa "fit" (escala uniforme), nunca width/height
  // fixos, para nunca esticar as barras de forma desigual e arriscar
  // tornar o código ilegível (mesma razão documentada na Etiqueta de
  // Código de Barras, acima). As legendas usam { height, ellipsis: true }
  // — sem isto, se o texto fosse largo de mais para a coluna, o pdfkit
  // "flui" o cursor para além do fundo da página e insere silenciosamente
  // uma segunda página em branco (mesmo problema já documentado ali).
  doc.image(barcodePng, PL_MARGIN, qrY, { fit: [barcodeColWidth, qrSize], align: "center" });
  doc
    .fontSize(6.5)
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .text("Ler para abrir OS", PL_MARGIN, qrY + qrSize + 3, {
      width: barcodeColWidth,
      height: 9,
      align: "center",
      ellipsis: true,
    });

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
