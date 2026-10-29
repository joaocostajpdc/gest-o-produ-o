import pdfParse from "pdf-parse";
import { GoldylocksServiceOrder } from "../integrations/goldylocks/types";

// ============================================================================
// Leitura de PDFs de "Ordem Serviço" exportados do Goldylocks.
//
// Em vez de (ou além de) ligar diretamente à API do Goldylocks, este serviço
// permite carregar o PDF da Ordem Serviço (o mesmo documento que o Goldylocks
// gera e que pode ser impresso/exportado) e extrair automaticamente os dados
// necessários para criar a Ordem de Serviço na aplicação de produção.
//
// A extração de texto de um PDF perde a disposição visual em colunas; para
// recuperar isso (nº documento / data / via na mesma linha, código / descrição
// / quantidade do artigo na mesma linha, etc.), usamos uma função de
// renderização própria que insere um separador " | " sempre que dois textos
// na mesma linha (mesma coordenada Y) têm um espaço horizontal maior que o
// normal entre si — ou seja, sempre que pertencem a colunas diferentes.
// ============================================================================

interface TextItem {
  str: string;
  transform: number[];
  width: number;
}

export function renderPageWithColumns(pageData: any): Promise<string> {
  return pageData.getTextContent().then((textContent: { items: TextItem[] }) => {
    let lastY: number | null = null;
    let lastX: number | null = null;
    let lastWidth = 0;
    let text = "";

    for (const item of textContent.items) {
      const x = item.transform[4];
      const y = item.transform[5];

      if (lastY !== null && Math.abs(y - lastY) > 2) {
        text += "\n";
      } else if (lastX !== null) {
        const gap = x - (lastX + lastWidth);
        if (gap > 5) text += " | ";
      }

      text += item.str;
      lastY = y;
      lastX = x;
      lastWidth = item.width;
    }

    return text;
  });
}

/** Extrai um valor numérico com 6 ou mais dígitos após um rótulo, ignorando o que vier a seguir na mesma linha. */
function extractDigitsAfterLabel(text: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`${escaped}[^\\n]*?(\\d{6,})`));
  return match?.[1];
}

function extractAfterLabel(text: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`${escaped}\\s*\\|?\\s*([^\\n]+)`));
  return match?.[1]?.trim() || undefined;
}

/**
 * Referência do cliente por artigo — sai do Goldylocks com rótulos
 * diferentes consoante a Ordem de Serviço (confirmado pelo utilizador de
 * 2026-09-08, com a OS 2026/433 real, cujo PDF tem "V/Enc. Nº 202603160" em
 * vez do "V/Ref.:" que aparecia na OS 2026/430 usada antes para desenhar
 * este extrator: "tanto aparece como v enc ou v/ ref.:"). O antigo
 * extractAfterLabel(text, "v/ ref.:") só apanhava esse formato exato — por
 * isso o campo saía sempre em branco nas Ordens de Serviço que usam
 * "V/Enc." em vez de "V/Ref.:", incluindo na Etiqueta do Produto (que lê
 * este mesmo texto de especificações).
 *
 * Um único regex tolerante substitui as comparações exatas: aceita
 * maiúsculas/minúsculas, espaço opcional à volta da barra, "Ref" ou "Enc",
 * um "Nº"/"N.º"/"N°" opcional antes do valor, e dois-pontos ou "|" (o
 * separador de colunas inserido por renderPageWithColumns) opcionais a
 * seguir. Cobre tanto "V/Ref.: CLI-998-A" como "V/Enc. Nº 202603160".
 */
function extractVRefArtigo(blockText: string): string | undefined {
  const match = blockText.match(/V\s*\/\s*(?:Ref|Enc)\.?\s*(?:N[ºo°]\.?)?\s*:?\s*\|?\s*([^\n]+)/i);
  if (!match) return undefined;
  // Limpa um eventual "Nº"/"N.º" que ainda sobre à frente do valor, para o
  // caso de aparecer depois de um "|" de coluna (fora do alcance do grupo
  // opcional acima) — ex.: "V/Enc. | Nº 202603160" -> "202603160".
  const value = match[1].replace(/^[\s|]*N[ºo°]\.?[\s|:]*/i, "").trim();
  return value || undefined;
}

