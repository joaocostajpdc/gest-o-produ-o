// ============================================================================
// Sonda temporária da API do Goldylocks (2026-10-20) — para descobrir o
// formato das respostas (Ordens de Serviço, encomendas a fornecedor) antes de
// ligar a integração. Só corre quando GOLDYLOCKS_PROBE=1 e escreve no log do
// servidor um resumo de cada resposta (sem a chave). Não grava nada.
// Formato da API: https://app.goldylocks.pt/<alias>/api/?api=<chave>&t=<tipo>
// ============================================================================

const DEFAULT_QUERIES = [
  "tiposdocumento",
  "documentos&id_tipo_documento=1",
  "documentos&tipo=1",
  "documentos&data_inicio=2026-10-19&data_fim=2026-10-20",
  "documentos&datai=2026-10-19&dataf=2026-10-20",
  "documentos&p=2026/450",
  "documento&id=21613",
  "linhasdocumento&id=21613",
  "documentolinhas&id=21613",
  "estadosdocumento",
];

function summarize(t: string, body: string) {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return `nao-json: ${body.replace(/\s+/g, " ").slice(0, 600)}`;
  }
  if (t.startsWith("tiposdocumento") && Array.isArray(data)) {
    return data
      .map((d: Record<string, unknown>) => `${d.id_tipo_documento}=${d.tipo_documento}[${d.natureza}|${d.tipo}|prod${d.controla_producao}]`)
      .join("; ");
  }
  if (Array.isArray(data)) {
    const tipos: Record<string, number> = {};
    for (const d of data as Record<string, unknown>[]) {
      const k = String(d.id_tipo_documento ?? "?");
      tipos[k] = (tipos[k] ?? 0) + 1;
    }
    const first = data[0] ? JSON.stringify(data[0]).slice(0, 1800) : "";
    return `array n=${data.length} porTipo=${JSON.stringify(tipos).slice(0, 400)} primeiro=${first}`;
  }
  return `objeto: ${JSON.stringify(data).slice(0, 2500)}`;
}

export async function goldylocksProbe() {
  if (process.env.GOLDYLOCKS_PROBE !== "1") return;
  const alias = process.env.GOLDYLOCKS_ALIAS;
  const key = process.env.GOLDYLOCKS_API_KEY;
  if (!alias || !key) {
    // eslint-disable-next-line no-console
    console.log("[goldylocks-probe] falta GOLDYLOCKS_ALIAS ou GOLDYLOCKS_API_KEY");
    return;
  }
  const queries = process.env.GOLDYLOCKS_PROBE_QUERIES
    ? process.env.GOLDYLOCKS_PROBE_QUERIES.split("|").map((x) => x.trim()).filter(Boolean)
    : DEFAULT_QUERIES;
  for (const q of queries) {
    const url = `https://app.goldylocks.pt/${encodeURIComponent(alias)}/api/?api=${encodeURIComponent(key)}&t=${q}`;
    try {
      const r = await fetch(url, { method: "POST" });
      const body = await r.text();
      // eslint-disable-next-line no-console
      console.log(`[goldylocks-probe] q=${q} status=${r.status} len=${body.length} ${summarize(q, body)}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log(`[goldylocks-probe] q=${q} erro=${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
