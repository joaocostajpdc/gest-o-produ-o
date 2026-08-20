// ============================================================================
// Tipos partilhados da integração com o Goldylocks (software de faturação).
//
// As Ordens de Serviço são criadas no Goldylocks, não na aplicação de
// produção. Este módulo define o contrato mínimo que qualquer adaptador
// (mock ou real) deve implementar para disponibilizar essa informação à
// aplicação de produção.
// ============================================================================

export interface GoldylocksClient {
  externalId: string;
  name: string;
  taxNumber?: string;
  email?: string;
  phone?: string;
}

export interface GoldylocksProduct {
  externalId: string;
  name: string;
  description?: string;
  categoryHint?: string; // nome de categoria sugerido, se o Goldylocks o fornecer
}

export interface GoldylocksServiceOrder {
  externalId: string;
  client: GoldylocksClient;
  product: GoldylocksProduct;
  createdAt: string; // ISO date
  notes?: string;
  /**
   * Data-limite de entrega, quando o próprio documento do Goldylocks já a
   * indica (linha "Prazo de entrega:" na Ordem Serviço). Quando presente,
   * substitui o cálculo padrão (data de importação + prazo do produto) —
   * cobre o caso de encomendas com um prazo pontual diferente do standard.
   */
  deadlineAt?: string; // ISO date
}

// Contrato de integração: a aplicação de produção consome apenas estes
// métodos, o que permite substituir o mock por uma implementação real
// (API REST, base de dados partilhada, ficheiros de exportação, etc.) sem
// alterar o resto do código.
export interface GoldylocksAdapter {
  /**
   * Devolve as Ordens de Serviço criadas no Goldylocks que ainda não foram
   * importadas para a aplicação de produção (ou todas, desde uma data).
   */
  fetchNewServiceOrders(since?: Date): Promise<GoldylocksServiceOrder[]>;

  /** Consulta os dados atuais de um cliente pelo id externo. */
  getClient(externalId: string): Promise<GoldylocksClient | null>;
}