/**
 * Todas as outras linhas do bloco de um artigo que não são campos já lidos à
 * parte (Modelo, Dimensões, Acabamento, Enchimento, Espessura, Vidro, V/Ref.,
 * Larg./Alt.). Ex.: "Soleira reduzida Acetinado natural", "FECHADURA M2
 * BAIXA…", "Cilindro: c/ cilindro botão", "Interior: Preto Mate" (OS
 * 2026/530, pedido do utilizador de 2026-10-21). Pára no rodapé do documento
 * (Referente a / Observações / Local Carga / ATCUD / totais).
 */
const KNOWN_LINE_RE = /^(modelo|dimens[õo]es|acabamento|enchimento|espessura|vidro|larg\.)\b|^v\s*\/\s*(ref|enc)/i;
const FOOTER_RE = /^(referente a|observa[çc][õo]es|local carga|local descarga|atcud|base\b|total|desconto|este documento|goldylocks|powered by|\d+ \d{4}\/\d+ - p[áa]gina)/i;
function extractOtherLines(blockText: string): string[] {
  const out: string[] = [];
  for (const raw of blockText.split("\n")) {
    const line = raw.replace(/\s*\|\s*/g, " ").replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (FOOTER_RE.test(line)) break;
    if (KNOWN_LINE_RE.test(line)) continue;
    out.push(line);
  }
  return out;
}

/**
 * Algumas linhas de artigo (ex.: mosquiteiras) não têm um rótulo
 * "Dimensões:" — em vez disso, a largura e a altura vêm impressas sem
 * rótulo, no formato "Larg. 1370 * Alt. 1000" (ver OS 2026/432 real,
 * mosquiteiras, pedido do utilizador de 2026-09-02: "cria etiqueta para
 * mosquiteira"). Normaliza para o mesmo formato usado nas restantes
 * "Dimensões:" (com "x" em vez de "*"), para que o resto da aplicação
 * (Características do Produto, Etiqueta do Produto) trate este campo da
 * mesma forma independentemente da categoria do produto.
 */
function extractLargAlt(text: string): string | undefined {
  const match = text.match(/Larg\.\s*([\d.,]+)\s*\*\s*Alt\.\s*([\d.,]+)/i);
  if (!match) return undefined;
  return `Larg. ${match[1]} x Alt. ${match[2]}`;
}

// ============================================================================
// Medidas das mosquiteiras (pedido do utilizador de 2026-10-29: "melhorar a
// leitura dos PDF pondo aqui as medidas para que depois saia nas etiquetas e
// poder calcular o plano de corte"). Várias OS de mosquiteiras de enrolar
// (MF1100 — ex.: 2026/541, 2026/464) entravam sem medida nenhuma, porque o
// Goldylocks nem sempre as imprime no formato "Larg. 1370 * Alt. 1000" que
// extractLargAlt reconhece — e a linha "Larg. ..." que não batesse certo era
// ainda descartada (KNOWN_LINE_RE), perdendo-se de vez.
//
// extractMedidas aceita os formatos que aparecem no Goldylocks:
//   - "Larg. 1370 * Alt. 1000", "Larg 1370 x Alt 1000", "Larg.: 1370 Alt.: 1000",
//     "Largura: 1370 Altura: 1000" (e a ordem inversa, Alt. antes de Larg.);
//   - "Largura: 1370" e "Altura: 1000" em linhas separadas;
//   - nas mosquiteiras, linhas só com números ("1370x1000", "Medida: 1370 x 1000")
//     e listas com quantidades ("Medidas: ; 2 = 1370x1000; 1 = 900x1000"),
//     sempre Largura × Altura, como no resto das mosquiteiras.
// Quando um artigo traz várias medidas, é partido num artigo por medida (com
// a sua quantidade), para cada uma ter as suas etiquetas e peças de corte.
//
// Só é usado por quem já tem acesso a "medidasOS" (em teste, só o
// administrador, até ele aprovar — ver config/featureReleases.ts).
// ============================================================================

interface Medida {
  qty?: number;
  larg: string;
  alt: string;
}

