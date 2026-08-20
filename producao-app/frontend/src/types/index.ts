// ============================================================================
// Tipos partilhados do frontend (espelham os modelos/enums do backend).
// ============================================================================

export type UserRole = "ADMINISTRADOR" | "SUPERVISOR" | "OPERARIO";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export type ServiceOrderStatus =
  | "NAO_INICIADA"
  | "EM_PRODUCAO"
  | "SUSPENSA"
  | "CONCLUIDA"
  | "CANCELADA";

export const SERVICE_ORDER_STATUS_LABELS: Record<ServiceOrderStatus, string> = {
  NAO_INICIADA: "Não iniciada",
  EM_PRODUCAO: "Em produção",
  SUSPENSA: "Suspensa",
  CONCLUIDA: "Concluída",
  CANCELADA: "Cancelada",
};

export type PriorityLevel = "PRAZO_ULTRAPASSADO" | "URGENTE" | "PROXIMO" | "COM_MARGEM";

export type InterruptionReason =
  | "FALTA_MATERIA_PRIMA"
  | "AVARIA_EQUIPAMENTO"
  | "FALTA_CAPACIDADE"
  | "AGUARDAR_INFORMACAO"
  | "AGUARDAR_APROVACAO"
  | "AGUARDAR_FORNECEDOR"
  | "PROBLEMA_QUALIDADE"
  | "OUTRO";

export const INTERRUPTION_REASON_LABELS: Record<InterruptionReason, string> = {
  FALTA_MATERIA_PRIMA: "Falta de matéria-prima",
  AVARIA_EQUIPAMENTO: "Avaria de equipamento",
  FALTA_CAPACIDADE: "Falta de capacidade",
  AGUARDAR_INFORMACAO: "Aguardar informação",
  AGUARDAR_APROVACAO: "Aguardar aprovação",
  AGUARDAR_FORNECEDOR: "Aguardar fornecedor",
  PROBLEMA_QUALIDADE: "Problema de qualidade",
  OUTRO: "Outro",
};

export interface Product {
  id: string;
  externalId?: string | null;
  name: string;
  description?: string | null;
  category?: string | null;
  productionDays: number;
}

export interface Stage {
  id: string;
  name: string;
  description?: string | null;
  requiresSupplier: boolean;
}

export interface SupplierLeadTime {
  id: string;
  supplierId: string;
  category: string;
  leadDays: number;
}

export interface Supplier {
  id: string;
  name: string;
  contact?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  leadTimes?: SupplierLeadTime[];
}

export interface ProductionLineStep {
  id: string;
  productId: string;
  product?: Product;
  stageId: string;
  stage?: Stage;
  order: number;
  defaultSupplierId?: string | null;
  defaultSupplier?: Supplier | null;
}

export interface ServiceOrderListItem {
  id: string;
  externalId: string;
  status: ServiceOrderStatus;
  client: { id: string; name: string; externalId?: string };
  product: { id: string; name: string; category?: string | null; externalId?: string };
  createdAt: string;
  deadlineAt: string | null;
  priority: PriorityLevel | null;
  priorityLabel: string | null;
  priorityColor: string | null;
  currentStage: {
    id: string;
    name: string;
    supplier: string | null;
    residenceMinutes: number;
    // Preenchido apenas quando a etapa atual é "Lacagem" e existe um prazo
    // de entrega configurado para [fornecedor, categoria do produto].
    expectedReturnAt: string | null;
    leadDays: number | null;
  } | null;
  productionMinutes: number;
}

export interface StageInstance {
  id: string;
  stageId: string;
  stage: Stage;
  order: number;
  status: "PENDENTE" | "ATIVA" | "CONCLUIDA" | "OMITIDA";
  supplierId?: string | null;
  supplier?: Supplier | null;
  enteredAt: string | null;
  exitedAt: string | null;
  residenceMinutes: number;
  wasManuallyAdded: boolean;
  wasSkipped: boolean;
}

export interface Interruption {
  id: string;
  serviceOrderId: string;
  reason: InterruptionReason;
  otherDescription?: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
  user: { id: string; name: string };
}

export interface Observation {
  id: string;
  serviceOrderId: string;
  stageInstanceId?: string | null;
  stageInstance?: { id: string; stage: { name: string } } | null;
  text: string;
  createdAt: string;
  editedAt: string | null;
  user: { id: string; name: string };
}

export interface HistoryEvent {
  id: string;
  serviceOrderId: string;
  type: string;
  description: string;
  createdAt: string;
  user?: { id: string; name: string; role: UserRole } | null;
}

export interface ServiceOrderDetail extends ServiceOrderListItem {
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  specifications?: string | null;
  stageInstances: StageInstance[];
  interruptions: Interruption[];
  observations: Observation[];
}

export interface Client {
  id: string;
  externalId: string;
  name: string;
  taxNumber?: string | null;
}
