import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useFeature } from "../contexts/FeaturesContext";
import { MAX_SIDE_PANELS, QuickViewBody, SIDE_PANEL_MIN_WIDTH, useIsWide } from "./ServiceOrdersListPage";
import { ServiceOrderListItem, Stage } from "../types";
import { minutesToDays, PriorityBadge, StatusBadge } from "../components/Badges";
import { GuiaLacagemModal } from "../components/GuiaLacagemModal";
import { FeatureTestBanner } from "../components/FeatureTestBanner";

// ============================================================================
// Material em Lacagem — atalho direto às Ordens de Serviço cuja etapa atual
// é "Lacagem" (ou seja, o material que está neste momento fora, no
// fornecedor). Reutiliza o mesmo endpoint /service-orders?stageId=... já
// usado no filtro da listagem principal, apenas apresentado como página
// própria no menu, para acesso mais rápido no dia a dia.
//
// Mostra o nº do cliente (em vez do nome) e o tempo na etapa em dias, e
// permite filtrar por fornecedor e por acabamento — ver pedido do
// utilizador de 2026-09-01.
// ============================================================================

export function MaterialLacagemPage() {
  const [orders, setOrders] = useState<ServiceOrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stageMissing, setStageMissing] = useState(false);
  const [supplierFilter, setSupplierFilter] = useState("");
  const [finishFilter, setFinishFilter] = useState("");

  // Painel lateral, como nas Ordens de Serviço (pedido do utilizador de
  // 2026-10-28: "aqui também vá abrindo ao lado"). No computador, clicar no
  // nº da OS abre-a numa coluna à esquerda e podem ficar várias abertas.
  const sidePanel = useFeature("osSidePanel");
  const isWide = useIsWide(SIDE_PANEL_MIN_WIDTH);
  const panelMode = sidePanel.available && isWide;
  const [panels, setPanels] = useState<ServiceOrderListItem[]>([]);
  const [panelBusyId, setPanelBusyId] = useState<string | null>(null);
  const [panelErrors, setPanelErrors] = useState<Record<string, string>>({});
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);
  // Submeter guia da Lacagem (pedido de 2026-10-30) — em teste: "guiaLacagem".
  const guiaFeature = useFeature("guiaLacagem");
  const [guiaOpen, setGuiaOpen] = useState(false);

  function openPanel(order: ServiceOrderListItem) {
    setPanels((prev) => [order, ...prev.filter((p) => p.id !== order.id)].slice(0, MAX_SIDE_PANELS));
  }
  function closePanel(id: string) {
    setPanels((prev) => prev.filter((p) => p.id !== id));
    setPanelErrors(({ [id]: _removed, ...rest }) => rest);
  }
  async function runPanelAction(orderId: string, action: () => Promise<unknown>) {
    setPanelErrors(({ [orderId]: _removed, ...rest }) => rest);
    setPanelBusyId(orderId);
    try {
      await action();
      refresh();
    } catch (err) {
      setPanelErrors((prev) => ({ ...prev, [orderId]: err instanceof Error ? err.message : "Ocorreu um erro." }));
    } finally {
      setPanelBusyId(null);
    }
  }
  useEffect(() => {
    setPanels((prev) => prev.map((p) => orders.find((o) => o.id === p.id) ?? p));
  }, [orders]);

  useEffect(() => {
    async function load() {
      if (reload === 0) setLoading(true);
      setError(null);
      try {
        const stages = await api.get<Stage[]>("/stages");
        const lacagem = stages.find((s) => s.name.trim().toLowerCase() === "lacagem");
        if (!lacagem) {
          setStageMissing(true);
          setOrders([]);
          return;
        }
        const data = await api.get<ServiceOrderListItem[]>(
          `/service-orders?stageId=${encodeURIComponent(lacagem.id)}`
        );
        setOrders(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao carregar o material em Lacagem.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [reload]);

  // As opções dos filtros vêm apenas dos fornecedores/acabamentos que
  // existem de facto entre as OS atualmente em Lacagem — evita mostrar
  // opções que não dariam resultado nenhum.
  const supplierOptions = useMemo(() => {
    const set = new Set<string>();
    orders.forEach((o) => {
      if (o.currentStage?.supplier) set.add(o.currentStage.supplier);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-PT"));
  }, [orders]);

  const finishOptions = useMemo(() => {
    const set = new Set<string>();
    orders.forEach((o) => {
      if (o.finish) set.add(o.finish);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-PT"));
  }, [orders]);

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (supplierFilter && o.currentStage?.supplier !== supplierFilter) return false;
      if (finishFilter && o.finish !== finishFilter) return false;
      return true;
    });
  }, [orders, supplierFilter, finishFilter]);

  const showPanels = panelMode && panels.length > 0;

  return (
    <div className={showPanels ? "os-split" : undefined}>
      {showPanels && (
        <aside className="os-side-panel" aria-label="Ordens de Serviço abertas">
          <div className="os-side-panel-head">
            <span>
              {panels.length} OS aberta{panels.length > 1 ? "s" : ""}
            </span>
            {panels.length > 1 && (
              <button type="button" className="link-button" onClick={() => setPanels([])}>
                Fechar todas
              </button>
            )}
          </div>
          {panels.map((p) => (
            <div key={p.id} className="os-side-card">
              <QuickViewBody
                order={p}
                busy={panelBusyId === p.id}
                actionError={panelErrors[p.id] ?? null}
                showDesignation
                onClose={() => closePanel(p.id)}
                onStart={() => runPanelAction(p.id, () => api.post(`/service-orders/${p.id}/start`))}
                onAdvance={() => runPanelAction(p.id, () => api.post(`/service-orders/${p.id}/stage-flow/advance`))}
              />
            </div>
          ))}
        </aside>
      )}
      <div className="os-split-main">
      <div className="page-header">
        <h2>Material em Lacagem</h2>
        {guiaFeature.available && (
          <button type="button" className="btn" onClick={() => setGuiaOpen(true)}>
            Submeter guia
          </button>
        )}
      </div>
      {guiaFeature.available && <FeatureTestBanner featureKey="guiaLacagem" label="o botão Submeter guia" />}
      {guiaOpen && <GuiaLacagemModal onClose={() => setGuiaOpen(false)} onDone={refresh} />}
      <p className="muted" style={{ marginBottom: 16 }}>
        Ordens de Serviço cuja etapa atual é a Lacagem — o material que está neste momento fora, no fornecedor.
      </p>

      {stageMissing && (
        <p className="error-text">
          Não existe nenhuma etapa chamada "Lacagem" configurada em Etapas.
        </p>
      )}
      {error && <p className="error-text">{error}</p>}

      <div className="card">
        {!stageMissing && (
          <div className="filters-bar">
            <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
              <option value="">Fornecedor (todos)</option>
              {supplierOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select value={finishFilter} onChange={(e) => setFinishFilter(e.target.value)}>
              <option value="">Acabamento (todos)</option>
              {finishOptions.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        )}

        {loading ? (
          <p className="muted">A carregar...</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Prioridade</th>
                <th>OS</th>
                <th>Nº Cliente</th>
                <th>Produto</th>
                <th>Estado</th>
                <th>Na etapa há</th>
                <th>Fornecedor</th>
                <th>Entrega prevista</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((o) => (
                <tr key={o.id}>
                  <td>
                    <PriorityBadge priority={o.priority} label={o.priorityLabel} color={o.priorityColor} />
                  </td>
                  <td>
                    {panelMode ? (
                      <button
                        type="button"
                        className="link-button"
                        aria-expanded={panels.some((p) => p.id === o.id)}
                        onClick={() => openPanel(o)}
                      >
                        {o.externalId}
                      </button>
                    ) : (
                      <Link to={`/service-orders/${o.id}`}>{o.externalId}</Link>
                    )}
                  </td>
                  <td>{o.client.externalId ?? "—"}</td>
                  <td>{o.product.name}</td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td>{o.currentStage ? minutesToDays(o.currentStage.residenceMinutes) : "—"}</td>
                  <td>{o.currentStage?.supplier ?? "—"}</td>
                  <td>
                    {o.currentStage?.expectedReturnAt
                      ? new Date(o.currentStage.expectedReturnAt).toLocaleDateString("pt-PT")
                      : "—"}
                  </td>
                </tr>
              ))}
              {!stageMissing && filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    {orders.length === 0
                      ? "Nenhuma Ordem de Serviço está atualmente na etapa de Lacagem."
                      : "Nenhuma Ordem de Serviço corresponde aos filtros selecionados."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
    </div>
  );
}
