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
  product: {
    id: string;
    name: string;
    category?: string | null;
    externalId?: string;
    description?: string | null;
  };
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
  // Acabamento da encomenda, quando indicado nas Características do Produto.
  finish?: string | null;
  // Características/designação do artigo (texto livre vindo do Goldylocks).
  specifications?: string | null;
}

export type MaterialRequestStatus = "A_PEDIR" | "RECEBIDO";

export const MATERIAL_REQUEST_STATUS_LABELS: Record<MaterialRequestStatus, string> = {
  A_PEDIR: "Por tratar",
  RECEBIDO: "Tratado",
};

export interface MaterialRequest {
  id: string;
  description: string;
  quantity?: string | null;
  supplierId?: string | null;
  supplier?: { id: string; name: string } | null;
  status: MaterialRequestStatus;
  notes?: string | null;
  requestedBy?: { id: string; name: string } | null;
  createdAt: string;
  orderedAt?: string | null;
  receivedAt?: string | null;
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

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  observationId: string | null;
  createdAt: string;
  uploadedBy: { id: string; name: string } | null;
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

// ---------------------------------------------------------------------------
// Pó em Stock (2026-10-13)
// ---------------------------------------------------------------------------

export type PowderLocation = "LAVAGENS" | "ARMAZEM";

export const POWDER_LOCATION_LABELS: Record<PowderLocation, string> = {
  LAVAGENS: "Lavagens",
  ARMAZEM: "Armazém",
};

export type PowderMovementType = "ENTRADA" | "SAIDA" | "ACERTO" | "MUDANCA_LOCAL";

export const POWDER_MOVEMENT_LABELS: Record<PowderMovementType, string> = {
  ENTRADA: "Entrada",
  SAIDA: "Saída",
  ACERTO: "Acerto",
  MUDANCA_LOCAL: "Mudança de local",
};

export interface PowderMovement {
  id: string;
  type: PowderMovementType;
  quantityKg: number;
  balanceKg: number;
  notes?: string | null;
  user?: { id: string; name: string } | null;
  createdAt: string;
}

export interface Powder {
  id: string;
  referencia: string;
  marca: string; // marca do alumínio
  marcaPo?: string | null; // marca do pó
  codigo: string;
  ral?: string | null;
  quantityKg: number;
  location: PowderLocation;
  // Lavagem onde está o pó, quando location = LAVAGENS (um Fornecedor).
  supplierId?: string | null;
  supplier?: { id: string; name: string } | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  movements?: PowderMovement[];
}

// Lançamento faseado de funcionalidades novas (ver FeaturesContext).
export interface FeatureState {
  key: string;
  name: string;
  released: boolean;
  available: boolean;
  releasedAt: string | null;
  // Só vem para administradores: utilizadores escolhidos para testar.
  testerUserIds?: string[];
}

// ---------------------------------------------------------------------------
// Pedidos de Vidros (2026-10-14)
// ---------------------------------------------------------------------------

export type GlassOrderStatus = "POR_ENCOMENDAR" | "ENCOMENDADO" | "FINALIZADO";

export const GLASS_ORDER_STATUS_LABELS: Record<GlassOrderStatus, string> = {
  POR_ENCOMENDAR: "Por encomendar",
  ENCOMENDADO: "Encomendado",
  FINALIZADO: "Finalizado",
};

export interface GlassOrder {
  id: string;
  date: string;
  nRef?: string | null;
  serviceOrderId?: string | null;
  serviceOrder?: { id: string; externalId: string; client?: { name: string } | null } | null;
  supplierId?: string | null;
  supplier?: { id: string; name: string } | null;
  medida: string;
  caixa: string;
  quantity: number;
  status: GlassOrderStatus;
  orderNumber?: string | null;
  expectedDelivery?: string | null;
  notes?: string | null;
  createdBy?: { id: string; name: string } | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Otimização de Corte (2026-10-16) — espelha backend/src/services/cutOptimizer.ts
// ---------------------------------------------------------------------------

export type CutPlanMode = "CHAPAS" | "BARRAS";

export interface SheetPieceInput {
  ref: string;
  description?: string | null;
  width: number;
  length: number;
  qty: number;
  rotate: boolean;
  bends?: number | null;
  cornerCuts?: number | null;
}

export interface BarPieceInput {
  ref: string;
  description?: string | null;
  length: number;
  qty: number;
}

export type CutPlanInput =
  | {
      mode: "CHAPAS";
      pieces: SheetPieceInput[];
      stock: { length: number; width: number; qty?: number | null }[];
      settings: { kerf: number; trim: number };
    }
  | {
      mode: "BARRAS";
      pieces: BarPieceInput[];
      stock: { length: number; qty?: number | null }[];
      settings: { kerf: number; trim: number; minRemnant: number };
    };

export interface UnplacedPiece {
  ref: string;
  typeIndex: number;
  qty: number;
  reason: string;
}

export interface SheetPlacement {
  ref: string;
  typeIndex: number;
  x: number;
  y: number;
  l: number;
  w: number;
  rotated: boolean;
}

export interface SheetLayout {
  index: number;
  stockIndex: number;
  length: number;
  width: number;
  pieces: SheetPlacement[];
  strips: { pos: number; size: number; vertical: boolean }[];
  cuts: number;
  piecesArea: number;
  utilization: number;
}

export interface SheetTotals {
  piecesCount: number;
  piecesM2: number;
  sheetsCount: number;
  sheetsM2: number;
  wasteM2: number;
  yieldPct: number;
  cuts: number;
  bends: number;
  cornerCuts: number;
  byFormat: { length: number; width: number; count: number }[];
}

export interface BarLayout {
  index: number;
  stockIndex: number;
  length: number;
  pieces: { ref: string; typeIndex: number; offset: number; length: number }[];
  usedLength: number;
  remnant: number;
  reusable: boolean;
  cuts: number;
}

export interface BarTotals {
  piecesCount: number;
  piecesM: number;
  barsCount: number;
  barsM: number;
  wasteM: number;
  yieldPct: number;
  cuts: number;
  reusableRemnants: number;
  reusableM: number;
  byLength: { length: number; count: number }[];
}

export type CutResult =
  | { mode: "CHAPAS"; sheets: SheetLayout[]; unplaced: UnplacedPiece[]; totals: SheetTotals }
  | { mode: "BARRAS"; bars: BarLayout[]; unplaced: UnplacedPiece[]; totals: BarTotals };

interface CutPlanBase {
  id: string;
  number: number;
  name: string;
  mode: CutPlanMode;
  material?: string | null;
  notes?: string | null;
  serviceOrderId?: string | null;
  serviceOrder?: { id: string; externalId: string; client?: { name: string } | null } | null;
  createdBy?: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CutPlanSummary extends CutPlanBase {
  piecesTypes: number;
  totals: SheetTotals | BarTotals | null;
  unplacedCount: number;
}

export interface CutPlan extends CutPlanBase {
  input: CutPlanInput;
  result: CutResult;
}
