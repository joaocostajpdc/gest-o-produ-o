import { GoldylocksAdapter, GoldylocksClient, GoldylocksServiceOrder } from "./types";

// ============================================================================
// STUB do adaptador real de integração com o Goldylocks.
//
// TODO: implementar quando os detalhes técnicos da integração estiverem
// definidos (ex.: API REST do Goldylocks, ligação direta à base de dados,
// ficheiros de exportação periódicos, webhook, etc.).
//
// O contrato (GoldylocksAdapter) já está definido em `./types.ts` e é o
// mesmo usado pelo GoldylocksMockAdapter, pelo que a troca de adaptador em
// `factory.ts` não deverá exigir alterações no resto da aplicação.
// ============================================================================

export class GoldylocksRealAdapter implements GoldylocksAdapter {
  constructor(private readonly apiUrl: string, private readonly apiKey: string) {}

  async fetchNewServiceOrders(_since?: Date): Promise<GoldylocksServiceOrder[]> {
    throw new Error(
      "GoldylocksRealAdapter.fetchNewServiceOrders ainda não está implementado. " +
        "Defina o mecanismo de integração real (API/BD/ficheiros) e implemente este método."
    );
  }

  async getClient(_externalId: string): Promise<GoldylocksClient | null> {
    throw new Error(
      "GoldylocksRealAdapter.getClient ainda não está implementado. " +
        "Defina o mecanismo de integração real (API/BD/ficheiros) e implemente este método."
    );
  }
}