const N = "(\\d{2,5}(?:[.,]\\d{1,2})?)";
const SEP = "\\s*(?:mm)?\\s*[*x×X,;/|-]?\\s*";
const LARG = "Larg(?:ura)?\\.?\\s*:?\\s*";
const ALT = "Alt(?:ura)?\\.?\\s*:?\\s*";
const QTY_PREFIX = "(?:(\\d{1,3})\\s*(?:=|uni?\\.?|un\\.?|x|×)\\s*)?";
const LARG_ALT_RE = new RegExp(`${QTY_PREFIX}${LARG}${N}${SEP}${ALT}${N}`, "gi");
const ALT_LARG_RE = new RegExp(`${QTY_PREFIX}${ALT}${N}${SEP}${LARG}${N}`, "gi");
// "Larg. 1014 * 1824 Alt." / "Larg. 1002 *  455Alt." (OS 2026/563): número antes de "Alt."
const LARG_N_N_ALT_RE = new RegExp(`${QTY_PREFIX}${LARG}${N}${SEP}${N}\\s*Alt(?:ura)?\\.?`, "gi");
const LARG_ONLY_RE = new RegExp(`^${LARG}${N}\\s*(?:mm)?$`, "i");
const ALT_ONLY_RE = new RegExp(`^${ALT}${N}\\s*(?:mm)?$`, "i");
// "2 = 1370x1000" / "1370 x 1000" (só números — usado só nas mosquiteiras)
const PAIR_RE = new RegExp(`(?:(\\d{1,3})\\s*=\\s*)?${N}\\s*(?:mm)?\\s*[x×*]\\s*${N}(?:\\s*[x×*]\\s*\\d+)?`, "gi");
const PAIR_LINE_RE = /^(?:medidas?|dimens[õo]es|dim\.?)\s*:?|^[\s;:=\dx×*.,mm]+$/i;

const cleanNum = (v: string) => v.replace(",", ".").replace(/\.0+$/, "");

export function isMosquiteiraArtigo(codigo: string, descricao?: string): boolean {
  return /^(MF\d|DCMOSQ)/i.test(codigo) || /mosquit/i.test(descricao ?? "");
}

function extractMedidas(blockText: string, mosquiteira: boolean): { medidas: Medida[]; usedLines: Set<number> } {
  const lines = blockText.split("\n").map((l) => l.replace(/\s*\|\s*/g, " ").replace(/\s+/g, " ").trim());
  const medidas: Medida[] = [];
  const usedLines = new Set<number>();
  let soloLarg: { v: string; line: number } | null = null;
  let soloAlt: { v: string; line: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (FOOTER_RE.test(line)) break;
    let found = false;
    for (const m of line.matchAll(LARG_ALT_RE)) {
      medidas.push({ qty: m[1] ? Number(m[1]) : undefined, larg: cleanNum(m[2]), alt: cleanNum(m[3]) });
      found = true;
    }
    if (!found) {
      for (const m of line.matchAll(LARG_N_N_ALT_RE)) {
        medidas.push({ qty: m[1] ? Number(m[1]) : undefined, larg: cleanNum(m[2]), alt: cleanNum(m[3]) });
        found = true;
      }
    }
    if (!found) {
      for (const m of line.matchAll(ALT_LARG_RE)) {
        medidas.push({ qty: m[1] ? Number(m[1]) : undefined, larg: cleanNum(m[3]), alt: cleanNum(m[2]) });
        found = true;
      }
    }
    if (!found) {
      const l = line.match(LARG_ONLY_RE);
      const a = line.match(ALT_ONLY_RE);
      if (l) soloLarg = { v: cleanNum(l[1]), line: i };
      if (a) soloAlt = { v: cleanNum(a[1]), line: i };
      if (l || a) continue;
    }
    if (!found && mosquiteira && PAIR_LINE_RE.test(line)) {
      for (const m of line.matchAll(PAIR_RE)) {
        medidas.push({ qty: m[1] ? Number(m[1]) : undefined, larg: cleanNum(m[2]), alt: cleanNum(m[3]) });
        found = true;
      }
    }
    if (found) usedLines.add(i);
  }
  if (!medidas.length && soloLarg && soloAlt) {
    medidas.push({ larg: soloLarg.v, alt: soloAlt.v });
    usedLines.add(soloLarg.line);
    usedLines.add(soloAlt.line);
  }
  return { medidas, usedLines };
}

