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

/**
 * Desenha uma página da Etiqueta de Código de Barras — extraído para função
 * à parte porque, tal como as outras duas etiquetas, esta passou a sair uma
 * página por unidade física (e por artigo, quando a OS tem mais do que um) —
 * ver streamBarcodeLabelPdf.
 */
function renderBarcodeLabelPage(
  doc: PDFKit.PDFDocument,
  data: LabelOrderData,
  barcodePng: Buffer,
  medida: string | undefined,
  acabamento: string | undefined
) {
  // Todo o texto usa coordenadas (x, y) absolutas — em vez de deixar o
  // pdfkit "fluir" o cursor doc.y entre chamadas — porque esta é uma página
  // pequena e fixa (etiqueta): se o conteúdo acumulado ultrapassar a altura
  // da página, o pdfkit insere silenciosamente uma segunda página, o que
  // arruinaria uma etiqueta que tem de sair sempre numa única folha.
  const textX = 10;
  const textWidth = QR_LABEL_WIDTH - 20;
  let y = 8;

  doc
    .fontSize(7)
    .fillColor(COLORS.muted)
    .font("Helvetica-Bold")
    .text("ORDEM DE SERVIÇO", textX, y, { width: textWidth, height: 9, ellipsis: true });
  y += 10;

  doc
    .fontSize(16)
    .fillColor(COLORS.ink)
    .font("Helvetica-Bold")
    .text(data.externalId, textX, y, { width: textWidth, height: 19, ellipsis: true });
  y += 21;

  // Sem nome do cliente — chegou a estar aqui (pedido anterior de
  // 2026-09-08 mal-entendido), mas o utilizador pediu para o remover por
  // completo depois de ver o preview anotado a vermelho ("apa o que ta a
  // vermelho").
  //
  // "PRODUTO" (código + descrição) — pequeno (pedido do utilizador de
  // 2026-09-08, com o preview anotado a verde: "verde mais pequeno").
  doc
    .fontSize(6)
    .fillColor(COLORS.muted)
    .font("Helvetica-Bold")
    .text("PRODUTO", textX, y, { width: textWidth, height: 7, ellipsis: true });
  y += 8;

  doc
    .fontSize(7)
    .fillColor(COLORS.ink)
    .font("Helvetica-Bold")
    .text(`${data.productExternalId} — ${data.productName}`, textX, y, {
      width: textWidth,
      height: 9,
      ellipsis: true,
    });
  y += 10;

  // Medida e Acabamento — em destaque (pedido do utilizador de 2026-09-08,
  // com o preview anotado a roxo: "rojo poem maior"), lidos das
  // especificações deste artigo, tal como na Etiqueta do Produto. Uma única
  // linha compacta (não há espaço para duas linhas nesta etiqueta pequena,
  // 90x55mm); omitida por completo quando nenhum dos dois está presente.
  const details = [medida, acabamento].filter(Boolean).join("   ·   ");
  if (details) {
    doc
      .fontSize(11)
      .fillColor(COLORS.ink)
      .font("Helvetica-Bold")
      .text(details, textX, y, { width: textWidth, height: 14, ellipsis: true });
    y += 16;
  }

  // Código de barras — pequeno (pedido do utilizador de 2026-09-08, com o
  // preview anotado a verde: "verde mais pequeno"), com uma altura máxima
  // fixa em vez de esticar até ao fundo da etiqueta. Usa "fit" (escala
  // uniforme) em vez de "width"/"height" fixos, para nunca esticar as
  // barras de forma desigual e arriscar tornar o código ilegível. A
  // legenda "Ler o código com o botão..." foi removida (pedido anterior do
  // utilizador de 2026-09-08: "tirar a frase ler o codigo com botao").
  const MAX_BARCODE_HEIGHT = 34;
  const barcodeAreaHeight = Math.min(QR_LABEL_HEIGHT - y - 10, MAX_BARCODE_HEIGHT);
  doc.image(barcodePng, textX, y, { fit: [textWidth, barcodeAreaHeight], align: "center" });
}

