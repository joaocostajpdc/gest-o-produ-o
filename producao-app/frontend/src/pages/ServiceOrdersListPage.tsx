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
import { minutesToDays, minutesToHuman, PriorityBadge, StatusBadge } from "../components/Badges";
import { useAuth } from "../contexts/AuthContext";

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

  async function loadOrders() {
    setLoading(true);
    setError(null);
    try {
      const query = buildQuery(filters);
      const data = await api.get<ServiceOrderListItem[]>(`/service-orders${query}`);
      setOrders(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar Ordens de Serviço.");
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

  return (
    <div>
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
          <table>
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
                <tr key={o.id}>
                  <td>
                    <PriorityBadge priority={o.priority} label={o.priorityLabel} color={o.priorityColor} />
                  </td>
                  <td>
                    <Link to={`/service-orders/${o.id}`}>{o.externalId}</Link>
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
                        <div className="muted">{minutesToHuman(o.currentStage.residenceMinutes)} na etapa</div>
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
        )}
      </div>

      <p className="muted">
        Sessão: {user?.name} ({user?.role}) — a ordenação por prioridade é aplicada automaticamente.
      </p>
    </div>
  );
}