const fmtQty = (n: number) => n.toFixed(2).replace(".", ",");

// ============================================================================
// Leitura melhorada dos artigos (pedido do utilizador de 2026-10-29: "não
// quero colocar as medidas à mão, quero que faça uma melhor leitura das
// dimensões em mosquiteiras e painéis principalmente, e dos acabamentos em
// tudo"). Afinada com os PDFs reais das OS 2026/505–567:
//
//  - linhas com vários campos ("Modelo: MF.TVL-29; Dimensões: 2000x800x28",
//    "Enchimento: XPS; Vidro: Fosco/Fosco; V/ ref.: …") partem-se num campo
//    por linha; uma linha partida a meio ("…; Lac.\n9006; V/ ref.: …", OS
//    2026/547) volta a juntar-se;
//  - "Acabamento.:" / "Vidro :" (pontuação fora do sítio) são reconhecidos;
//  - dimensões ficam sempre no mesmo formato ("2160 x 1077" e "2100X900X28"
//    -> "2160x1077", "2100x900x28"); medidas sem rótulo ("446x400x0,8",
//    "2 - 230x40x38x1280") passam a "Dimensões:" (com a quantidade de peças);
//  - acabamento também quando vem como "Lacado 9016 Mate", "Lacar 7016 Txt
//    fino", "Lac. Noir 200", "Cor 1019 Mate", ou só na descrição das
//    mosquiteiras ("… Branca", "… Acetinado Champanhe");
//  - "Ref. Sá" conta como V/Ref.
// ============================================================================

const FIELD_LABEL = "(?:Modelo|Dimens[õo]es|Acabamento|Enchimento|Espessura|Vidro|Relevo|Medidas?|V\\s*\\/\\s*(?:ref|enc))";

/** Junta linhas partidas a meio e parte linhas com vários campos. */
export function normalizeBlock(blockText: string): string {
  const raw = blockText.split("\n").map((l) => l.replace(/\s+$/, ""));
  const joined: string[] = [];
  for (const line of raw) {
    const t = line.trim();
    if (!t) continue;
    const prev = joined.length ? joined[joined.length - 1] : null;
    // continuação: a anterior não fecha com ";" e esta começa por um número
    // seguido de ";" (ex.: "…; Lac." + "9006; V/ ref.: Cimiterio;")
    if (prev && !/;\s*$/.test(prev) && /^[\d.,]+\s*;/.test(t) && /;/.test(prev)) {
      joined[joined.length - 1] = `${prev} ${t}`;
      continue;
    }
    joined.push(t);
  }
  const out: string[] = [];
  // parte antes de um campo com rótulo, e antes de "Chapa Quinada" dentro do
  // Enchimento (OS 2026/547: "Enchimento: XPS; Chapa Quinada; 2 - 3000; …")
  const splitRe = new RegExp(`;\\s*(?=${FIELD_LABEL}\\s*\\.?\\s*:|Chapa\\s+Quinada\\s*;)`, "i");
  for (const line of joined) {
    for (let part of line.split(splitRe)) {
      part = part
        .trim()
        .replace(/^(Acabamento|Dimens[õo]es|Modelo|Enchimento|Espessura|Vidro|Relevo)\s*\.?\s*:\s*/i, (_m, l: string) => `${l.charAt(0).toUpperCase()}${l.slice(1)}: `)
        .replace(/^(Chapa\s+Quinada)\s*;\s*/i, "$1: ")
        .replace(/\s*;\s*$/, "");
      if (part) out.push(part);
    }
  }
  return out.join("\n") + "\n";
}

const normDims = (v: string) =>
  v
    .replace(/\s*[xX×*]\s*/g, "x")
    .replace(/\s+/g, " ")
    .replace(/[;,]\s*$/, "")
    .trim();

