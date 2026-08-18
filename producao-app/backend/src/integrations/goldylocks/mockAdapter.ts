import {
  GoldylocksAdapter,
  GoldylocksClient,
  GoldylocksServiceOrder,
} from "./types";

// ============================================================================
// Adaptador MOCK do Goldylocks.
//
// Simula a origem externa das Ordens de Serviço enquanto os detalhes técnicos
// da integração real (API? base de dados partilhada? ficheiros?) não estão
// definidos. Gera um pequeno catálogo de clientes/produtos fictícios e
// permite "criar" novas Ordens de Serviço simuladas via `simulateNewOrder`,
// útil para testar o fluxo de importação a partir da aplicação de produção.
// ============================================================================

const MOCK_CLIENTS: GoldylocksClient[] = [
  { externalId: "CLI-001", name: "Marcenaria Silva & Filhos", taxNumber: "500123456" },
  { externalId: "CLI-002", name: "Interiores Modernos, Lda", taxNumber: "501234567" },
  { externalId: "CLI-003", name: "Construções Almeida", taxNumber: "502345678" },
  { externalId: "CLI-004", name: "Studio Decor", taxNumber: "503456789" },
];

const MOCK_PRODUCTS = [
  { externalId: "PRD-100", name: "Painel Liso 2400x1200", categoryHint: "Painéis Lisos" },
  { externalId: "PRD-101", name: "Painel Fresado Clássico", categoryHint: "Painel Fresado" },
  { externalId: "PRD-102", name: "Painel Fresado Moderno", categoryHint: "Painel Fresado" },
  { externalId: "PRD-103", name: "Porta Lacada Branca", categoryHint: "Portas Lacadas" },
];

let mockOrderCounter = 1000;

export class GoldylocksMockAdapter implements GoldylocksAdapter {
  private pendingOrders: GoldylocksServiceOrder[] = [];

  constructor() {
    // Popula um conjunto inicial de OS simuladas por importar.
    this.pendingOrders = [
      this.buildOrder(0, 0),
      this.buildOrder(1, 1),
      this.buildOrder(2, 2),
      this.buildOrder(3, 3),
      this.buildOrder(0, 1),
    ];
  }

  private buildOrder(clientIdx: number, productIdx: number): GoldylocksServiceOrder {
    mockOrderCounter += 1;
    return {
      externalId: `OS-${mockOrderCounter}`,
      client: MOCK_CLIENTS[clientIdx],
      product: MOCK_PRODUCTS[productIdx],
      createdAt: new Date().toISOString(),
    };
  }

  async fetchNewServiceOrders(_since?: Date): Promise<GoldylocksServiceOrder[]> {
    const orders = [...this.pendingOrders];
    this.pendingOrders = []; // simula "consumo" da fila de importação
    return orders;
  }

  async getClient(externalId: string): Promise<GoldylocksClient | null> {
    return MOCK_CLIENTS.find((c) => c.externalId === externalId) ?? null;
  }

  /** Utilitário de teste: simula a chegada de uma nova OS no Goldylocks. */
  simulateNewOrder(clientIdx = 0, productIdx = 0) {
    this.pendingOrders.push(this.buildOrder(clientIdx, productIdx));
  }
}
