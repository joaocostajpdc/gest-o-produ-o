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
// Etiqueta do produto (ficha detalhada, tipo tag) — 102mm x 164mm. Impressa
// numa Brother QL-1100 com rolo de papel contínuo Brother DK-22243 (102mm
// de largura, sem corte fixo de fábrica — ver pedido do utilizador de
// 2026-09-01, com foto do rolo: "102mmX30.48m" / "4"X100'"). A largura
// 102mm corresponde exactamente à largura do rolo (impressa no próprio
// rolo e confirmada pelo diálogo da Brother); a altura 164mm foi a medida
// de impressão confirmada pelo utilizador (depois de tentativas anteriores
// com 100x150mm, 4"x6" e 4"x14,5cm que não imprimiram corretamente).
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
//
// Uma Ordem de Serviço pode ter mais do que um artigo (ver
// goldylocksPdfParser.ts) — nesse caso o texto de especificações vem
// dividido em blocos "Artigo N — ..." e esta etiqueta sai com uma página
// por artigo (mesmo código de barras/QR e mesmo Nº de Ordem de Serviço em
// todas, só os campos do produto mudam) — a aplicação continua a ter uma
// única Ordem de Serviço (ver pedido do utilizador de 2026-09-02: "esta
// ordem de serviço tem dois artigos tem que ler os dois" / "como nas
// etiquetas uma para cada produto", e decisão confirmada: "uma OS só, mas
// com uma etiqueta por artigo").
// ---------------------------------------------------------------------------
const PRODUCT_LABEL_WIDTH = 102 * 2.83465; // 102mm -> pt (largura do rolo Brother DK-22243)
const PRODUCT_LABEL_HEIGHT = 164 * 2.83465; // 164mm -> pt
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

/**
 * Divide o texto de especificações num bloco por artigo, quando a Ordem de
 * Serviço tiver mais do que um (goldylocksPdfParser.ts identifica cada um
 * com um título "Artigo N — ..."). Quando não há esses títulos (o caso
 * normal, um só artigo), devolve o texto completo como um único bloco —
 * comportamento idêntico ao de antes de existir esta divisão.
 */
function splitArticleBlocks(specifications?: string | null): Record<string, string>[] {
  if (!specifications) return [{}];
  const headerRe = /^Artigo \d+\s*—.*$/gm;
  const headers = [...specifications.matchAll(headerRe)];
  if (headers.length === 0) return [parseSpecLines(specifications)];

  const blocks: Record<string, string>[] = [];
  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].index! + headers[i][0].length;
    const end = i + 1 < headers.length ? headers[i + 1].index! : specifications.length;
    blocks.push(parseSpecLines(specifications.slice(start, end)));
  }
  return blocks;
}

/**
 * "Referente a:" (a encomenda do cliente) é impressa uma só vez no
 * documento do Goldylocks e aplica-se a toda a Ordem de Serviço, mesmo
 * quando há vários artigos — por isso é lida do texto completo (nunca de um
 * bloco de artigo em particular) e usada como N/Ref em todas as páginas.
 */
function extractSharedReferencia(specifications?: string | null): string | undefined {
  if (!specifications) return undefined;
  const match = specifications.match(/^Referente a:\s*(.+)$/m);
  return match?.[1]?.trim().replace(/,\s*$/, "") || undefined;
}

function buildProductLabelFieldsForBlock(
  specs: Record<string, string>,
  referencia: string | undefined,
  externalId: string
): { label: string; value: string }[] {
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
  // 2026-09-01: "n/ ref, é a encomenda do clinete"). É partilhada por toda a
  // OS (ver extractSharedReferencia), com o mapa deste bloco como reserva
  // para especificações escritas manualmente com uma destas chaves.
  const nRef =
    referencia ??
    specs["referente a"] ??
    specs["n/ref"] ??
    specs["n/ref."] ??
    specs["nossa ref"] ??
    specs["nossa referência"];
  fields.push({ label: "N/Ref.", value: nRef ?? "----------" });

  // V/Ref. (Vossa Referência) — campo distinto do N/Ref acima, só aparece
  // quando existir essa informação nas Características do Produto; omite-se
  // por completo quando não há valor, em vez de mostrar um traço (pedido do
  // utilizador de 2026-09-01: "v ref, apenas utilizas quando tiver inf. na
  // ordem de serviço"). Ao contrário do N/Ref, é lida deste bloco (por
  // artigo), porque a "v/ ref." do Goldylocks pode ser diferente em cada
  // linha da mesma OS (ver pedido do utilizador de 2026-09-02, com a OS
  // 2026/430 real).
  push("V/Ref.", "v/ref", "v/ref.", "vossa ref", "vossa referência");

  // Ordem de Serviço é sempre o nosso próprio número — não depende do texto
  // de especificações, e é igual em todas as páginas/artigos. Rótulo por
  // extenso (em vez da antiga abreviatura "N.O.S.") para não ser confundido
  // com o N/Ref acima.
  fields.push({ label: "Ordem de Serviço", value: externalId });
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

/**
 * Desenha uma página da etiqueta do produto (logótipo, campos, código de
 * barras + QR) no documento já criado. Extraído para função à parte porque,
 * quando a Ordem de Serviço tem vários artigos, o mesmo desenho repete-se
 * uma vez por página (ver cabeçalho acima) — evita duplicar ~80 linhas de
 * layout por página.
 */
function renderProductLabelPage(
  doc: PDFKit.PDFDocument,
  fields: { label: string; value: string }[],
  barcodePng: Buffer,
  siteQrPng: Buffer,
  createdAt: string,
  pageLabel: string | null
) {
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

  // Indicador "Artigo X de Y" — só aparece quando a OS tem mais do que um
  // artigo (pageLabel vem null no caso normal de um único artigo, mantendo a
  // etiqueta idêntica à de antes desta funcionalidade).
  if (pageLabel) {
    doc
      .fontSize(8)
      .fillColor(COLORS.primary)
      .font("Helvetica-Bold")
      .text(pageLabel, PL_MARGIN, y, { width, align: "center" });
    y += 13;
  }

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
    .text(formatDate(createdAt), PL_MARGIN, dateY, { width, align: "right" });

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
}

export async function streamProductLabelPdf(res: Response, data: LabelOrderData) {
  const [barcodePng, siteQrPng] = await Promise.all([
    generateBarcode(data.externalId),
    generateQrCode(SITE_QR_URL),
  ]);

  // Uma página por artigo (ver cabeçalho acima) — no caso normal de um só
  // artigo, splitArticleBlocks devolve um único bloco e o comportamento é
  // idêntico ao de antes desta funcionalidade (uma única página, sem
  // indicador "Artigo X de Y").
  const blocks = splitArticleBlocks(data.specifications);
  const referencia = extractSharedReferencia(data.specifications);

  const doc = new PDFDocument({
    size: [PRODUCT_LABEL_WIDTH, PRODUCT_LABEL_HEIGHT],
    margin: PL_MARGIN,
    autoFirstPage: false,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="etiqueta-produto-${sanitizeFilename(data.externalId)}.pdf"`
  );
  doc.pipe(res);

  blocks.forEach((block, i) => {
    const fields = buildProductLabelFieldsForBlock(block, referencia, data.externalId);
    const pageLabel = blocks.length > 1 ? `Artigo ${i + 1} de ${blocks.length}` : null;
    doc.addPage();
    renderProductLabelPage(doc, fields, barcodePng, siteQrPng, data.createdAt, pageLabel);
  });

  doc.end();
}
