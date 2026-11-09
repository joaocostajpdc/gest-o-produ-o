// Pedido do menu novo (2026-11-09) para a página das OS se filtrar por
// prioridade ("Atenção → Prazo ultrapassado / Urgentes"), mesmo que a página
// já esteja aberta numa aba.
export const OS_FILTER_EVENT = "central:os-filtro";
export const OS_FILTER_KEY = "os.filtroPrioridade";

export function pedirFiltroOS(priority: string) {
  try {
    sessionStorage.setItem(OS_FILTER_KEY, priority);
  } catch {
    /* sem armazenamento */
  }
  window.dispatchEvent(new CustomEvent(OS_FILTER_EVENT, { detail: priority }));
}
