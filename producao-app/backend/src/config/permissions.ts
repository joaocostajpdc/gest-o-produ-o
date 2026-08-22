import { UserRole } from "@prisma/client";

// ============================================================================
// Matriz de Permissões (Tabela de Permissões para cada Perfil de Utilizador)
//
// Define os níveis de acesso mínimos por funcionalidade, conforme secção
// "Gestão de Utilizadores e Permissões" do documento de requisitos.
//
// Os perfis são configuráveis no futuro (ex.: tabela na BD); nesta primeira
// implementação estão centralizados aqui para facilitar a auditoria e
// alteração por quem gere o projeto.
// ============================================================================

export type Permission =
  | "products:read"
  | "products:write"
  | "stages:read"
  | "stages:write"
  | "productionLines:read"
  | "productionLines:write"
  | "suppliers:read"
  | "suppliers:write"
  | "users:read"
  | "users:write"
  | "serviceOrders:read"
  | "serviceOrders:changeStatus"
  | "serviceOrders:changeFlow" // alterações pontuais: avançar/recuar/inserir/omitir/retomar
  | "serviceOrders:delete" // eliminação definitiva de uma Ordem de Serviço (apenas Administração)
  | "interruptions:write"
  | "observations:write"
  | "reports:printable"
  | "materialRequests:read"
  | "materialRequests:write";

const ALL_PERMISSIONS: Permission[] = [
  "products:read",
  "products:write",
  "stages:read",
  "stages:write",
  "productionLines:read",
  "productionLines:write",
  "suppliers:read",
  "suppliers:write",
  "users:read",
  "users:write",
  "serviceOrders:read",
  "serviceOrders:changeStatus",
  "serviceOrders:changeFlow",
  "serviceOrders:delete",
  "interruptions:write",
  "observations:write",
  "reports:printable",
  "materialRequests:read",
  "materialRequests:write",
];

export const PERMISSION_MATRIX: Record<UserRole, Permission[]> = {
  // Administrador - acesso total e gestão da configuração
  ADMINISTRADOR: ALL_PERMISSIONS,

  // Supervisor - gestão e acompanhamento da produção
  SUPERVISOR: [
    "products:read",
    "products:write",
    "stages:read",
    "stages:write",
    "productionLines:read",
    "productionLines:write",
    "suppliers:read",
    "suppliers:write",
    "users:read",
    "serviceOrders:read",
    "serviceOrders:changeStatus",
    "serviceOrders:changeFlow",
    "interruptions:write",
    "observations:write",
    "reports:printable",
    "materialRequests:read",
    "materialRequests:write",
  ],

  // Operário - execução e consulta das operações produtivas
  OPERARIO: [
    "products:read",
    "stages:read",
    "productionLines:read",
    "suppliers:read",
    "serviceOrders:read",
    "serviceOrders:changeStatus",
    "interruptions:write",
    "observations:write",
    "reports:printable",
    "materialRequests:read",
  ],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return PERMISSION_MATRIX[role]?.includes(permission) ?? false;
}
