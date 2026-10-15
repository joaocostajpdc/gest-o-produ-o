import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, buildQuery } from "../api/client";
import {
  Client,
  Product,
  ServiceOrderListItem,
  Stage,
  Supplier,
} from "../types";
import { minutesToDays, PriorityBadge, StatusBadge } from "../components/Badges";
import { useAuth } from "../contexts/AuthContext";
import { useFeature } from "../contexts/FeaturesContext";

// Painel lateral de consulta rápida (2026-10-14): só em ecrã de computador
// (≥ 1100px de largura); em telemóvel/tablet continua o cartão ao centro.
const SIDE_PANEL_MIN_WIDTH = 1100;
const MAX_SIDE_PANELS = 8;

function useIsWide(minWidth: number) {
  const query = `(min-width: ${minWidth}px)`;
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setWide(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return wide;
}

const PRIORITY_OPTIONS = [
  { value: "PRAZO_ULTRAPASSADO", label: "Prazo ultrapassado" },
  { value: "URGENTE", label: "Urgente" },
  { value: "PROXIMO", label: "Próximo" },
  { value: "COM_MARGEM", label: "Com margem" },
];

const STATUS_OPTIONS = [
  { value: "NAO_INICIADA", label: "Não iniciada" },
  { value: "EM_PRODUCAO", label: "Em produção" },
  { value: "SUSPENSA", label: "Suspensa" },
  { value: "CONCLUIDA", label: "Concluída" },
  { value: "CANCELADA", label: "Cancelada" },
];

export function ServiceOrdersListPage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<ServiceOrderListItem[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importingPdf, setImportingPdf] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  // Cartão de consulta rápida da OS: abre ao CENTRO do ecrã, só ao clicar no
  // nº da OS na tabela (já não abre ao passar o rato — pedido do utilizador
  // de 2026-10-12: "tira este pop-up assim, quero que abra a meio"). Mostra
  // a informação básica da linha e um botão para avançar de etapa, sem sair
  // da listagem.
  const [quickView, setQuickView] = useState<{ order: ServiceOrderListItem } | null>(null);
  const [quickViewBusy, setQuickViewBusy] = useState(false);
  const [quickViewError, setQuickViewError] = useState<string | null>(null);

  // Painel lateral (pedido do utilizador de 2026-10-14: "quero que o pop-up
  // que abre a meio, quando no computador, abra numa aba no lado esquerdo de
  // modo a poder ir abrindo várias ao mesmo tempo, e que mostre a
  // designação"). Em teste: só para administradores até ser aprovado — os
  // restantes continuam com o cartão ao centro.
  const sidePanelFeature = useFeature("osSidePanel");
  const isWide = useIsWide(SIDE_PANEL_MIN_WIDTH);
  const panelMode = sidePanelFeature.available && isWide;
  const [panels, setPanels] = useState<ServiceOrderListItem[]>([]);
  const [panelBusyId, setPanelBusyId] = useState<string | null>(null);
  const [panelErrors, setPanelErrors] = useState<Record<string, string>>({});

  function openQuickView(order: ServiceOrderListItem) {
    if (panelMode) {
      // A OS clicada vai para o topo da coluna; se já estava aberta, sobe.
      setPanels((prev) => [order, ...prev.filter((p) => p.id !== order.id)].slice(0, MAX_SIDE_PANELS));
      return;
    }
    setQuickView({ order });
    setQuickViewError(null);
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
      await loadOrders();
    } catch (err) {
      setPanelErrors((prev) => ({ ...prev, [orderId]: err instanceof Error ? err.message : "Ocorreu um erro." }));
    } finally {
      setPanelBusyId(null);
    }
  }

  // Enquanto o cartão está aberto: Esc fecha (clicar no fundo escurecido
  // também fecha, ver o overlay mais abaixo) e a página por trás não se
  // desloca.
  useEffect(() => {
    if (!quickView) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setQuickView(null);
    }
    window.addEventListener("keydown", handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickView !== null]);

  // Sempre que a lista é recarregada, os cartões abertos ficam com os dados
  // novos (as OS que deixaram de aparecer nos filtros mantêm-se abertas com
  // a última informação conhecida).
  useEffect(() => {
    setPanels((prev) => prev.map((p) => orders.find((o) => o.id === p.id) ?? p));
  }, [orders]);

  const [filters, setFilters] = useState({
    status: "",
    stageId: "",
    supplierId: "",
    clientId: "",
    priority: "",
    category: "",
    search: "",
  });

  useEffect(() => {
    Promise.all([
      api.get<Stage[]>("/stages"),
      api.get<Supplier[]>("/suppliers"),
      api.get<Client[]>("/clients"),
      api.get<Product[]>("/products"),
    ])
      .then(([s, sup, cl, prod]) => {
        setStages(s);
        setSuppliers(sup);
        setClients(cl);
        setProducts(prod);
      })
      .catch(() => {
        /* filtros são opcionais; falha silenciosa não bloqueia a listagem principal */
      });
  }, []);

  // Categorias de produto disponíveis (ex.: "Mosquiteiras", "Painéis"), para
  // filtrar as OS pela categoria do respetivo produto.
  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-PT"));
  }, [products]);

  // Resumo rápido do que está atualmente à vista (respeita os filtros
  // aplicados), para dar uma leitura imediata do estado da produção sem
  // precisar de percorrer a tabela.
  const stats = useMemo(() => {
    return {
      total: orders.length,
      atrasadas: orders.filter((o) => o.priority === "PRAZO_ULTRAPASSADO").length,
      urgentes: orders.filter((o) => o.priority === "URGENTE").length,
      emProducao: orders.filter((o) => o.status === "EM_PRODUCAO").length,
    };
  }, [orders]);

  // Devolve a lista recebida (além de a guardar em estado) para que quem
  // chama — por exemplo o pop-up de consulta rápida, depois de avançar uma
  // etapa — possa ler de imediato os dados atualizados, sem depender do
  // estado `orders` (que só reflete o novo valor no próximo render).
  async function loadOrders(): Promise<ServiceOrderListItem[]> {
    setLoading(true);
    setError(null);
    try {
      const query = buildQuery(filters);
      const data = await api.get<ServiceOrderListItem[]>(`/service-orders${query}`);
      setOrders(data);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar Ordens de Serviço.");
      return [];
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  async function handleImport() {
    setImporting(true);
    setImportMsg(null);
    try {
      const result = await api.post<{ created: string[]; skipped: { externalId: string; reason: string }[] }>(
        "/service-orders/import"
      );
      setImportMsg(
        `${result.created.length} nova(s) OS importada(s) do Goldylocks.` +
          (result.skipped.length ? ` ${result.skipped.length} ignorada(s).` : "")
      );
      loadOrders();
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : "Erro ao importar do Goldylocks.");
    } finally {
      setImporting(false);
    }
  }

  async function handleImportPdfFile(file: File) {
    setImportingPdf(true);
    setImportMsg(null);
    try {
      const result = await api.postFile<{ status: "created" | "skipped"; externalId: string; reason?: string }>(
        "/service-orders/import-pdf",
        file,
        "application/pdf"
      );
      setImportMsg(
        result.status === "created"
          ? `Ordem de Serviço "${result.externalId}" importada do PDF com sucesso.`
          : `Ordem de Serviço "${result.externalId}" ignorada: ${result.reason}`
      );
      loadOrders();
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : "Erro ao importar o PDF.");
    } finally {
      setImportingPdf(false);
    }
  }

  // Ação disparada a partir do cartão de consulta rápida ("Iniciar
  // produção" / "Avançar etapa"). Depois de concluída, recarrega a lista
  // (para refletir a nova etapa/estado em toda a página) e atualiza o
  // próprio cartão com os dados frescos dessa OS, mantendo a posição onde
  // já estava — se deixar de aparecer nos resultados (ex.: um filtro de
  // estado deixou de a incluir), fecha-se sozinho, tal como a linha
  // desapareceria da tabela.
  async function runQuickViewAction(orderId: string, action: () => Promise<unknown>) {
    setQuickViewError(null);
    setQuickViewBusy(true);
    try {
      await action();
      const data = await loadOrders();
      const updated = data.find((o) => o.id === orderId);
      setQuickView((current) => (updated && current ? { order: updated } : null));
    } catch (err) {
      setQuickViewError(err instanceof Error ? err.message : "Ocorreu um erro.");
    } finally {
      setQuickViewBusy(false);
    }
  }

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
        <h2>Ordens de Serviço</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="btn secondary" onClick={handleImport} disabled={importing}>
            {importing ? "A importar..." : "Importar do Goldylocks"}
          </button>
          <button
            className="btn secondary"
            onClick={() => pdfInputRef.current?.click()}
            disabled={importingPdf}
          >
            {importingPdf ? "A importar PDF..." : "Importar Ordem Serviço (PDF)"}
          </button>
          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportPdfFile(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {importMsg && <p className="muted">{importMsg}</p>}

      <div className="stat-grid">
        <div className="stat-card" style={{ ["--stat-accent" as string]: "#1f3fe0" }}>
          <div className="stat-card-value">{stats.total}</div>
          <div className="stat-card-label">Total de OS</div>
        </div>
        <div className="stat-card" style={{ ["--stat-accent" as string]: "#DC2626" }}>
          <div className="stat-card-value">{stats.atrasadas}</div>
          <div className="stat-card-label">Prazo ultrapassado</div>
        </div>
        <div className="stat-card" style={{ ["--stat-accent" as string]: "#F97316" }}>
          <div className="stat-card-value">{stats.urgentes}</div>
          <div className="stat-card-label">Urgentes</div>
        </div>
        <div className="stat-card" style={{ ["--stat-accent" as string]: "#16A34A" }}>
          <div className="stat-card-value">{stats.emProducao}</div>
          <div className="stat-card-label">Em produção</div>
        </div>
      </div>

      <div className="card">
        <div className="filters-bar">
          <input
            type="text"
            className="os-search"
            placeholder="Pesquisar OS, cliente, nº cliente ou produto..."
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          />
          <select
            value={filters.priority}
            onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}
          >
            <option value="">Prioridade (todas)</option>
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">Estado (todos)</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select value={filters.stageId} onChange={(e) => setFilters((f) => ({ ...f, stageId: e.target.value }))}>
            <option value="">Etapa (todas)</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            value={filters.supplierId}
            onChange={(e) => setFilters((f) => ({ ...f, supplierId: e.target.value }))}
          >
            <option value="">Fornecedor (todos)</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select value={filters.clientId} onChange={(e) => setFilters((f) => ({ ...f, clientId: e.target.value }))}>
            <option value="">Cliente (todos)</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.externalId ? `${c.externalId} — ${c.name}` : c.name}
              </option>
            ))}
          </select>
          <select
            value={filters.category}
            onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
          >
            <option value="">Categoria (todas)</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="error-text">{error}</p>}

        {loading ? (
          <p className="muted">A carregar...</p>
        ) : (
          <div className="os-table-scroll">
          <table className="os-table">
            <thead>
              <tr>
                <th>Prioridade</th>
                <th>OS</th>
                <th>Cliente</th>
                <th>Produto</th>
                <th>Estado</th>
                <th>Etapa atual</th>
                <th>Data de início</th>
                <th>Data-limite</th>
                <th>Tempo de produção</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className={panels.some((p) => p.id === o.id) ? "os-row-open" : undefined}>
                  <td>
                    <PriorityBadge priority={o.priority} label={o.priorityLabel} color={o.priorityColor} />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="link-button"
                      aria-haspopup="dialog"
                      aria-expanded={quickView?.order.id === o.id || panels.some((p) => p.id === o.id)}
                      onClick={() => openQuickView(o)}
                    >
                      {o.externalId}
                    </button>
                  </td>
                  <td>{o.client.name}</td>
                  <td>{o.product.name}</td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td>
                    {o.currentStage ? (
                      <div className="current-stage">
                        <div className="current-stage-name">{o.currentStage.name}</div>
                        <div className="muted">{minutesToDays(o.currentStage.residenceMinutes)} na etapa</div>
                        {o.currentStage.supplier && (
                          <div className="muted">Fornecedor: {o.currentStage.supplier}</div>
                        )}
                        {o.currentStage.expectedReturnAt && (
                          <div className="lead-time-hint">
                            Entrega prevista:{" "}
                            {new Date(o.currentStage.expectedReturnAt).toLocaleDateString("pt-PT")}
                          </div>
                        )}
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{new Date(o.createdAt).toLocaleDateString("pt-PT")}</td>
                  <td>{o.deadlineAt ? new Date(o.deadlineAt).toLocaleString("pt-PT") : "—"}</td>
                  <td>{minutesToDays(o.productionMinutes)}</td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted">
                    Nenhuma Ordem de Serviço encontrada com os filtros selecionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <p className="muted">
        Sessão: {user?.name} ({user?.role}) — a ordenação por prioridade é aplicada automaticamente.
      </p>

      {quickView && (
        <ServiceOrderQuickViewCard
          order={quickView.order}
          busy={quickViewBusy}
          actionError={quickViewError}
          onClose={() => setQuickView(null)}
          onStart={() =>
            runQuickViewAction(quickView.order.id, () => api.post(`/service-orders/${quickView.order.id}/start`))
          }
          onAdvance={() =>
            runQuickViewAction(quickView.order.id, () =>
              api.post(`/service-orders/${quickView.order.id}/stage-flow/advance`)
            )
          }
        />
      )}
      </div>
    </div>
  );
}

// Cartão de consulta rápida aberto a partir da listagem, ao clicar no nº da
// OS: janela centrada no ecrã, com fundo escurecido (clicar fora ou Esc
// fecha). Mostra a informação básica já disponível na linha da tabela (sem
// pedido extra ao servidor) e, tal como na página de detalhe da OS, um
// botão para avançar a produção para a etapa/estado seguinte.
function ServiceOrderQuickViewCard(props: QuickViewBodyProps) {
  return (
    <div className="qv-overlay" onMouseDown={props.onClose}>
      <div
        className="qv-popover"
        role="dialog"
        aria-modal="true"
        aria-label={`Informação rápida da OS ${props.order.externalId}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <QuickViewBody {...props} />
      </div>
    </div>
  );
}

interface QuickViewBodyProps {
  order: ServiceOrderListItem;
  busy: boolean;
  actionError: string | null;
  /** Mostra a designação/características do artigo (painel lateral). */
  showDesignation?: boolean;
  onClose: () => void;
  onStart: () => void;
  onAdvance: () => void;
}

/**
 * Linhas da designação/características do artigo, a partir do texto livre
 * importado do Goldylocks (ex.: "Modelo: MF. QS2", "Dimensões: 2000x800x28").
 * Linhas com vários campos separados por ";" ficam uma por linha; campos sem
 * valor útil ("----") são omitidos.
 */
function designationLines(specifications?: string | null): string[] {
  if (!specifications) return [];
  return specifications
    .split(/\n|;\s*/)
    .map((l) => l.trim().replace(/,\s*$/, "").replace(/^([^:]+):(?=\S)/, "$1: "))
    .filter((l) => l && !/:\s*-{2,}\s*$/.test(l));
}

function QuickViewBody({
  order,
  busy,
  actionError,
  showDesignation,
  onClose,
  onStart,
  onAdvance,
}: QuickViewBodyProps) {
  const designation = showDesignation ? designationLines(order.specifications) : [];
  return (
    <>
      <div className="qv-popover-header">
        <div>
          <h3>{order.externalId}</h3>
          <div className="qv-popover-subtitle">
            {order.client.name} — {order.product.name}
          </div>
          {order.product.description && (
            <div className="qv-popover-description">{order.product.description}</div>
          )}
        </div>
        <button type="button" className="qv-close-btn" onClick={onClose} aria-label="Fechar">
          ×
        </button>
      </div>

      <div className="qv-popover-badges">
        <StatusBadge status={order.status} />
        <PriorityBadge priority={order.priority} label={order.priorityLabel} color={order.priorityColor} />
      </div>

      {showDesignation && (
        <div className="qv-designation">
          <div className="info-tile-label">Designação</div>
          {designation.length > 0 ? (
            designation.map((line, i) => <div key={i}>{line}</div>)
          ) : (
            <div className="muted">Sem características indicadas.</div>
          )}
        </div>
      )}

      <div className="info-tiles">
        <div className="info-tile">
          <div className="info-tile-label">Etapa atual</div>
          <div className="info-tile-value">
            {order.currentStage ? (
              <div className="current-stage">
                <div className="current-stage-name">{order.currentStage.name}</div>
                <div className="muted">{minutesToDays(order.currentStage.residenceMinutes)} na etapa</div>
                {order.currentStage.supplier && (
                  <div className="muted">Fornecedor: {order.currentStage.supplier}</div>
                )}
                {order.currentStage.expectedReturnAt && (
                  <div className="lead-time-hint">
                    Entrega prevista: {new Date(order.currentStage.expectedReturnAt).toLocaleDateString("pt-PT")}
                  </div>
                )}
              </div>
            ) : (
              "—"
            )}
          </div>
        </div>
        <div className="info-tile">
          <div className="info-tile-label">Data de início</div>
          <div className="info-tile-value">{new Date(order.createdAt).toLocaleDateString("pt-PT")}</div>
        </div>
        <div className="info-tile">
          <div className="info-tile-label">Data-limite</div>
          <div className="info-tile-value">
            {order.deadlineAt ? new Date(order.deadlineAt).toLocaleString("pt-PT") : "—"}
          </div>
        </div>
        <div className="info-tile">
          <div className="info-tile-label">Tempo de produção</div>
          <div className="info-tile-value">{minutesToDays(order.productionMinutes)}</div>
        </div>
      </div>

      {actionError && <p className="error-text">{actionError}</p>}

      <div className="qv-popover-actions">
        {order.status === "NAO_INICIADA" && (
          <button className="btn" disabled={busy} onClick={onStart}>
            {busy ? "A iniciar..." : "Iniciar produção"}
          </button>
        )}
        {order.status === "EM_PRODUCAO" && (
          <button className="btn" disabled={busy} onClick={onAdvance}>
            {busy ? "A avançar..." : "Avançar etapa"}
          </button>
        )}
        <Link to={`/service-orders/${order.id}`} className="btn secondary">
          Ver detalhes completos
        </Link>
      </div>
    </>
  );
}
