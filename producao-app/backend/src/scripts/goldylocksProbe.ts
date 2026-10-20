// ============================================================================
// Sonda temporária da API do Goldylocks (2026-10-20) — para descobrir o
// formato das respostas (Ordens de Serviço, encomendas a fornecedor) antes de
// ligar a integração. Só corre quando GOLDYLOCKS_PROBE=1 e escreve no log do
// servidor o início de cada resposta (sem a chave). Não grava nada.
// Formato da API: https://app.goldylocks.pt/<alias>/api/?api=<chave>&t=<tipo>
// ============================================================================

const TYPES = (process.env.GOLDYLOCKS_PROBE_TYPES ??
  "artigos,documentos,listadocumentos,tiposdocumento,tiposdocumentos,series,ordensservico,encomendas,encomendasfornecedor,fornecedores")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);

export async function goldylocksProbe() {
  if (process.env.GOLDYLOCKS_PROBE !== "1") return;
  const alias = process.env.GOLDYLOCKS_ALIAS;
  const key = process.env.GOLDYLOCKS_API_KEY;
  if (!alias || !key) {
    // eslint-disable-next-line no-console
    console.log("[goldylocks-probe] falta GOLDYLOCKS_ALIAS ou GOLDYLOCKS_API_KEY");
    return;
  }
  const extra = process.env.GOLDYLOCKS_PROBE_QS ?? "";
  for (const t of TYPES) {
    const url = `https://app.goldylocks.pt/${encodeURIComponent(alias)}/api/?api=${encodeURIComponent(key)}&t=${encodeURIComponent(t)}${extra ? "&" + extra : ""}`;
    try {
      const r = await fetch(url, { method: "POST" });
      const body = (await r.text()).replace(/\s+/g, " ");
      // eslint-disable-next-line no-console
      console.log(`[goldylocks-probe] t=${t} status=${r.status} len=${body.length} body=${body.slice(0, 1500)}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log(`[goldylocks-probe] t=${t} erro=${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
