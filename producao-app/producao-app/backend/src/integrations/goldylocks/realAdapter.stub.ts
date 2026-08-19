import { GoldylocksAdapter, GoldylocksClient, GoldylocksServiceOrder } from "./types";

// ============================================================================
// Adaptador REAL de integração com o Goldylocks (software de faturação).
//
// O Goldylocks tem um documento nativo chamado "Ordem Serviço" (confirmado
// por um exemplo real: nº 2026/423). Este adaptador vai buscar esses
// documentos através da API REST do Goldylocks (https://api.goldylocks.pt),
// autenticada por API KEY (Gestão > Tabelas > Agentes, dentro da conta
// Goldylocks).
//
// IMPORTANTE — isto ainda não foi testado contra a API real (não houve
// acesso à documentação técnica exata dos endpoints). Os valores abaixo
// (caminho do endpoint, nome do parâmetro de filtro, nome/formato do
// cabeçalho de autenticação, e os nomes dos campos na resposta) são a
// melhor estimativa a partir da documentação pública do Goldylocks e de
// um PDF real de uma "Ordem Serviço". Tudo isto é configurável por
// variável de ambiente, para podermos ajustar sem alterar código assim
// que virmos a primeira resposta real (ver GOLDYLOCKS_* mais abaixo, e
// os logs de deploy no Render, que mostram o pedido e a resposta em caso
// de erro).
// ============================================================================

// Caminho do endpoint que lista documentos. Ajustável via env var caso o
// endpoint real seja diferente (ex.: "/v1/documentos", "/documents", etc.).
const DOCUMENTS_PATH = process.env.GOLDYLOCKS_DOCUMENTS_PATH ?? "/documentos";

// Valor usado para filtrar apenas documentos do tipo "Ordem Serviço".
// Ajustável caso o código interno do Goldylocks para este tipo seja
// diferente de "OS" (ex.: "ORDEM_SERVICO", "OS_INTERNA", um id numérico...).
const DOCUMENT_TYPE = process.env.GOLDYLOCKS_DOCUMENT_TYPE ?? "OS";

// Nome do cabeçalho HTTP e prefixo usados para enviar a API KEY. Os valores
// por omissão seguem a convenção mais comum (cabeçalho "Authorization" com
// prefixo "Bearer "). Ajustável caso o Goldylocks use outro cabeçalho
// (ex.: "apikey", "X-API-KEY") sem prefixo.
const AUTH_HEADER_NAME = process.env.GOLDYLOCKS_AUTH_HEADER ?? "Authorization";
const AUTH_HEADER_PREFIX = process.env.GOLDYLOCKS_AUTH_PREFIX ?? "Bearer ";

// Quantos caracteres do corpo da resposta incluir nas mensagens de erro
// (para aparecerem nos logs do Render sem os inundar).
const ERROR_BODY_PREVIEW_LENGTH = 500;

export class GoldylocksRealAdapter implements GoldylocksAdapter {
  constructor(private readonly apiUrl: string, private readonly apiKey: string) {}

  private buildHeaders(): Record<string, string> {
    if (!this.apiKey) {
      throw new Error(
        "GOLDYLOCKS_API_KEY não está definida. Configure-a nas variáveis de ambiente do serviço no Render " +
          "(Gestão > Tabelas > Agentes, dentro da conta Goldylocks, para obter a chave)."
      );
    }
    return {
      Accept: "application/json",
      [AUTH_HEADER_NAME]: `${AUTH_HEADER_PREFIX}${this.apiKey}`,
    };
  }

  private async requestJson(path: string, searchParams: Record<string, string> = {}): Promise<any> {
    const base = (this.apiUrl || "https://api.goldylocks.pt").replace(/\/$/, "");
    const url = new URL(base + path);
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }

    let response: Response;
    try {
      response = await fetch(url.toString(), { headers: this.buildHeaders() });
    } catch (networkError) {
      throw new Error(
        `Falha de rede ao contactar a API do Goldylocks em ${url.toString()}: ${
          networkError instanceof Error ? networkError.message : String(networkError)
        }`
      );
    }

    const rawBody = await response.text();

    if (!response.ok) {
      const preview = rawBody.slice(0, ERROR_BODY_PREVIEW_LENGTH);
      throw new Error(
        `Pedido à API do Goldylocks falhou (${response.status} ${response.statusText}) em ${url.toString()}. ` +
          `Corpo da resposta (início): ${preview || "(vazio)"}`
      );
    }

