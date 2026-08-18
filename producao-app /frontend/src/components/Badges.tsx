import { PriorityLevel, ServiceOrderStatus, SERVICE_ORDER_STATUS_LABELS } from "../types";

const STATUS_COLORS: Record<ServiceOrderStatus, string> = {
  NAO_INICIADA: "#6b7280",
  EM_PRODUCAO: "#2f5ce0",
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
