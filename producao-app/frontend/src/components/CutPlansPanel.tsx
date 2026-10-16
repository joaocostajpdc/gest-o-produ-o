import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { canManageConfig, useAuth } from "../contexts/AuthContext";
import { BarTotals, CutPlanSummary, SheetTotals } from "../types";

// ============================================================================
// Lista de planos de corte (Otimização de Corte, 2026-10-16) — usada na
// página "Otimização de Corte" (todos) e no separador "Cortes" da OS (só os
// dessa OS).
// ============================================================================

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function resultText(p: CutPlanSummary) {
  if (!p.totals) return "—";
  if (p.mode === "CHAPAS") {
    const t = p.totals as SheetTotals;
    const f = t.byFormat.map((x) => `${x.count}× ${x.length}×${x.width}`).join(", ");
    return `${t.sheetsCount} chapa(s)${f ? ` (${f})` : ""} · ${t.piecesM2.toLocaleString("pt-PT")} m² peças`;
  }
  const t = p.totals as BarTotals;
  const f = t.byLength.map((x) => `${x.count}× ${x.length}`).join(", ");
  return `${t.barsCount} barra(s)${f ? ` (${f})` : ""} · ${t.piecesM.toLocaleString("pt-PT")} m peças`;
}

export function CutPlansPanel({ serviceOrder }: { serviceOrder?: { id: string; externalId: string } }) {
  const { user } = useAuth();
  const canWrite = canManageConfig(user?.role);
  const navigate = useNavigate();
  const [plans, setPlans] = useState<CutPlanSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    const q = serviceOrder ? `?serviceOrderId=${encodeURIComponent(serviceOrder.id)}` : "";
    api
      .get<CutPlanSummary[]>(`/cut-plans${q}`)
      .then(setPlans)
      .catch((err) => setError(err instanceof Error ? err.message : "Erro ao carregar os planos."))
      .finally(() => setLoading(false));
  }, [serviceOrder?.id]);

  const term = search.trim().toLowerCase();
  const shown = term
    ? plans.filter((p) =>
        [`pc-${p.number}`, p.name, p.material, p.serviceOrder?.externalId, p.serviceOrder?.client?.name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(term))
      )
    : plans;

  const newLink = serviceOrder
    ? `/otimizacao-corte/novo?os=${encodeURIComponent(serviceOrder.externalId)}`
    : "/otimizacao-corte/novo";

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        {canWrite && (
          <Link to={newLink} className="btn">
            + Novo plano de corte
          </Link>
        )}
        {!serviceOrder && (
          <input
            type="text"
            placeholder="Procurar (nome, OS, cliente, material)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: "1 1 220px", maxWidth: 360 }}
          />
        )}
      </div>
      {error && <p className="error-text">{error}</p>}
      {loading ? (
        <p className="muted">A carregar...</p>
      ) : shown.length === 0 ? (
        <p className="muted">{serviceOrder ? "Ainda não há planos de corte nesta OS." : "Ainda não há planos de corte."}</p>
      ) : (
        <div className="cut-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nº</th>
                <th>Nome</th>
                <th>Tipo</th>
                {!serviceOrder && <th>OS / Cliente</th>}
                <th>Resultado</th>
                <th>Aprov.</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} style={{ cursor: "pointer" }} onClick={() => navigate(`/otimizacao-corte/${p.id}`)}>
                  <td>
                    <strong>PC-{p.number}</strong>
                  </td>
                  <td>
                    {p.name}
                    {p.material && <div className="muted" style={{ fontSize: 12 }}>{p.material}</div>}
                  </td>
                  <td>{p.mode === "CHAPAS" ? "Chapas" : "Barras"}</td>
                  {!serviceOrder && (
                    <td>
                      {p.serviceOrder ? (
                        <>
                          {p.serviceOrder.externalId}
                          <div className="muted" style={{ fontSize: 12 }}>{p.serviceOrder.client?.name}</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  )}
                  <td>
                    {resultText(p)}
                    {p.unplacedCount > 0 && (
                      <div style={{ color: "#dc2626", fontSize: 12, fontWeight: 600 }}>{p.unplacedCount} peça(s) de fora</div>
                    )}
                  </td>
                  <td>{p.totals ? `${p.totals.yieldPct.toLocaleString("pt-PT")}%` : "—"}</td>
                  <td>
                    {formatDate(p.createdAt)}
                    {p.createdBy && <div className="muted" style={{ fontSize: 12 }}>{p.createdBy.name}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
