   import { ServiceOrderStatus } from "@prisma/client";

   export type PriorityLevel = "PRAZO_ULTRAPASSADO" | "URGENTE" | "PROXIMO" | "COM_MARGEM";

// ============================================================================
// Serviço de Prioridade / Código de Cores
//
// Determina automaticamente o nível de prioridade de uma Ordem de Serviço
// com base na proximidade da respetiva data-limite de produção, conforme a
// secção "Monitorização Visual dos Prazos" do documento de requisitos.
//
// Os limiares (em horas até à data-limite) são configuráveis abaixo e podem
// ser ajustados/movidos para configuração por categoria no futuro.
// ============================================================================

export const PRIORITY_THRESHOLDS_HOURS = {
  URGENTE: 24, // prazo a decorrer com elevada urgência: <= 24h
  PROXIMO: 72, // prazo próximo: <= 72h
};

export const PRIORITY_COLORS: Record<PriorityLevel, string> = {
  PRAZO_ULTRAPASSADO: "#DC2626", // vermelho
  URGENTE: "#F97316", // laranja
  PROXIMO: "#F5C518", // amarelo
  COM_MARGEM: "#16A34A", // verde
};

export const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  PRAZO_ULTRAPASSADO: "Prazo ultrapassado",
  URGENTE: "Prazo a decorrer com elevada urgência",
  PROXIMO: "Prazo próximo",
  COM_MARGEM: "Prazo com margem suficiente",
};

/**
 * Calcula o nível de prioridade de uma OS a partir da sua data-limite.
 * Ordens de serviço já concluídas/canceladas não têm prioridade operacional.
 */
export function computePriority(
  deadlineAt: Date | null,
  status: ServiceOrderStatus,
  now: Date = new Date()
): PriorityLevel | null {
  if (!deadlineAt) return null;
  if (status === "CONCLUIDA" || status === "CANCELADA") return null;

  const hoursRemaining = (deadlineAt.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (hoursRemaining < 0) return "PRAZO_ULTRAPASSADO";
  if (hoursRemaining <= PRIORITY_THRESHOLDS_HOURS.URGENTE) return "URGENTE";
  if (hoursRemaining <= PRIORITY_THRESHOLDS_HOURS.PROXIMO) return "PROXIMO";
  return "COM_MARGEM";
}

// Ordem usada para ordenar listagens por prioridade decrescente de urgência
// (mais urgente primeiro), com a data-limite como critério secundário.
const PRIORITY_ORDER: Record<PriorityLevel, number> = {
  PRAZO_ULTRAPASSADO: 0,
  URGENTE: 1,
  PROXIMO: 2,
  COM_MARGEM: 3,
};

export function comparePriority(
  a: { priority: PriorityLevel | null; deadlineAt: Date | null },
  b: { priority: PriorityLevel | null; deadlineAt: Date | null }
): number {
  const rankA = a.priority ? PRIORITY_ORDER[a.priority] : 99;
  const rankB = b.priority ? PRIORITY_ORDER[b.priority] : 99;
  if (rankA !== rankB) return rankA - rankB;

  // Critério secundário: data-limite mais próxima primeiro.
  if (a.deadlineAt && b.deadlineAt) {
    return a.deadlineAt.getTime() - b.deadlineAt.getTime();
  }
  if (a.deadlineAt) return -1;
  if (b.deadlineAt) return 1;
  return 0;
}
