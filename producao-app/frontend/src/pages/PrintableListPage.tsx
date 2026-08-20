import { useEffect, useMemo, useState } from "react";
import { api, buildQuery, downloadBlob } from "../api/client";
import { PriorityBadge, StatusBadge } from "../components/Badges";
import { Client, PriorityLevel, Product, ServiceOrderStatus, Stage, Supplier } from "../types";

interface ReportRow {
  externalId: string;
  cliente: string;
  produto: string;
  estado: ServiceOrderStatus;
  etapaAtual: string;
  prazo: string;
  prioridade: string;
  prioridadeNivel: PriorityLevel | null;
  prioridadeCor: string | null;
}

const STATUS_OPTIONS = [
  { value: "NAO_INICIADA", label: "Não iniciada" },
  { value: "EM_PRODUCAO", label: "Em produção" },
  { value: "SUSPENSA", label: "Suspensa" },
  { value: "CONCLUIDA", label: "Concluída" },
  { value: "CANCELADA", label: "Cancelada" },
];

const PRIORITY_OPTIONS = [
  { value: "PRAZO_ULTRAPASSADO", label: "Prazo ultrapassado" },
  { value: "URGENTE", label: "Urgente" },
  { value: "PROXIMO", label: "Próximo" },
  { value: "COM_MARGEM", label: "Com margem" },
];

export function PrintableListPage() {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<"csv" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
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
        /* filtros são opcionais; falha silenciosa não bloqueia a listagem */
      });
  }, []);

  // Mesma lógica da listagem principal de OS: categorias de produto
  // disponíveis, derivadas dos produtos existentes.
  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-PT"));
  }, [products]);

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const query = buildQuery(filters);
      const data = await api.get<ReportRow[]>(`/reports/service-orders${query}`);
      setRows(data);
      setGeneratedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao gerar a listagem.");
    } finally {
      setLoading(false);
    }
  }

  async function downloadFile(format: "csv" | "pdf") {
    setDownloading(format);
    setError(null);
    try {
      const query = buildQuery({ ...filters, format });
      const blob = await api.getBlob(`/reports/service-orders${query}`);
      downloadBlob(blob, `listagem-ordens-servico.${format}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Erro ao gerar o ficheiro ${format.toUpperCase()}.`);
    } finally {
      setDownloading(null);
    }
  }

  const filtersSummary = describeFilters(filters);

  return (
    <div>
      <div className="page-header">
        <h2>Listagens Imprimíveis</h2>
      </div>

      <div className="card no-print">
        <p className="muted">
          Gera uma listagem com base nos filtros aplicados — adequada para reuniões de acompanhamento,
          planeamento diário, distribuição entre setores ou consulta offline.
        </p>
        <div className="filters-bar">
          <input
            type="text"
            placeholder="Pesquisar OS, cliente, nº cliente ou produto..."
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          />
          <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">Estado (todos)</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}>
            <option value="">Prioridade (todas)</option>
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
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
          <button className="btn" onClick={loadReport} disabled={loading}>
            {loading ? "A gerar..." : "Gerar listagem"}
          </button>
          <button className="btn secondary" onClick={() => window.print()} disabled={rows.length === 0}>
            Imprimir
          </button>
          <button
            className="btn secondary"
            onClick={() => downloadFile("pdf")}
            disabled={rows.length === 0 || downloading !== null}
          >
            {downloading === "pdf" ? "A gerar PDF..." : "Baixar PDF"}
          </button>
          <button
            className="btn secondary"
            onClick={() => downloadFile("csv")}
            disabled={rows.length === 0 || downloading !== null}
          >
            {downloading === "csv" ? "A gerar CSV..." : "Exportar CSV"}
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>

      <div className="card report-sheet">
        <div className="report-header">
          <div>
            <div className="report-title">Gestão de Produção</div>
            <div className="report-subtitle">Listagem de Ordens de Serviço</div>
          </div>
          {generatedAt && (
            <div className="report-meta">
              <div>Gerado em {generatedAt.toLocaleString("pt-PT")}</div>
              <div>
                {rows.length} Ordem(ns) de Serviço · {filtersSummary}
              </div>
            </div>
          )}
        </div>

        <table>
          <thead>
            <tr>
              <th>OS</th>
              <th>Cliente</th>
              <th>Produto</th>
              <th>Estado</th>
              <th>Etapa atual</th>
              <th>Prazo</th>
              <th>Prioridade</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.externalId}>
                <td>{r.externalId}</td>
                <td>{r.cliente}</td>
                <td>{r.produto}</td>
                <td>
                  <StatusBadge status={r.estado} />
                </td>
                <td>{r.etapaAtual}</td>
                <td>{r.prazo !== "-" ? new Date(r.prazo).toLocaleString("pt-PT") : "-"}</td>
                <td>
                  <PriorityBadge priority={r.prioridadeNivel} label={r.prioridade} color={r.prioridadeCor} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  Sem dados. Escolhe os filtros e clica em "Gerar listagem".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function describeFilters(filters: {
  status: string;
  priority: string;
  category: string;
  search: string;
}): string {
  const parts: string[] = [];
  const statusLabel = STATUS_OPTIONS.find((s) => s.value === filters.status)?.label;
  const priorityLabel = PRIORITY_OPTIONS.find((p) => p.value === filters.priority)?.label;
  if (statusLabel) parts.push(`Estado: ${statusLabel}`);
  if (priorityLabel) parts.push(`Prioridade: ${priorityLabel}`);
  if (filters.category) parts.push(`Categoria: ${filters.category}`);
  if (filters.search) parts.push(`Pesquisa: "${filters.search}"`);
  return parts.length ? parts.join(" · ") : "Sem filtros aplicados";
}