const BARE_DIMS_RE = /^(?:(\d{1,3})\s*-\s*)?(\d+(?:[.,]\d+)?(?:\s*[xX×*]\s*\d+(?:[.,]\d+)?){1,4})\s*;?$/;
const LACAGEM_RE = /^(DCLP|DCLACH)/i;
const FINISH_LINE_RE = /^(Lacar|Lacado|Lacada|Lac\.|Cor)\s+(.+?)\s*;?$/i;
const MOSQ_COLORS =
  /\b(Branc[oa]|Castanh[oa]|Bronze|Pret[oa]|Champanhe|Cinzent[oa]|Anodizad[oa]|Inox|Prata|Bege|Creme|Acetinad[oa]\s+\w+|Lacad[oa].*|Cor RAL.*)$/i;

function finishFromLine(l: string): string | null {
  const m = l.match(FINISH_LINE_RE);
  if (!m) return null;
  const v = m[2].replace(/[;,]\s*$/, "").trim();
  return /^cor$/i.test(m[1]) ? v : `L. ${v}`;
}

/** Leitura melhorada de um artigo (ver nota acima). Pode devolver vários artigos (um por medida). */
function applyMedidas(a: ParsedArtigo, blockText: string): ParsedArtigo[] {
  const mosq = isMosquiteiraArtigo(a.codigoArtigo, a.descricaoArtigo);
  const lacagem = LACAGEM_RE.test(a.codigoArtigo);
  const lines = blockText
    .split("\n")
    .map((l) => l.replace(/\s*\|\s*/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const body: string[] = [];
  for (const l of lines) {
    if (FOOTER_RE.test(l)) break;
    body.push(l);
  }
  const used = new Set<string>();
  let art: ParsedArtigo = { ...a };

  // Dimensões já com rótulo: formato uniforme.
  if (art.dimensoes && !/Larg\./i.test(art.dimensoes)) art.dimensoes = normDims(art.dimensoes);

  // Acabamento: linhas "Lacado/Lacar/Lac./Cor …" quando não há "Acabamento:".
  if (!art.acabamento) {
    for (const l of body) {
      const f = finishFromLine(l);
      if (f) {
        art.acabamento = f;
        used.add(l);
        break;
      }
    }
  }
  // Mosquiteiras: a cor vem na descrição ("Mosquiteira enrolar vertical Branca").
  if (!art.acabamento && mosq && art.descricaoArtigo) {
    const c = art.descricaoArtigo.match(MOSQ_COLORS);
    if (c && !/^Cor RAL/i.test(c[1])) art.acabamento = c[1].trim();
  }
  // V/Ref. escrita como "Ref. Sá".
  if (!art.vRefArtigo) {
    const r = body.find((l) => /^Ref\.?\s*:?\s+\S/i.test(l));
    if (r) {
      art.vRefArtigo = r.replace(/^Ref\.?\s*:?\s*/i, "").replace(/[;,]\s*$/, "").trim();
      used.add(r);
    }
  }
  const clean = (x: ParsedArtigo): ParsedArtigo => ({ ...x, outras: (x.outras ?? []).filter((l) => !used.has(l)) });

  if (!mosq) {
    if (art.dimensoes) return [clean(art)];
    // "Medidas: ; 1 = 600x700x28; 1 = 700x800x28" (OS 2026/566): uma peça por medida.
    const medLine = body.find((l) => /^Medidas?\s*:/i.test(l));
    const entries = medLine
      ? [...medLine.matchAll(/(\d{1,3})\s*=\s*(\d+(?:[.,]\d+)?(?:\s*[x×*]\s*\d+(?:[.,]\d+)?){1,3})/gi)]
      : [];
    if (entries.length) {
      used.add(medLine!);
      return entries.map((m) => clean({ ...art, dimensoes: normDims(m[2]), quantidade: fmtQty(Number(m[1])), unidade: art.unidade ?? "uni" }));
    }
    // Medidas sem rótulo ("446x400x0,8", "2 - 230x40x38x1280"). Nas lacagens
    // de perfis as linhas são listas de perfis — ficam como estão.
    if (lacagem) return [clean(art)];
    const bare = body.map((l) => ({ l, m: l.match(BARE_DIMS_RE) })).filter((x) => x.m);
    if (!bare.length) return [clean(art)];
    bare.forEach((x) => used.add(x.l));
    if (bare.length === 1 && !bare[0].m![1]) return [clean({ ...art, dimensoes: normDims(bare[0].m![2]) })];
    return bare.map((x) =>
      clean({ ...art, dimensoes: normDims(x.m![2]), quantidade: fmtQty(Number(x.m![1] ?? 1)), unidade: art.unidade ?? "uni" })
    );
  }

  const { medidas, usedLines } = extractMedidas(blockText, mosq);
  if (!medidas.length) return [clean(art)];
  const blockLines = blockText.split("\n");
  usedLines.forEach((i) => used.add(blockLines[i].replace(/\s*\|\s*/g, " ").replace(/\s+/g, " ").trim()));
  const dims = (m: Medida) => `Larg. ${m.larg} x Alt. ${m.alt}`;

  if (medidas.length === 1 || (art.dimensoes && /Larg\.\s*[\d.,]+\s*x\s*Alt\./i.test(art.dimensoes))) {
    return [clean({ ...art, dimensoes: dims(medidas[0]) })];
  }
  return medidas.map((m) => clean({ ...art, dimensoes: dims(m), quantidade: fmtQty(m.qty ?? 1), unidade: art.unidade ?? "uni" }));
}

/**
 * Uma linha de artigo da Ordem Serviço (uma OS pode ter mais do que uma —
 * ver ParsedOrdemServico.artigos abaixo).
 */
interface ParsedArtigo {
  codigoArtigo: string;
  descricaoArtigo?: string;
  modelo?: string;
  dimensoes?: string;
  acabamento?: string;
  enchimento?: string;
  espessura?: string;
  vidro?: string;
  quantidade?: string;
  unidade?: string;
  /** Restantes linhas do artigo, sem rótulo próprio (ver extractOtherLines). */
  outras?: string[];
  /**
   * "V/Ref." ou "V/Enc." (o Goldylocks usa um ou outro consoante a Ordem de
   * Serviço — ver extractVRefArtigo) impressa a seguir aos campos deste
   * artigo — ao contrário de "Referente a:" (que é uma só para toda a OS),
   * esta pode ser diferente por artigo (ex.: cada linha da encomenda do
   * cliente com a sua própria referência) — ver pedido do utilizador de
   * 2026-09-02.
   */
  vRefArtigo?: string;
}

interface ParsedOrdemServico {
  numero: string;
  dataHora?: string;
  clienteNumero: string;
  clienteNome?: string;
  clienteContribuinte?: string;
  /** Uma OS pode ter mais do que uma linha de artigo — ver pedido do utilizador de 2026-09-02: "esta ordem de serviço tem dois artigos tem que ler os dois". */
  artigos: ParsedArtigo[];
  /** "Referente a:" (Encomenda Cliente) — impressa uma só vez, aplica-se a toda a OS mesmo quando há vários artigos. */
  referencia?: string;
  /** Data no formato DD/MM/AAAA, tal como impressa na linha "Prazo de entrega:". */
  prazoEntrega?: string;
}

/**
 * Converte uma data no formato português "DD/MM/AAAA" (tal como impressa na
 * Ordem Serviço) para uma data ISO, à 23:59 desse dia (a encomenda deve estar
 * pronta/entregue até ao fim desse dia).
 */
function parsePrazoEntregaDate(value: string): string | undefined {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return undefined;
  const [, day, month, year] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    23,
    59,
    0
  );
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function parseText(text: string, opts: ParseOptions = {}): ParsedOrdemServico {
  const headerMatch = text.match(
    /(\d{4}\/\d+)\s*\|\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*\|\s*(\S+)/
  );
  if (!headerMatch) {
    throw new Error(
      'Não foi possível encontrar o número/data da "Ordem Serviço" no PDF. ' +
        "Confirme que é um PDF de Ordem Serviço exportado do Goldylocks."
    );
  }
  const numero = headerMatch[1];
  const dataHora = headerMatch[2];

  const clienteMatch = text.match(/Cliente No\.\s*(\d+)\n([^\n]+)/);
  if (!clienteMatch) {
    throw new Error('Não foi possível encontrar o "Cliente No." no PDF.');
  }
  const clienteNumero = clienteMatch[1];
  const clienteNome = clienteMatch[2]?.trim();

  const clienteContribuinte = extractDigitsAfterLabel(text, "V/Contribuinte:");

  // Linhas de artigo: "CODIGO | Descrição livre | Quantidade Unidade" — uma
  // OS pode ter uma ou várias, todas com este formato de 3 colunas, a
  // seguir ao cabeçalho "Cod. | Descrição | Quant. ...". Para cada uma,
  // os campos indentados por baixo (Modelo/Dimensões/Acabamento/etc.)
  // pertencem só a essa linha — por isso são extraídos apenas do trecho de
  // texto entre esta linha de artigo e a seguinte (ou o fim do documento),
  // nunca do texto completo, para não misturar os campos de artigos
  // diferentes quando há mais do que um (ver pedido do utilizador de
  // 2026-09-02, com a OS 2026/430 real: dois artigos com o mesmo Modelo
  // mas Dimensões e v/ref diferentes).
  const afterHeader = text.slice(text.indexOf("Cod."));
  const artigoLineRe = /^(\S+)\s*\|\s*([^|]+?)\s*\|\s*([\d.,]+)\s*(\S+)\s*$/gm;
  const artigoMatches = [...afterHeader.matchAll(artigoLineRe)];
  if (artigoMatches.length === 0) {
    throw new Error("Não foi possível encontrar a linha do artigo (Código / Descrição / Quantidade) no PDF.");
  }

  const artigos: ParsedArtigo[] = artigoMatches.flatMap((m, i) => {
    const blockStart = m.index! + m[0].length;
    const blockEnd = i + 1 < artigoMatches.length ? artigoMatches[i + 1].index! : afterHeader.length;
    const rawBlock = afterHeader.slice(blockStart, blockEnd);
    const blockText = opts.medidas ? normalizeBlock(rawBlock) : rawBlock;
    const artigo: ParsedArtigo = {
      codigoArtigo: m[1],
      descricaoArtigo: m[2]?.trim(),
      quantidade: m[3]?.trim(),
      unidade: m[4]?.trim(),
      modelo: extractAfterLabel(blockText, "Modelo:"),
      dimensoes: extractAfterLabel(blockText, "Dimensões:") ?? extractLargAlt(blockText),
      acabamento: extractAfterLabel(blockText, "Acabamento:"),
      enchimento: extractAfterLabel(blockText, "Enchimento:"),
      // Espessura/Vidro só aparecem em alguns tipos de artigo (ex.: painéis
      // com vidro) — ver etiqueta do produto em labelPdfService.ts, que usa
      // estas linhas (quando presentes) para preencher os seus campos.
      espessura: extractAfterLabel(blockText, "Espessura:"),
      vidro: extractAfterLabel(blockText, "Vidro:"),
      vRefArtigo: extractVRefArtigo(blockText),
      outras: extractOtherLines(blockText),
    };
    return opts.medidas ? applyMedidas(artigo, blockText) : [artigo];
  });

  return {
    numero,
    dataHora,
    clienteNumero,
    clienteNome,
    clienteContribuinte,
    artigos,
    // Impressa uma só vez no documento (não por artigo), mesmo quando há
    // vários artigos — por isso extraída do texto completo, não do bloco de
    // um artigo em particular.
    referencia: extractAfterLabel(text, "Referente a:"),
    prazoEntrega: text.match(/Prazo de entrega:?\s*\|?\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1],
  };
}

/** As linhas de campos (Modelo/Acabamento/.../Quant./V.Ref.) de um único artigo, sem o cabeçalho "Artigo N —". */
function buildArtigoParts(a: ParsedArtigo): string[] {
  const parts: string[] = [];
  if (a.modelo) parts.push(`Modelo: ${a.modelo}`);
  if (a.acabamento) parts.push(`Acabamento: ${a.acabamento}`);
  if (a.enchimento) parts.push(`Enchimento: ${a.enchimento}`);
  if (a.espessura) parts.push(`Espessura: ${a.espessura}`);
  if (a.vidro) parts.push(`Vidro: ${a.vidro}`);
  if (a.dimensoes) parts.push(`Dimensões: ${a.dimensoes}`);
  if (a.quantidade) parts.push(`Quant.: ${a.quantidade}${a.unidade ? ` ${a.unidade}` : ""}`);
  if (a.vRefArtigo) parts.push(`V/Ref.: ${a.vRefArtigo}`);
  // Restantes linhas do artigo (Soleira, Fechadura, Cilindro, Puxador,
  // Interior, …), tal como vêm na OS — pedido do utilizador de 2026-10-21
  // com a OS 2026/530, que perdia estas linhas.
  for (const l of a.outras ?? []) parts.push(l);
  return parts;
}

export function buildNotes(parsed: ParsedOrdemServico): string | undefined {
  // Uma só linha de artigo: mantém exatamente o formato anterior (sem
  // cabeçalhos "Artigo N —"), para não alterar o texto de "Características
  // do Produto" das Ordens de Serviço já existentes/normais (a grande
  // maioria) que só têm um artigo.
  if (parsed.artigos.length <= 1) {
    const parts = parsed.artigos[0] ? buildArtigoParts(parsed.artigos[0]) : [];
    if (parsed.referencia) parts.push(`Referente a: ${parsed.referencia}`);
    return parts.length ? parts.join("\n") : undefined;
  }

  // Vários artigos na mesma OS — cada um fica num bloco próprio,
  // identificado por título ("Artigo 1 — ...", "Artigo 2 — ..."), separado
  // por uma linha em branco. A Etiqueta do Produto (labelPdfService.ts)
  // reconhece estes títulos e imprime uma etiqueta por artigo, todas com o
  // mesmo número de Ordem de Serviço (ver pedido do utilizador de
  // 2026-09-02: "esta ordem de serviço tem dois artigos tem que ler os
  // dois" / "como nas etiquetas uma para cada produto").
  const blocks = parsed.artigos.map((a, i) => {
    const title = `Artigo ${i + 1} — ${a.codigoArtigo}${a.descricaoArtigo ? ` ${a.descricaoArtigo}` : ""}`;
    const body = buildArtigoParts(a).join("\n");
    return body ? `${title}\n${body}` : title;
  });
  if (parsed.referencia) blocks.push(`Referente a: ${parsed.referencia}`);
  return blocks.join("\n\n");
}

/**
 * Lê um PDF de "Ordem Serviço" do Goldylocks e devolve os dados no mesmo
 * formato usado pelos adaptadores de integração (mock/API real), para que a
 * criação da Ordem de Serviço na aplicação siga sempre o mesmo caminho.
 */
export interface ParseOptions {
  /** Leitura melhorada das medidas (funcionalidade "medidasOS"). */
  medidas?: boolean;
}

export async function parseOrdemServicoPdf(pdfBuffer: Buffer, opts: ParseOptions = {}): Promise<GoldylocksServiceOrder> {
  const data = await pdfParse(pdfBuffer, { pagerender: renderPageWithColumns });
  const parsed = parseText(data.text, opts);
  // A aplicação continua a acompanhar um único "produto" por Ordem de
  // Serviço (etapas, tempos, etc.) — quando a OS tem vários artigos, é o
  // primeiro que fica associado a esse acompanhamento; os restantes ficam
  // registados no texto de especificações (ver buildNotes acima) e geram
  // as suas próprias etiquetas, mas partilham a mesma OS (pedido do
  // utilizador de 2026-09-02: "uma OS só, mas com uma etiqueta por
  // artigo").
  const primeiroArtigo = parsed.artigos[0];

  return {
    externalId: parsed.numero,
    client: {
      externalId: parsed.clienteNumero,
      name: parsed.clienteNome ?? `Cliente ${parsed.clienteNumero}`,
      taxNumber: parsed.clienteContribuinte,
    },
    product: {
      externalId: primeiroArtigo.codigoArtigo,
      name: primeiroArtigo.descricaoArtigo ?? primeiroArtigo.codigoArtigo,
    },
    createdAt: parsed.dataHora ? parsed.dataHora.replace(" ", "T") : new Date().toISOString(),
    notes: buildNotes(parsed),
    deadlineAt: parsed.prazoEntrega ? parsePrazoEntregaDate(parsed.prazoEntrega) : undefined,
  };
}
