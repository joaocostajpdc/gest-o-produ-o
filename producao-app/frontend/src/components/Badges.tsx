import { PriorityLevel, ServiceOrderStatus, SERVICE_ORDER_STATUS_LABELS } from "../types";

const STATUS_COLORS: Record<ServiceOrderStatus, string> = {
  NAO_INICIADA: "#6b7280",
  EM_PRODUCAO: "#1f3fe0",
  SUSPENSA: "#d97706",
  CONCLUIDA: "#16a34a",
  CANCELADA: "#9ca3af",
};

export function StatusBadge({ status }: { status: ServiceOrderStatus }) {
  return (
    <span className="badge" style={{ background: STATUS_COLORS[status] }}>
      {SERVICE_ORDER_STATUS_LABELS[status]}
    </span>
  );
}

export function PriorityBadge({
  priority,
  label,
  color,
}: {
  priority: PriorityLevel | null;
  label: string | null;
  color: string | null;
}) {
  if (!priority || !color) {
    return <span className="badge badge-neutral">—</span>;
  }
  return (
    <span className="badge" style={{ background: color }}>
      {label}
    </span>
  );
}

export function minutesToHuman(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return `${h}h ${m}min`;
}

// Tal como o "Tempo de produção (dias)" já configurado em cada Produto, os
// tempos acumulados (produção total, permanência numa etapa) mostram-se em
// dias — mais fácil de ler numa escala de vários dias do que em horas — em
// vez de minutos/horas. Arredondado a 1 casa decimal apenas quando não é um
// número inteiro de dias.
export function minutesToDays(minutes: number): string {
  const days = Math.round((minutes / (60 * 24)) * 10) / 10;
  const formatted = days.toLocaleString("pt-PT", {
    minimumFractionDigits: Number.isInteger(days) ? 0 : 1,
    maximumFractionDigits: 1,
  });
  return `${formatted} dia${days === 1 ? "" : "s"}`;
}