export async function streamBarcodeLabelPdf(res: Response, data: LabelOrderData) {
  const barcodePng = await generateBarcode(data.externalId);

  // Uma etiqueta por unidade física, e uma por artigo quando a OS tem mais
  // do que um (mesmo comportamento já usado na Etiqueta do Produto e na
  // Etiqueta de Mosquiteira) — pedido do utilizador de 2026-09-08: "nesta
  // etiqueta é importante ter uma por unidade".
  const blocks = splitArticleBlocks(data.specifications);

  const doc = new PDFDocument({ margin: 10, autoFirstPage: false });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="etiqueta-barras-${sanitizeFilename(data.externalId)}.pdf"`
  );
  doc.pipe(res);

  blocks.forEach((block) => {
    const medida = block["medida"] ?? block["dimensões"] ?? block["dimensoes"];
    const acabamento = block["acabamento"];
    const count = unitCountFromSpecs(block);
    for (let u = 0; u < count; u++) {
      doc.addPage({ size: [QR_LABEL_WIDTH, QR_LABEL_HEIGHT] });
      renderBarcodeLabelPage(doc, data, barcodePng, medida, acabamento);
    }
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
// A altura da etiqueta era fixa (164mm), medida confirmada pelo utilizador
// (ver nota acima). Passou a ser calculada por página, à medida do
// conteúdo de cada artigo (ver productLabelPageHeight, mais abaixo) — o
// rolo DK-22243 é contínuo e sem corte fixo de fábrica, por isso uma
// etiqueta com menos campos não precisa da mesma altura que uma com mais, e
// a versão de altura fixa deixava sempre um espaço em branco por baixo dos
// códigos quando havia poucos campos (pedido do utilizador de 2026-09-02:
// "anula o espaço em branco"). A largura mantém-se sempre fixa em 102mm
// (largura do rolo).
//
// Duas referências distintas nos campos de texto, tal como pedido pelo
// utilizador em 2026-09-01 ("é importante nas etiquetas destinguir a n/
// ref, v/ ref. e ordem de serviço"):
//  - a encomenda do cliente a que este produto diz respeito (vem do texto
//    "Referente a:" importado do Goldylocks). Mostra-se sempre, com traço
//    quando não há informação, tal como no modelo físico. Sai sem rótulo
//    "N/Ref." à frente — só o texto da encomenda (pedido do utilizador de
//    2026-09-02: "apaga a N/ ref. deixado apenas a encomenda cliente").
//  - V/Ref.  — só aparece quando existir essa informação nas Características
//    do Produto (ao contrário da linha acima, omite-se por completo quando
//    não há valor, em vez de mostrar um traço).
// A terceira referência — Ordem de Serviço, o nosso próprio número — já não
// tem linha de texto própria (removida a pedido do utilizador de 2026-09-08:
// "ate podemos apagar a ordem se serviço pois o numero ja aparce por baixo
// do codigo de barras"): o código de barras já a mostra em texto legível por
// baixo das barras (ver generateBarcode, includetext), tal como já
// acontecia na Etiqueta de Mosquiteira (ver mais abaixo).
//
// O código que abre a OS na aplicação passou de QR para código de barras
// (Code128), tal como a Etiqueta de Código de Barras — ver pedido do
// utilizador de 2026-09-01: "tudo que esteja ligado ao programa de
// produção seja em código de barras". O segundo código (link para o
// site/redes da empresa) mantém-se QR, por não estar ligado à aplicação de
// gestão de produção. A legenda "Ler para abrir OS" por baixo do código de
// barras foi removida (pedido do utilizador de 2026-09-02).
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
const PL_MARGIN = 16;

// Incrementos de layout partilhados entre renderProductLabelPage (que
// desenha a página) e productLabelPageHeight (que calcula a altura da
// página antes de a criar) — têm de ser exatamente os mesmos incrementos
// nos dois sítios, para a altura calculada nunca divergir do que é
// realmente desenhado (mesmo padrão já usado em serviceOrderPdfService.ts
// para specificationsContentHeight/drawSpecifications).
const PL_LOGO_SIZE = 42;
const PL_TITLE_LINE_HEIGHT = 17;
const PL_SUBTITLE_LINE_HEIGHT = 16;
const PL_PAGE_LABEL_HEIGHT = 13;
const PL_DIVIDER_GAP = 12;
const PL_FIELD_LINE_HEIGHT = 16;
const PL_CODES_TOP_GAP = 16;
const PL_QR_SIZE = 62;
const PL_CAPTION_GAP = 3;
const PL_CAPTION_HEIGHT = 9;

/**
 * Altura total da página da etiqueta do produto, calculada a partir do
 * número de campos e de ter ou não o indicador "Artigo X de Y" — cada
 * página/artigo pode assim sair com uma altura diferente, exatamente à
 * medida do seu conteúdo, sem sobrar espaço em branco por baixo dos
 * códigos.
 */
function productLabelPageHeight(fieldsCount: number, hasPageLabel: boolean): number {
  let y = PL_MARGIN + PL_LOGO_SIZE + 8;
  y += PL_TITLE_LINE_HEIGHT;
  y += PL_SUBTITLE_LINE_HEIGHT;
  if (hasPageLabel) y += PL_PAGE_LABEL_HEIGHT;
  y += PL_DIVIDER_GAP;
  y += fieldsCount * PL_FIELD_LINE_HEIGHT;
  const qrY = y + PL_CODES_TOP_GAP;
  const contentBottom = qrY + PL_QR_SIZE + PL_CAPTION_GAP + PL_CAPTION_HEIGHT;
  return contentBottom + PL_MARGIN;
}

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

/**
 * Quantas etiquetas (unidades físicas) uma linha de artigo representa, a
 * partir do seu campo "Quant." (ex.: "3,00 uni" -> 3). Sem esse campo, ou se
 * não for um número válido, assume-se 1.
 *
 * Partilhada pela Etiqueta do Produto (Painéis) e pela Etiqueta de
 * Mosquiteira — nasceu só para a mosquiteira (pedido do utilizador de
 * 2026-09-02: "1 para cada unidade") e foi promovida a função genérica em
 * 2026-09-08, quando o mesmo comportamento foi pedido para os Painéis (OS
 * 2026/998, Artigo 2 — DCPL000 Painel Liso, Quant.: 3,00 uni: "é importante
 * que onde tem 3 unidades saem 3 etiquetas").
 */
function unitCountFromSpecs(specs: Record<string, string>): number {
  const raw = specs["quant."] ?? specs["quant"] ?? specs["quantidade"];
  if (!raw) return 1;
  const match = raw.match(/(\d+)/);
  const n = match ? parseInt(match[1], 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function buildProductLabelFieldsForBlock(
  specs: Record<string, string>,
  referencia: string | undefined,
  externalId: string
): { label: string | null; value: string }[] {
  const fields: { label: string | null; value: string }[] = [];
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

  // Sempre "1" — cada unidade física tem a sua própria etiqueta, tal como já
  // acontecia na Etiqueta de Mosquiteira (ver unitCountFromSpecs e o pedido
  // do utilizador de 2026-09-08 com a OS 2026/998, Artigo 2, Quant.: 3,00
  // uni -> 3 páginas). Omite-se o campo quando não há Quant. nas
  // especificações, tal como antes.
  if (specs["quant."] ?? specs["quant"] ?? specs["quantidade"]) {
    fields.push({ label: "Quant.", value: "1" });
  }

  // A encomenda do cliente a que este produto diz respeito — vem do texto
  // "Referente a:" importado do Goldylocks (ver goldylocksPdfParser.ts).
  // Mostra-se sempre, com traço quando não há informação, tal como no
  // modelo físico (pedido do utilizador de 2026-09-01: "n/ ref, é a
  // encomenda do clinete"). Sai sem rótulo "N/Ref." à frente — só o valor
  // (pedido do utilizador de 2026-09-02: "apaga a N/ ref. deixado apenas a
  // encomenda cliente"). É partilhada por toda a OS (ver
  // extractSharedReferencia), com o mapa deste bloco como reserva para
  // especificações escritas manualmente com uma destas chaves.
  const nRef =
    referencia ??
    specs["referente a"] ??
    specs["n/ref"] ??
    specs["n/ref."] ??
    specs["nossa ref"] ??
    specs["nossa referência"];
  fields.push({ label: null, value: nRef ?? "----------" });

  // V/Ref. (Vossa Referência) — campo distinto do N/Ref acima, só aparece
  // quando existir essa informação nas Características do Produto; omite-se
  // por completo quando não há valor, em vez de mostrar um traço (pedido do
  // utilizador de 2026-09-01: "v ref, apenas utilizas quando tiver inf. na
  // ordem de serviço"). Ao contrário do N/Ref, é lida deste bloco (por
  // artigo), porque a "v/ ref." do Goldylocks pode ser diferente em cada
  // linha da mesma OS (ver pedido do utilizador de 2026-09-02, com a OS
  // 2026/430 real).
  push("V/Ref.", "v/ref", "v/ref.", "vossa ref", "vossa referência");

  // Sem linha de texto "Ordem de Serviço" — removida a pedido do utilizador
  // de 2026-09-08 (ver nota no cabeçalho do ficheiro): o código de barras,
  // desenhado logo a seguir a estes campos, já mostra o número da OS em
  // texto legível por baixo das barras. externalId deixou de ser usado
  // aqui, mas mantém-se como parâmetro da função para não obrigar a mudar
  // a chamada em streamProductLabelPdf.
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
  fields: { label: string | null; value: string }[],
  barcodePng: Buffer,
  siteQrPng: Buffer,
  createdAt: string,
  pageLabel: string | null
) {
  const width = PRODUCT_LABEL_WIDTH - PL_MARGIN * 2;

  // Todo o texto usa coordenadas (x, y) absolutas em vez do cursor "fluido"
  // do pdfkit — mesma razão da etiqueta QR acima: o número de campos aqui é
  // sempre limitado (no máximo 9: Modelo/Acabamento/Enchimento/Espessura/
  // Vidro/Medida/Quant./N.Ref./V.Ref.), o que torna seguro calcular a
  // posição de cada linha à partida, sem risco de o pdfkit inserir uma
  // página extra.
  const logoSize = PL_LOGO_SIZE;
  const logoX = PL_MARGIN + (width - logoSize) / 2;
  doc.image(LOGO_PNG, logoX, PL_MARGIN, { width: logoSize, height: logoSize });

  let y = PL_MARGIN + logoSize + 8;
  doc
    .fontSize(13)
    .fillColor(COLORS.ink)
    .font("Helvetica-Bold")
    .text("MINHO FERRAGENS", PL_MARGIN, y, { width, align: "center" });
  y += PL_TITLE_LINE_HEIGHT;
  doc
    .fontSize(8)
    .fillColor(COLORS.muted)
    .font("Helvetica-Oblique")
    .text("JPDC - MYNHOFERRAGENS, LDA", PL_MARGIN, y, { width, align: "center" });
  y += PL_SUBTITLE_LINE_HEIGHT;

  // Indicador "Artigo X de Y" — só aparece quando a OS tem mais do que um
  // artigo (pageLabel vem null no caso normal de um único artigo, mantendo a
  // etiqueta idêntica à de antes desta funcionalidade).
  if (pageLabel) {
    doc
      .fontSize(8)
      .fillColor(COLORS.primary)
      .font("Helvetica-Bold")
      .text(pageLabel, PL_MARGIN, y, { width, align: "center" });
    y += PL_PAGE_LABEL_HEIGHT;
  }

  doc
    .moveTo(PL_MARGIN, y)
    .lineTo(PRODUCT_LABEL_WIDTH - PL_MARGIN, y)
    .strokeColor(COLORS.border)
    .lineWidth(1)
    .stroke();
  y += PL_DIVIDER_GAP;

  doc.font("Helvetica-Bold").fontSize(11).fillColor(COLORS.ink);
  for (const f of fields) {
    const text = f.label ? `${f.label}: ${f.value}` : f.value;
    doc.text(text, PL_MARGIN, y, { width, height: 15, ellipsis: true });
    y += PL_FIELD_LINE_HEIGHT;
  }

  // Código de barras (abre a OS na aplicação, lido pelo botão "Ler Código")
  // e QR do site, lado a lado — logo a seguir ao último campo (em vez de
  // fixos junto ao fundo da etiqueta), para não deixar um espaço em branco
  // grande entre o texto e os códigos quando há poucos campos (pedido do
  // utilizador de 2026-09-02: "retira o espaço em branco abaixo entre
  // texto e codigos"). A coluna esquerda passou de QR a código de barras
  // (pedido do utilizador de 2026-09-01: "tudo que esteja ligado ao
  // programa de produção seja em código de barras" — o QR do site, à
  // direita, fica QR por não estar ligado à aplicação).
  const qrSize = PL_QR_SIZE;
  const codesGap = 10;
  const barcodeColWidth = width - qrSize - codesGap;
  const qrY = y + PL_CODES_TOP_GAP;
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

  doc.image(siteQrPng, qr2X, qrY, { width: qrSize, height: qrSize });
  doc
    .fontSize(6.5)
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .text("Minho Ferragens", qr2X, qrY + qrSize + PL_CAPTION_GAP, {
      width: qrSize,
      height: PL_CAPTION_HEIGHT,
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

  // Uma etiqueta por unidade física — uma linha de artigo com Quant. 3 sai em
  // três páginas idênticas, tal como já acontecia na Etiqueta de Mosquiteira
  // (pedido do utilizador de 2026-09-08, com a OS 2026/998: "é importante que
  // onde tem 3 unidades saem 3 etiquetas"). O indicador "Artigo X de Y"
  // conta artigos (blocos), não páginas/unidades — por isso mantém-se igual
  // em todas as páginas de um mesmo artigo.
  blocks.forEach((block, i) => {
    const fields = buildProductLabelFieldsForBlock(block, referencia, data.externalId);
    const pageLabel = blocks.length > 1 ? `Artigo ${i + 1} de ${blocks.length}` : null;
    const pageHeight = productLabelPageHeight(fields.length, !!pageLabel);
    const count = unitCountFromSpecs(block);
    for (let u = 0; u < count; u++) {
      doc.addPage({ size: [PRODUCT_LABEL_WIDTH, pageHeight] });
      renderProductLabelPage(doc, fields, barcodePng, siteQrPng, data.createdAt, pageLabel);
    }
  });

  doc.end();
}

// ---------------------------------------------------------------------------
// Etiqueta de mosquiteira — categoria "Mosquiteiras" (pedido do utilizador de
// 2026-09-02: "cria etiqueta para mosquiteira", com foto de referência da
// etiqueta em papel já usada nas caixas: logótipo, COD., descrição do
// produto com a medida, QUANT. e um código QR — e confirmado por ele: "1
// para cada unidade tem que ter [só] uma altura").
//
// Ao contrário da Etiqueta do Produto (Modelo/Acabamento/Enchimento/
// Espessura/Vidro/Medida), a Ordem Serviço de uma mosquiteira não tem um
// campo "Modelo:" nem "Dimensões:" — a largura/altura vêm impressas sem
// rótulo, no formato "Larg. 1370 * Alt. 1000" (ver OS 2026/432 real,
// enviada pelo utilizador como exemplo). goldylocksPdfParser.ts foi
// alargado para reconhecer este formato como "Dimensões:", por isso chega
// aqui já normalizado.
//
// A Etiqueta de Mosquiteira passou a ter o seu próprio conjunto de tamanhos
// mais compacto (ver MOSQ_* mais abaixo), em vez de reutilizar
// renderProductLabelPage/productLabelPageHeight da Etiqueta do Produto como
// acontecia até 2026-09-16 — ver essa mudança logo a seguir a esta nota.
//
// "1 para cada unidade": uma linha de artigo com Quant. 3, por exemplo, sai
// em três páginas de etiqueta separadas (uma por unidade física), todas
// idênticas e todas a mostrar "Quant.: 1" — nunca o total da linha. E,
// porque o utilizador confirmou que todas as etiquetas da mesma Ordem de
// Serviço devem sair com a mesma altura entre si, a altura é calculada uma
// só vez (a partir do bloco com mais campos) e aplicada a todas as páginas,
// em vez de variar por bloco como acontece na Etiqueta do Produto.
//
// Mantém-se o mesmo par de códigos da Etiqueta do Produto — código de
// barras da Ordem de Serviço (abre a OS na aplicação) e QR do site — em vez
// de replicar exatamente o único QR do modelo em papel (que é uma etiqueta
// antiga, anterior à aplicação, e cujo conteúdo não é rastreável); mantém
// também o formato de data já usado no resto da aplicação (DD/MM/AAAA), em
// vez do "08.01.26" do modelo em papel. Ambas as escolhas ficam fáceis de
// reverter se não for isto que o utilizador quer.
//
// Nota sobre um conjunto de tamanhos ML_* mais compacto que chegou a
// existir aqui (fonte menor, logótipo menor, códigos menores — pedido do
// utilizador de 2026-09-02: "apenas tenta que não seja tão comprida"), com
// altura de página à volta de 73mm: foi revertido no mesmo dia depois de o
// utilizador reportar que a impressora Brother QL-1100 recusava imprimir
// essa etiqueta ("o rolo de etiquetas ou a fita dentro da máquina não
// corresponde ao selecionado na aplicação"). O conjunto MOSQ_* abaixo
// (2026-09-16) foi desenhado com isto em mente: mais compacto do que o
// desenho partilhado com a Etiqueta do Produto (que ronda os 110mm), mas
// com uma altura (~85-95mm) claramente acima dos ~73mm que falharam.
//
// Rotação de 90º — tentada, revertida e depois RESTAURADA, tudo no mesmo dia
// (2026-09-16): uma foto de uma etiqueta já impressa (OS 2026/443) veio com
// anotações a vermelho "Menos espaço" e uma frase pouco legível junto ao
// logótipo, que o utilizador esclareceu (via pergunta) como "vire o sentido"
// e depois confirmou como "rodar 90º" — implementada nessa altura (conteúdo
// desenhado num sistema de coordenadas rodado 90º antes de encaixar na
// página física, largura da página sempre fixa em PRODUCT_LABEL_WIDTH). O
// utilizador imprimiu essa etiqueta rodada a sério e confirmou que saía bem
// ("Está bem assim"), e pediu ainda para "anular o espaço em branco no fim"
// (a largura fixa da fita, 102mm, sobrava mais do que o conteúdo rodado
// precisava — corrigido ampliando proporcionalmente o desenho, ver `scale`
// mais abaixo).
//
// Só depois disso, olhando para uma PRÉ-VISUALIZAÇÃO no ecrã (não uma
// impressão real), o utilizador pediu para reverter para "ao alto" — ou
// seja, na vertical, tal como a Etiqueta do Produto (painéis) sempre
// esteve — e essa reversão foi feita e confirmada ("é isso") e posta em
// produção. Mas ao imprimir essa versão revertida a sério (mesma OS
// 2026/443, fotos reais em cima do teclado), o utilizador reportou que a
// etiqueta continuava a sair de lado ("continua no sentido errado quero ao
// alto") — ou seja, a pré-visualização no ecrã (que mostra sempre a página
// "direita", independentemente do que a impressora faz com o rolo
// contínuo) não é fiável para avaliar a orientação física real; só um teste
// de impressão a sério mostra isso. A rotação de 90º era mesmo necessária
// para a etiqueta sair legível sem rodar a fita física — confirmado com uma
// foto de referência de uma etiqueta antiga (modelo DCMOSQ000) que o
// utilizador comparou, pedindo "tipo assim mas com o modelo que tens": a
// orientação física de leitura da etiqueta antiga, mas com os campos/
// desenho atuais (COD./Descrição/Dimensões/Acabamento/Quant. + código de
// barras + QR).
//
// A rotação foi por isso restaurada (ver renderMosquiteiraLabelPageRotated/
// mosquiteiraRotatedReadingWidth abaixo), com o aperto de espaço junto ao
// logótipo e ao código de barras/QR (MOSQ_LOGO_GAP e MOSQ_CODES_TOP_GAP) e a
// eliminação do espaço em branco (escala uniforme, `scale`) mantidos — só a
// ORIENTAÇÃO voltou atrás, não os restantes pedidos, que continuam válidos.
// A escala é calculada uma só vez por Ordem de Serviço (a partir do bloco
// com mais campos), tal como o tamanho de letra e a altura física já eram
// partilhados por toda a OS antes desta mudança, para que todas as
// etiquetas impressas a seguir saiam com o mesmo aspeto.
// ---------------------------------------------------------------------------

interface MosquiteiraBlock {
  codigoArtigo: string;
  descricaoArtigo: string;
  specs: Record<string, string>;
}

/**
 * Tal como splitArticleBlocks, mas guardando também o código e a descrição
 * do artigo (lidos do título "Artigo N — CODIGO Descrição") — a Etiqueta do
 * Produto não precisa disto (usa antes o "Modelo:" do corpo), mas a
 * Etiqueta de Mosquiteira mostra sempre um campo "COD." e "Descrição"
 * próprios. Quando a OS só tem um artigo (sem esses títulos, o caso mais
 * comum), usa antes o produto associado à própria Ordem de Serviço.
 */
function splitMosquiteiraBlocks(
  specifications: string | null | undefined,
  fallbackCode: string,
  fallbackName: string
): MosquiteiraBlock[] {
  if (!specifications) {
    return [{ codigoArtigo: fallbackCode, descricaoArtigo: fallbackName, specs: {} }];
  }
  const headerRe = /^Artigo \d+\s*—\s*(\S+)(?:\s+(.*))?$/gm;
  const headers = [...specifications.matchAll(headerRe)];
  if (headers.length === 0) {
    return [{ codigoArtigo: fallbackCode, descricaoArtigo: fallbackName, specs: parseSpecLines(specifications) }];
  }

  const blocks: MosquiteiraBlock[] = [];
  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].index! + headers[i][0].length;
    const end = i + 1 < headers.length ? headers[i + 1].index! : specifications.length;
    blocks.push({
      codigoArtigo: headers[i][1],
      descricaoArtigo: headers[i][2]?.trim() || fallbackName,
      specs: parseSpecLines(specifications.slice(start, end)),
    });
  }
  return blocks;
}

function buildMosquiteiraFieldsForBlock(block: MosquiteiraBlock): { label: string | null; value: string }[] {
  const fields: { label: string | null; value: string }[] = [];
  fields.push({ label: "COD.", value: block.codigoArtigo });
  fields.push({ label: "Descrição", value: block.descricaoArtigo });

  // Sem rótulo "Dim." à frente — só o valor (ex.: "Larg. 1370 x Alt. 1000"),
  // tal como o N/Ref. na Etiqueta do Produto (pedido do utilizador de
  // 2026-09-16, com foto anotada da etiqueta impressa da OS 2026/432:
  // risco a vermelho sobre a palavra "Dim.").
  const dimensoes = block.specs["dimensões"] ?? block.specs["dimensoes"] ?? block.specs["medida"];
  if (dimensoes) fields.push({ label: null, value: dimensoes });

  if (block.specs["acabamento"]) fields.push({ label: "Acabamento", value: block.specs["acabamento"] });

  // Sempre "1" — cada unidade física tem a sua própria etiqueta (ver
  // unitCountFromSpecs). Sem linha "Ordem de Serviço" (pedido do
  // utilizador de 2026-09-02: "apaga a linha da ordem de serviço") — o
  // código de barras por baixo já identifica a OS.
  fields.push({ label: "Quant.", value: "1" });
  return fields;
}

// Tamanhos de letra fixos para o desenho rodado — ao contrário do desenho
// vertical (que tinha de encolher a fonte para caber numa largura fixa), no
// desenho rodado é a "largura de leitura" (o comprimento impresso ao longo
// da fita) que cresce à medida do texto — ver mosquiteiraRotatedReadingWidth
// — por isso não há necessidade de encolher nada: tamanhos fixos mantêm o
// mesmo aspeto em todas as etiquetas. Multiplicados por `scale` (ver
// streamMosquiteiraLabelPdf) antes de usar, tal como todas as restantes
// dimensões do desenho.
const MOSQ_ROT_TITLE_FONT_SIZE = 10;
const MOSQ_ROT_SUBTITLE_FONT_SIZE = 6.5;
const MOSQ_ROT_FIELD_FONT_SIZE = 9;
const MOSQ_ROT_DATE_FONT_SIZE = 6.5;
const MOSQ_ROT_CAPTION_FONT_SIZE = 5.5;
const MOSQ_DATE_LINE_HEIGHT = 11;
// Espaço entre o código de barras e o QR do site, e largura mínima
// reservada ao código de barras — para nunca ficar minúsculo/ilegível
// quando os campos de texto são muito curtos e a largura de leitura (que é
// quem manda no comprimento da etiqueta impressa) acaba pequena.
const MOSQ_ROT_CODES_GAP = 8;
const MOSQ_ROT_MIN_BARCODE_WIDTH = 70;

// ---------------------------------------------------------------------------
// Tamanhos próprios da Etiqueta de Mosquiteira — mais compactos do que os
// PL_* da Etiqueta do Produto (pedido do utilizador de 2026-09-16, com foto
// anotada da etiqueta impressa da OS 2026/432: menos espaço em branco no
// topo, logótipo mais pequeno, menos espaço antes do código de barras, e
// código de barras/QR mais pequenos). Ao contrário da tentativa ML_* de
// 2026-09-02 (revertida por a impressora Brother QL-1100 ter recusado
// imprimir uma etiqueta de ~73mm de altura — ver nota mais acima), estes
// valores foram escolhidos para chegar a uma altura sensivelmente menor do
// que a da Etiqueta do Produto mas ainda claramente acima desse limite
// problemático (~85-95mm consoante o número de campos, contra os ~110mm de
// antes e os ~73mm que falharam) — a testar na mesma impressora antes de
// confiar cegamente nisto para todas as etiquetas.
// ---------------------------------------------------------------------------
const MOSQ_MARGIN = 10;
const MOSQ_LOGO_SIZE = 32;
// Espaço entre o logótipo e o título, e entre os campos e o código de
// barras/QR — apertados de 6/12 para 4/8 (pedido do utilizador de
// 2026-09-16, segunda ronda, anotações "Menos espaço" junto ao logótipo e
// junto ao código de barras/QR na foto da OS 2026/443).
const MOSQ_LOGO_GAP = 4;
const MOSQ_TITLE_LINE_HEIGHT = 15;
const MOSQ_SUBTITLE_LINE_HEIGHT = 13;
const MOSQ_DIVIDER_GAP = 10;
const MOSQ_CODES_TOP_GAP = 8;
const MOSQ_QR_SIZE = 52;
const MOSQ_CAPTION_GAP = 3;
const MOSQ_CAPTION_HEIGHT = 8;

function mosquiteiraFieldLineHeight(fieldFontSize: number): number {
  return Math.max(14, fieldFontSize + 5);
}

/**
 * Soma de todos os incrementos do desenho da Etiqueta de Mosquiteira ao
 * tamanho "natural" (sem escala) — ou seja, quanto o desenho ocupa antes de
 * ser ampliado para preencher exatamente a largura fixa da fita. Usada
 * agora para calcular `scale` (ver streamMosquiteiraLabelPdf e a nota no
 * cabeçalho do ficheiro sobre a rotação de 90º), em vez de ser diretamente
 * a altura da página como acontecia no desenho vertical entretanto
 * revertido.
 */
function mosquiteiraLabelPageHeight(fieldsCount: number, fieldFontSize: number): number {
  let y = MOSQ_MARGIN + MOSQ_LOGO_SIZE + MOSQ_LOGO_GAP;
  y += MOSQ_TITLE_LINE_HEIGHT;
  y += MOSQ_SUBTITLE_LINE_HEIGHT;
  y += MOSQ_DIVIDER_GAP;
  y += fieldsCount * mosquiteiraFieldLineHeight(fieldFontSize);
  const qrY = y + MOSQ_CODES_TOP_GAP;
  const contentBottom = qrY + MOSQ_QR_SIZE + MOSQ_CAPTION_GAP + MOSQ_CAPTION_HEIGHT;
  return contentBottom + MOSQ_MARGIN;
}

/**
 * Largura de leitura do desenho rodado — o comprimento que o texto (e o
 * código de barras/QR) precisam ao longo da fita, isto é, a dimensão que
 * depois de rodada 90º se torna o "height" físico da página (o comprimento
 * impresso, sem limite fixo, ao contrário da largura da fita que é sempre
 * PRODUCT_LABEL_WIDTH). Calculada uma só vez a partir dos campos de TODOS
 * os artigos desta OS (mesmo padrão já usado para o tamanho de letra único
 * antes desta mudança), para que todas as etiquetas impressas a seguir
 * saiam com o mesmo comprimento.
 */
function mosquiteiraRotatedReadingWidth(
  doc: PDFKit.PDFDocument,
  allFields: { label: string | null; value: string }[],
  scale: number
): number {
  const margin = MOSQ_MARGIN * scale;
  let maxW = 0;

  doc.font("Helvetica-Bold").fontSize(MOSQ_ROT_TITLE_FONT_SIZE * scale);
  maxW = Math.max(maxW, doc.widthOfString("MINHO FERRAGENS"));

  doc.font("Helvetica-Oblique").fontSize(MOSQ_ROT_SUBTITLE_FONT_SIZE * scale);
  maxW = Math.max(maxW, doc.widthOfString("JPDC - MYNHOFERRAGENS, LDA"));

  doc.font("Helvetica-Bold").fontSize(MOSQ_ROT_FIELD_FONT_SIZE * scale);
  for (const f of allFields) {
    const text = f.label ? `${f.label}: ${f.value}` : f.value;
    maxW = Math.max(maxW, doc.widthOfString(text));
  }

  // Nunca menos do que o necessário para o código de barras (com uma
  // largura mínima legível) + o QR lado a lado, para o código de barras
  // nunca ficar minúsculo quando os campos de texto são muito curtos.
  const qrSize = MOSQ_QR_SIZE * scale;
  const codesGap = MOSQ_ROT_CODES_GAP * scale;
  const minBarcodeWidth = MOSQ_ROT_MIN_BARCODE_WIDTH * scale;
  maxW = Math.max(maxW, minBarcodeWidth + codesGap + qrSize);

  // +2pt de folga — sem isto, o texto mais comprido mede exatamente a
  // largura disponível (zero margem), e o cálculo interno do pdfkit para
  // decidir se corta com "…" é ligeiramente mais conservador do que
  // widthOfString(), cortando por vezes um texto que "cabia" à justa.
  return maxW + margin * 2 + 2;
}

/**
 * Desenha uma página da Etiqueta de Mosquiteira — à parte de
 * renderProductLabelPage (que continua a servir só a Etiqueta do Produto)
 * porque esta tem o seu próprio conjunto de tamanhos, mais compacto (ver
 * MOSQ_* acima) e, ao contrário da Etiqueta do Produto, o conteúdo é
 * desenhado num sistema de coordenadas rodado 90º (`doc.save()` +
 * `translate` + `rotate`) antes de encaixar na página física — ver a nota
 * no cabeçalho do ficheiro sobre a rotação de 90º, tentada, revertida e
 * depois restaurada depois de um teste de impressão real mostrar que a
 * etiqueta saía de lado sem a rotação.
 *
 * A largura da página mantém-se sempre fixa em PRODUCT_LABEL_WIDTH (a
 * largura da fita, constrangimento da impressora — ver cabeçalho), mas essa
 * dimensão passa a corresponder ao eixo de "empilhamento" do conteúdo
 * (logótipo, título, campos, códigos), multiplicado por `scale` para
 * preencher exatamente essa largura sem sobrar espaço em branco no fim
 * ("anula o espaço em branco no fim", pedido do utilizador). O comprimento
 * impresso (a dimensão livre, ao longo da fita) é `readingWidth`, calculado
 * à parte em mosquiteiraRotatedReadingWidth a partir do texto mais comprido.
 */
function renderMosquiteiraLabelPageRotated(
  doc: PDFKit.PDFDocument,
  fields: { label: string | null; value: string }[],
  barcodePng: Buffer,
  siteQrPng: Buffer,
  createdAt: string,
  scale: number,
  readingWidth: number
) {
  const margin = MOSQ_MARGIN * scale;
  const localWidth = readingWidth - margin * 2;

  doc.save();
  doc.translate(PRODUCT_LABEL_WIDTH, 0);
  doc.rotate(90);

  const logoSize = MOSQ_LOGO_SIZE * scale;
  const logoGap = MOSQ_LOGO_GAP * scale;
  const logoX = margin + (localWidth - logoSize) / 2;
  doc.image(LOGO_PNG, logoX, margin, { width: logoSize, height: logoSize });

  // Tal como no desenho vertical, todo o texto leva sempre `height` (+
  // `ellipsis` onde há risco real de não caber) por segurança — sem isto, o
  // pdfkit compara a coordenada Y "crua" passada a `.text()` com a altura
  // DECLARADA da página (aqui, `readingWidth`), sem saber nada da
  // transformação `translate`/`rotate` aplicada — e quando `readingWidth` é
  // menor do que a largura da fita (o que acontece sempre que o texto é
  // curto), essa comparação dispara a paginação automática do pdfkit e
  // insere uma segunda página em branco a meio do desenho (bug confirmado
  // com um repro isolado nesta sessão — ver histórico/commits).
  let y = margin + logoSize + logoGap;

  const titleLineHeight = MOSQ_TITLE_LINE_HEIGHT * scale;
  doc
    .fontSize(MOSQ_ROT_TITLE_FONT_SIZE * scale)
    .fillColor(COLORS.ink)
    .font("Helvetica-Bold")
    .text("MINHO FERRAGENS", margin, y, {
      width: localWidth,
      height: titleLineHeight,
      align: "center",
      ellipsis: true,
    });
  y += titleLineHeight;

  const subtitleLineHeight = MOSQ_SUBTITLE_LINE_HEIGHT * scale;
  doc
    .fontSize(MOSQ_ROT_SUBTITLE_FONT_SIZE * scale)
    .fillColor(COLORS.muted)
    .font("Helvetica-Oblique")
    .text("JPDC - MYNHOFERRAGENS, LDA", margin, y, {
      width: localWidth,
      height: subtitleLineHeight,
      align: "center",
      ellipsis: true,
    });
  y += subtitleLineHeight;

  const dividerGap = MOSQ_DIVIDER_GAP * scale;
  doc
    .moveTo(margin, y)
    .lineTo(margin + localWidth, y)
    .strokeColor(COLORS.border)
    .lineWidth(1)
    .stroke();
  y += dividerGap;

  const fieldFontSize = MOSQ_ROT_FIELD_FONT_SIZE * scale;
  const fieldLineHeight = mosquiteiraFieldLineHeight(MOSQ_ROT_FIELD_FONT_SIZE) * scale;
  doc.font("Helvetica-Bold").fontSize(fieldFontSize).fillColor(COLORS.ink);
  for (const f of fields) {
    const text = f.label ? `${f.label}: ${f.value}` : f.value;
    doc.text(text, margin, y, { width: localWidth, height: fieldLineHeight - 1, ellipsis: true });
    y += fieldLineHeight;
  }

  const qrSize = MOSQ_QR_SIZE * scale;
  const codesGap = MOSQ_ROT_CODES_GAP * scale;
  const codesTopGap = MOSQ_CODES_TOP_GAP * scale;
  const barcodeColWidth = localWidth - qrSize - codesGap;
  const qrY = y + codesTopGap;
  const dateLineHeight = MOSQ_DATE_LINE_HEIGHT * scale;
  const dateY = qrY - dateLineHeight;

  doc
    .fontSize(MOSQ_ROT_DATE_FONT_SIZE * scale)
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .text(formatDate(createdAt), margin, dateY, {
      width: localWidth,
      height: dateLineHeight,
      align: "right",
      ellipsis: true,
    });

  // O código de barras usa "fit" (escala uniforme), nunca width/height
  // fixos, para nunca esticar as barras de forma desigual (mesma razão
  // documentada nas outras etiquetas). O QR do site usa width=height=qrSize
  // (sempre o mesmo valor em ambos os eixos, mesmo depois de multiplicado
  // por `scale`), para nunca sair distorcido.
  doc.image(barcodePng, margin, qrY, { fit: [barcodeColWidth, qrSize], align: "center" });
  const qr2X = margin + localWidth - qrSize;
  doc.image(siteQrPng, qr2X, qrY, { width: qrSize, height: qrSize });

  const captionGap = MOSQ_CAPTION_GAP * scale;
  const captionHeight = MOSQ_CAPTION_HEIGHT * scale;
  doc
    .fontSize(MOSQ_ROT_CAPTION_FONT_SIZE * scale)
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .text("Minho Ferragens", qr2X, qrY + qrSize + captionGap, {
      width: qrSize,
      height: captionHeight,
      align: "center",
      ellipsis: true,
    });

  doc.restore();
}

export async function streamMosquiteiraLabelPdf(res: Response, data: LabelOrderData) {
  const [barcodePng, siteQrPng] = await Promise.all([
    generateBarcode(data.externalId),
    generateQrCode(SITE_QR_URL),
  ]);

  const doc = new PDFDocument({ margin: 0, autoFirstPage: false });

  const blocks = splitMosquiteiraBlocks(data.specifications, data.productExternalId, data.productName);
  const fieldsPerBlock = blocks.map(buildMosquiteiraFieldsForBlock);

  // Escala única para toda a OS — calculada a partir do bloco com mais
  // campos (o "pior caso", tal como a altura da etiqueta já era partilhada
  // por toda a OS antes desta mudança), para que o desenho rodado preencha
  // exatamente a largura fixa da fita (PRODUCT_LABEL_WIDTH) sem sobrar
  // espaço em branco no fim, e para que todas as etiquetas impressas a
  // seguir saiam com o mesmo aspeto.
  const maxFieldsCount = Math.max(...fieldsPerBlock.map((fields) => fields.length));
  const naturalStackingLength = mosquiteiraLabelPageHeight(maxFieldsCount, MOSQ_ROT_FIELD_FONT_SIZE);
  const scale = PRODUCT_LABEL_WIDTH / naturalStackingLength;

  // Comprimento de impressão único para toda a OS — calculado a partir dos
  // campos de todos os artigos (mesmo padrão) — ver mosquiteiraRotatedReadingWidth.
  const readingWidth = mosquiteiraRotatedReadingWidth(doc, fieldsPerBlock.flat(), scale);

  // Uma etiqueta por unidade física — uma linha de artigo com Quant. 3 sai
  // em três páginas idênticas (pedido do utilizador de 2026-09-02: "1 para
  // cada unidade").
  const pages = fieldsPerBlock.flatMap((fields, i) => {
    const count = unitCountFromSpecs(blocks[i].specs);
    return Array.from({ length: count }, () => fields);
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="etiqueta-mosquiteira-${sanitizeFilename(data.externalId)}.pdf"`
  );
  doc.pipe(res);

  pages.forEach((fields) => {
    doc.addPage({ size: [PRODUCT_LABEL_WIDTH, readingWidth] });
    renderMosquiteiraLabelPageRotated(doc, fields, barcodePng, siteQrPng, data.createdAt, scale, readingWidth);
  });

  doc.end();
}
