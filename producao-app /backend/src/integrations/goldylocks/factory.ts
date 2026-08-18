import { GoldylocksAdapter } from "./types";
import { GoldylocksMockAdapter } from "./mockAdapter";
import { GoldylocksRealAdapter } from "./realAdapter.stub";

// Fábrica do adaptador Goldylocks, selecionado por variável de ambiente.
// GOLDYLOCKS_ADAPTER=mock (default) | real
let cachedAdapter: GoldylocksAdapter | null = null;

export function getGoldylocksAdapter(): GoldylocksAdapter {
  if (cachedAdapter) return cachedAdapter;

  const mode = process.env.GOLDYLOCKS_ADAPTER ?? "mock";

  if (mode === "real") {
    cachedAdapter = new GoldylocksRealAdapter(
      process.env.GOLDYLOCKS_API_URL ?? "",
      process.env.GOLDYLOCKS_API_KEY ?? ""
    );
  } else {
    cachedAdapter = new GoldylocksMockAdapter();
  }

  return cachedAdapter;
}
