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

interface ParsedOrdemServico {
  numero: string;
  dataHora?: string;
  clienteNumero: string;
  clienteNome?: string;
  clienteContribuinte?: string;
  codigoArtigo: string;
  descricaoArtigo?: string;
  modelo?: string;
  dimensoes?: string;
  acabamento?: string;
  enchimento?: string;
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

  // Linha do artigo: "CODIGO | Descrição livre | Quantidade Unidade" — a
  // primeira linha com este formato de 3 colunas a seguir ao cabeçalho
  // "Cod. | Descrição | Quant. ...".
  const afterHeader = text.slice(text.indexOf("Cod."));
  const artigoMatch = afterHeader.match(/^(\S+)\s*\|\s*([^|]+?)\s*\|\s*([\d.,]+)\s*(\S+)\s*$/m);
  if (!artigoMatch) {
    throw new Error("Não foi possível encontrar a linha do artigo (Código / Descrição / Quantidade) no PDF.");
  }
  const codigoArtigo = artigoMatch[1];
  const descricaoArtigo = artigoMatch[2]?.trim();

  return {
    numero,
    dataHora,
    clienteNumero,
    clienteNome,
    clienteContribuinte,
    codigoArtigo,
    descricaoArtigo,
    modelo: extractAfterLabel(text, "Modelo:"),
    dimensoes: extractAfterLabel(text, "Dimensões:"),
    acabamento: extractAfterLabel(text, "Acabamento:"),
    enchimento: extractAfterLabel(text, "Enchimento:"),
    referencia: extractAfterLabel(text, "Referente a:"),
    prazoEntrega: text.match(/Prazo de entrega:?\s*\|?\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1],
  };
}

function buildNotes(parsed: ParsedOrdemServico): string | undefined {
  const parts: string[] = [];
  if (parsed.modelo) parts.push(`Modelo: ${parsed.modelo}`);
  if (parsed.dimensoes) parts.push(`Dimensões: ${parsed.dimensoes}`);
  if (parsed.acabamento) parts.push(`Acabamento: ${parsed.acabamento}`);
  if (parsed.enchimento) parts.push(`Enchimento: ${parsed.enchimento}`);
  if (parsed.referencia) parts.push(`Referente a: ${parsed.referencia}`);
  return parts.length ? parts.join("\n") : undefined;
}

/**
 * Lê um PDF de "Ordem Serviço" do Goldylocks e devolve os dados no mesmo
 * formato usado pelos adaptadores de integração (mock/API real), para que a
 * criação da Ordem de Serviço na aplicação siga sempre o mesmo caminho.
 */
export async function parseOrdemServicoPdf(pdfBuffer: Buffer): Promise<GoldylocksServiceOrder> {
  const data = await pdfParse(pdfBuffer, { pagerender: renderPageWithColumns });
  const parsed = parseText(data.text);

  return {
    externalId: parsed.numero,
    client: {
      externalId: parsed.clienteNumero,
      name: parsed.clienteNome ?? `Cliente ${parsed.clienteNumero}`,
      taxNumber: parsed.clienteContribuinte,
    },
    product: {
      externalId: parsed.codigoArtigo,
      name: parsed.descricaoArtigo ?? parsed.codigoArtigo,
    },
    createdAt: parsed.dataHora ? parsed.dataHora.replace(" ", "T") : new Date().toISOString(),
    notes: buildNotes(parsed),
    deadlineAt: parsed.prazoEntrega ? parsePrazoEntregaDate(parsed.prazoEntrega) : undefined,
  };
}
