import { useState } from "react";
import { api, buildQuery, downloadBlob } from "../api/client";
import { PriorityBadge, StatusBadge } from "../components/Badges";
import { PriorityLevel, ServiceOrderStatus } from "../types";

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
  const [filters, setFilters] = useState({ status: "", priority: "" });

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

function describeFilters(filters: { status: string; priority: string }): string {
  const parts: string[] = [];
  const statusLabel = STATUS_OPTIONS.find((s) => s.value === filters.status)?.label;
  const priorityLabel = PRIORITY_OPTIONS.find((p) => p.value === filters.priority)?.label;
  if (statusLabel) parts.push(`Estado: ${statusLabel}`);
  if (priorityLabel) parts.push(`Prioridade: ${priorityLabel}`);
  return parts.length ? parts.join(" · ") : "Sem filtros aplicados";
}
