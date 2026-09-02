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

function renderPageWithColumns(pageData: any): Promise<string> {
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
  /**
   * "v/ ref.:" impressa a seguir aos campos deste artigo — ao contrário de
   * "Referente a:" (que é uma só para toda a OS), esta pode ser diferente
   * por artigo (ex.: cada linha da encomenda do cliente com a sua própria
   * referência) — ver pedido do utilizador de 2026-09-02.
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

function parseText(text: string): ParsedOrdemServico {
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

  const artigos: ParsedArtigo[] = artigoMatches.map((m, i) => {
    const blockStart = m.index! + m[0].length;
    const blockEnd = i + 1 < artigoMatches.length ? artigoMatches[i + 1].index! : afterHeader.length;
    const blockText = afterHeader.slice(blockStart, blockEnd);
    return {
      codigoArtigo: m[1],
      descricaoArtigo: m[2]?.trim(),
      quantidade: m[3]?.trim(),
      unidade: m[4]?.trim(),
      modelo: extractAfterLabel(blockText, "Modelo:"),
      dimensoes: extractAfterLabel(blockText, "Dimensões:"),
      acabamento: extractAfterLabel(blockText, "Acabamento:"),
      enchimento: extractAfterLabel(blockText, "Enchimento:"),
      // Espessura/Vidro só aparecem em alguns tipos de artigo (ex.: painéis
      // com vidro) — ver etiqueta do produto em labelPdfService.ts, que usa
      // estas linhas (quando presentes) para preencher os seus campos.
      espessura: extractAfterLabel(blockText, "Espessura:"),
      vidro: extractAfterLabel(blockText, "Vidro:"),
      vRefArtigo: extractAfterLabel(blockText, "v/ ref.:") ?? extractAfterLabel(blockText, "v/ref.:"),
    };
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
  return parts;
}

function buildNotes(parsed: ParsedOrdemServico): string | undefined {
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
export async function parseOrdemServicoPdf(pdfBuffer: Buffer): Promise<GoldylocksServiceOrder> {
  const data = await pdfParse(pdfBuffer, { pagerender: renderPageWithColumns });
  const parsed = parseText(data.text);
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
