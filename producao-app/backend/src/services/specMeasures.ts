// ============================================================================
// Medidas escritas à mão nas Características do Produto de uma OS (pedido do
// utilizador de 2026-10-29: "pondo aqui as medidas para que depois saia nas
// etiquetas e poder calcular o plano de corte").
//
// As características são texto livre, com um bloco "Artigo N — ..." por
// artigo (ou sem títulos, quando há um só). A medida de cada artigo fica na
// linha "Dimensões: Larg. W x Alt. H" — o mesmo formato que o PDF produz e
// que a Etiqueta de Mosquiteira e o plano de corte (/cut-plans/os-measures)
// já leem. Quantidade e restantes linhas não são tocadas.
// ============================================================================

const HEADER_RE = /^Artigo \d+\s*—.*$/gm;
const DIM_LINE_RE = /^Dimens[õo]es:.*$/im;
const LARG_ALT_RE = /Larg\.?\s*([\d.,]+)\s*[x×*]\s*Alt\.?\s*([\d.,]+)/i;

export interface SpecBlock {
  index: number;
  title: string | null;
  width: number | null;
  height: number | null;
  qty: number | null;
}

interface RawBlock {
  title: string | null;
  start: number;
  end: number;
}

function splitBlocks(spec: string): RawBlock[] {
  const headers = [...spec.matchAll(HEADER_RE)];
  if (!headers.length) {
    const ref = spec.search(/^Referente a:/m);
    return [{ title: null, start: 0, end: ref >= 0 ? ref : spec.length }];
  }
  return headers.map((h, i) => {
    const next = i + 1 < headers.length ? headers[i + 1].index! : spec.length;
    const ref = spec.slice(h.index!, next).search(/^Referente a:/m);
    return { title: h[0].trim(), start: h.index!, end: ref >= 0 ? h.index! + ref : next };
  });
}

const num = (v: string) => Number(v.replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));

export function readSpecBlocks(spec: string | null | undefined): SpecBlock[] {
  const text = spec ?? "";
  return splitBlocks(text).map((b, index) => {
    const body = text.slice(b.start, b.end);
    const dim = body.match(LARG_ALT_RE);
    const qty = body.match(/Quant\.?:\s*([\d.,]+)/i);
    return {
      index,
      title: b.title,
      width: dim ? num(dim[1]) : null,
      height: dim ? num(dim[2]) : null,
      qty: qty ? num(qty[1]) : null,
    };
  });
}

const fmt = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

/** Escreve (ou apaga, com null) a medida de cada bloco indicado. */
export function writeSpecMeasures(
  spec: string | null | undefined,
  items: { index: number; width: number | null; height: number | null }[]
): string {
  let text = spec ?? "";
  // Do último para o primeiro, para os índices dos blocos anteriores não mudarem.
  const blocks = splitBlocks(text);
  const byIndex = new Map(items.map((i) => [i.index, i]));
  for (let i = blocks.length - 1; i >= 0; i--) {
    const it = byIndex.get(i);
    if (!it) continue;
    const b = blocks[i];
    let body = text.slice(b.start, b.end);
    const line = it.width && it.height ? `Dimensões: Larg. ${fmt(it.width)} x Alt. ${fmt(it.height)}` : null;
    if (DIM_LINE_RE.test(body)) {
      body = line ? body.replace(DIM_LINE_RE, line) : body.replace(/^Dimens[õo]es:.*(\r?\n)?/im, "");
    } else if (line) {
      if (b.title) {
        const nl = body.indexOf("\n");
        body = nl >= 0 ? `${body.slice(0, nl + 1)}${line}\n${body.slice(nl + 1)}` : `${body}\n${line}`;
      } else {
        body = body ? `${line}\n${body}` : `${line}\n`;
      }
    }
    text = text.slice(0, b.start) + body + text.slice(b.end);
  }
  return text;
}
