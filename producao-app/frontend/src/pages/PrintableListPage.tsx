import { useState } from "react";
import { api, buildQuery } from "../api/client";

interface ReportRow {
  externalId: string;
  cliente: string;
  produto: string;
  estado: string;
  etapaAtual: string;
  prazo: string;
  prioridade: string;
}

export function PrintableListPage() {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ status: "", priority: "" });

  async function loadReport() {
    setLoading(true);
    try {
      const query = buildQuery(filters);
      const data = await api.get<ReportRow[]>(`/reports/service-orders${query}`);
      setRows(data);
    } finally {
      setLoading(false);
    }
  }

  function downloadCsv() {
    const query = buildQuery({ ...filters, format: "csv" });
    window.open(`/api/reports/service-orders${query}`, "_blank");
  }

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
            <option value="NAO_INICIADA">Não iniciada</option>
            <option value="EM_PRODUCAO">Em produção</option>
            <option value="SUSPENSA">Suspensa</option>
            <option value="CONCLUIDA">Concluída</option>
            <option value="CANCELADA">Cancelada</option>
          </select>
          <select value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}>
            <option value="">Prioridade (todas)</option>
            <option value="PRAZO_ULTRAPASSADO">Prazo ultrapassado</option>
            <option value="URGENTE">Urgente</option>
            <option value="PROXIMO">Próximo</option>
            <option value="COM_MARGEM">Com margem</option>
          </select>
          <button className="btn" onClick={loadReport} disabled={loading}>
            {loading ? "A gerar..." : "Gerar listagem"}
          </button>
          <button className="btn secondary" onClick={() => window.print()} disabled={rows.length === 0}>
            Imprimir
          </button>
          <button className="btn secondary" onClick={downloadCsv}>
            Exportar CSV
          </button>
        </div>
      </div>

      <div className="card">
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
                <td>{r.estado}</td>
                <td>{r.etapaAtual}</td>
                <td>{r.prazo !== "-" ? new Date(r.prazo).toLocaleString("pt-PT") : "-"}</td>
                <td>{r.prioridade}</td>
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