    try {
      return JSON.parse(rawBody);
    } catch {
      const preview = rawBody.slice(0, ERROR_BODY_PREVIEW_LENGTH);
      throw new Error(
        `Resposta da API do Goldylocks em ${url.toString()} não é JSON válido. Início da resposta: ${preview}`
      );
    }
  }

  /**
   * Junta as especificações de linha (Modelo, Dimensões, Acabamento,
   * Enchimento, etc.) e a referência à Encomenda Cliente, tal como aparecem
   * no documento "Ordem Serviço", num único texto de observações — decisão
   * tomada para já não exigir alterações ao modelo de dados da aplicação.
   */
  private buildNotes(rawDoc: any, rawLine: any): string | undefined {
    const parts: string[] = [];

    const specFields: Array<[string, string]> = [
      ["Modelo", rawLine?.modelo],
      ["Dimensões", rawLine?.dimensoes],
      ["Acabamento", rawLine?.acabamento],
      ["Enchimento", rawLine?.enchimento],
    ];
    for (const [label, value] of specFields) {
      if (value) parts.push(`${label}: ${value}`);
    }

    const referencia = rawDoc?.referenteA ?? rawDoc?.referencia ?? rawDoc?.encomendaCliente;
    if (referencia) parts.push(`Referente a: ${referencia}`);

    const observacoes = rawDoc?.observacoes ?? rawLine?.observacoes;
    if (observacoes) parts.push(`Observações: ${observacoes}`);

    return parts.length ? parts.join("\n") : undefined;
  }

  private mapDocumentToServiceOrder(rawDoc: any): GoldylocksServiceOrder | null {
    // A resposta pode vir com uma linha por artigo dentro de "linhas"/"items",
    // ou o próprio documento pode já representar uma única linha. Tentamos
    // ambos os formatos, usando sempre a primeira linha (as Ordens de
    // Serviço observadas até agora têm apenas uma linha de artigo).
    const linhas = rawDoc?.linhas ?? rawDoc?.items ?? rawDoc?.lines ?? [];
    const primeiraLinha = Array.isArray(linhas) && linhas.length > 0 ? linhas[0] : rawDoc;

    const numeroDocumento = rawDoc?.numero ?? rawDoc?.numeroDocumento ?? rawDoc?.id;
    const codigoArtigo = primeiraLinha?.codigo ?? primeiraLinha?.cod ?? primeiraLinha?.artigoCodigo;
    const nomeArtigo = primeiraLinha?.descricao ?? primeiraLinha?.designacao ?? primeiraLinha?.nome;
    const numeroCliente = rawDoc?.cliente?.numero ?? rawDoc?.clienteNumero ?? rawDoc?.cliente?.id;
    const nomeCliente = rawDoc?.cliente?.nome ?? rawDoc?.clienteNome;

    if (!numeroDocumento || !codigoArtigo || !numeroCliente) {
      // Documento sem os campos mínimos necessários — ignorado em vez de
      // rebentar a importação toda. Fica registado para diagnóstico.
      // eslint-disable-next-line no-console
      console.warn(
        "Goldylocks: documento ignorado por faltarem campos mínimos (numeroDocumento/codigoArtigo/numeroCliente):",
        JSON.stringify(rawDoc).slice(0, ERROR_BODY_PREVIEW_LENGTH)
      );
      return null;
    }

    const client: GoldylocksClient = {
      externalId: String(numeroCliente),
      name: nomeCliente ?? `Cliente ${numeroCliente}`,
      taxNumber: rawDoc?.cliente?.contribuinte ?? rawDoc?.vContribuinte ?? undefined,
      email: rawDoc?.cliente?.email ?? undefined,
      phone: rawDoc?.cliente?.telefone ?? undefined,
    };

    return {
      externalId: String(numeroDocumento),
      client,
      product: {
        externalId: String(codigoArtigo),
        name: nomeArtigo ?? String(codigoArtigo),
      },
      createdAt: rawDoc?.data ?? rawDoc?.dataHora ?? new Date().toISOString(),
      notes: this.buildNotes(rawDoc, primeiraLinha),
    };
  }

  async fetchNewServiceOrders(since?: Date): Promise<GoldylocksServiceOrder[]> {
    const params: Record<string, string> = { tipo: DOCUMENT_TYPE };
    if (since) params.desde = since.toISOString();

    const data = await this.requestJson(DOCUMENTS_PATH, params);

    // A resposta pode vir como array diretamente, ou dentro de uma
    // propriedade ("documentos", "data", "items", ...).
    const rawList: any[] = Array.isArray(data)
      ? data
      : data?.documentos ?? data?.data ?? data?.items ?? [];

    if (!Array.isArray(rawList)) {
      throw new Error(
        `Resposta da API do Goldylocks em ${DOCUMENTS_PATH} não contém uma lista de documentos reconhecível. ` +
          `Chaves recebidas: ${Object.keys(data ?? {}).join(", ") || "(nenhuma)"}`
      );
    }

    return rawList
      .map((rawDoc) => this.mapDocumentToServiceOrder(rawDoc))
      .filter((order): order is GoldylocksServiceOrder => order !== null);
  }

  async getClient(externalId: string): Promise<GoldylocksClient | null> {
    const data = await this.requestJson(`/clientes/${encodeURIComponent(externalId)}`);
    if (!data) return null;
    return {
      externalId: String(data.numero ?? externalId),
      name: data.nome ?? `Cliente ${externalId}`,
      taxNumber: data.contribuinte ?? undefined,
      email: data.email ?? undefined,
      phone: data.telefone ?? undefined,
    };
  }
}
