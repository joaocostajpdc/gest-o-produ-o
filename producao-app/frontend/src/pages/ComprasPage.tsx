import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api } from "../api/client";
import { useFeature } from "../contexts/FeaturesContext";
import { FeatureTestBanner } from "../components/FeatureTestBanner";
import { GLASS_ORDER_STATUS_LABELS, GlassOrder, MaterialRequest } from "../types";

// ============================================================================
// Compras — pedido do utilizador de 2026-10-20 ("cria já uma aba para
// compras"). Junta numa só página o que está por comprar ou por chegar:
// Material a Pedir e Pedidos de Vidros. Cada lista continua a ser gerida na
// sua própria página (atalhos no topo de cada bloco).
// Em teste: só o administrador vê até aprovar (ver FeatureTestBanner).
// ============================================================================

const FEATURE_KEY = "compras";

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-PT");
}

export function ComprasPage() {
  const feature = useFeature(FEATURE_KEY);
  const glass = useFeature("glassOrders");
  const [materials, setMaterials] = useState<MaterialRequest[] | null>(null);
  const [glassOrders, setGlassOrders] = useState<GlassOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!feature.available) return;
    api
      .get<MaterialRequest[]>("/material-requests")
      .then((l) => setMaterials(l.filter((m) => m.status === "A_PEDIR")))
      .catch((e) => {
        setMaterials([]);
        setError(e instanceof Error ? e.message : "Erro ao carregar o material a pedir.");
      });
  }, [feature.available]);

  useEffect(() => {
    if (!feature.available || !glass.available) return;
    api
      .get<GlassOrder[]>("/glass-orders")
      .then((l) => setGlassOrders(l.filter((g) => g.status !== "FINALIZADO")))
      .catch(() => setGlassOrders([]));
  }, [feature.available, glass.available]);

  if (feature.loading) return <div className="muted">A carregar...</div>;
  if (!feature.available) return <Navigate to="/" replace />;

  const porEncomendar = (glassOrders ?? []).filter((g) => g.status === "POR_ENCOMENDAR");
  const encomendados = (glassOrders ?? []).filter((g) => g.status === "ENCOMENDADO");

  return (
    <div>
      <div className="page-header">
        <h2>Compras</h2>
      </div>
      <FeatureTestBanner featureKey={FEATURE_KEY} label="a página Compras" />

      <div className="stat-grid">
        <div className="stat-card" style={{ ["--stat-accent" as string]: "#dc2626" }}>
          <div className="stat-card-value">{materials ? materials.length : "…"}</div>
          <div className="stat-card-label">Material a pedir</div>
        </div>
        {glass.available && (
          <>
            <div className="stat-card" style={{ ["--stat-accent" as string]: "#d97706" }}>
              <div className="stat-card-value">{glassOrders ? porEncomendar.length : "…"}</div>
              <div className="stat-card-label">Vidros por encomendar</div>
            </div>
            <div className="stat-card" style={{ ["--stat-accent" as string]: "#1f3fe0" }}>
              <div className="stat-card-value">{glassOrders ? encomendados.length : "…"}</div>
              <div className="stat-card-label">Vidros encomendados (por chegar)</div>
            </div>
          </>
        )}
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Material a pedir</h3>
          <Link to="/material-a-pedir">Gerir material a pedir →</Link>
        </div>
        {materials === null ? (
          <p className="muted">A carregar...</p>
        ) : materials.length === 0 ? (
          <p className="muted">Nada por pedir.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Quant.</th>
                  <th>Fornecedor</th>
                  <th>Pedido por</th>
                  <th>Desde</th>
                </tr>
              </thead>
              <tbody>
                {materials.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.description}</strong>
                      {m.notes && <div className="muted" style={{ fontSize: 12 }}>{m.notes}</div>}
                    </td>
                    <td>{m.quantity || "—"}</td>
                    <td>{m.supplier?.name || "—"}</td>
                    <td>{m.requestedBy?.name || "—"}</td>
                    <td>{fmtDate(m.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {glass.available && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Vidros por encomendar e por chegar</h3>
            <Link to="/pedidos-vidros">Gerir pedidos de vidros →</Link>
          </div>
          {glassOrders === null ? (
            <p className="muted">A carregar...</p>
          ) : glassOrders.length === 0 ? (
            <p className="muted">Nenhum vidro pendente.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Estado</th>
                    <th>N/Ref.</th>
                    <th>Fornecedor</th>
                    <th>Medida</th>
                    <th>Caixa</th>
                    <th>Quant.</th>
                    <th>Nº Encomenda</th>
                    <th>Previsão</th>
                  </tr>
                </thead>
                <tbody>
                  {glassOrders.map((g) => (
                    <tr key={g.id}>
                      <td>
                        <span className="badge" style={{ background: g.status === "POR_ENCOMENDAR" ? "#d97706" : "#1f3fe0" }}>
                          {GLASS_ORDER_STATUS_LABELS[g.status]}
                        </span>
                      </td>
                      <td>{g.serviceOrder ? <Link to={`/service-orders/${g.serviceOrder.id}`}>{g.nRef || g.serviceOrder.externalId}</Link> : g.nRef || "—"}</td>
                      <td>{g.supplier?.name || "—"}</td>
                      <td>{g.medida}</td>
                      <td>{g.caixa}</td>
                      <td>{g.quantity}</td>
                      <td>{g.orderNumber || "—"}</td>
                      <td>{g.expectedDelivery || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
