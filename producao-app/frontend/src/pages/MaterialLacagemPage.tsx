import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { ServiceOrderListItem, Stage } from "../types";
import { minutesToHuman, PriorityBadge, StatusBadge } from "../components/Badges";

// ============================================================================
// Material em Lacagem — atalho direto às Ordens de Serviço cuja etapa atual
// é "Lacagem" (ou seja, o material que está neste momento fora, no
// fornecedor). Reutiliza o mesmo endpoint /service-orders?stageId=... já
// usado no filtro da listagem principal, apenas apresentado como página
// própria no menu, para acesso mais rápido no dia a dia.
// ============================================================================

export function MaterialLacagemPage() {
  const [orders, setOrders] = useState<ServiceOrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stageMissing, setStageMissing] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
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
  }, []);

  return (
    <div>
      <div className="page-header">
        <h2>Material em Lacagem</h2>
      </div>
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
                <th>Na etapa há</th>
                <th>Fornecedor</th>
                <th>Entrega prevista</th>
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
                  <td>{o.currentStage ? minutesToHuman(o.currentStage.residenceMinutes) : "—"}</td>
                  <td>{o.currentStage?.supplier ?? "—"}</td>
                  <td>
                    {o.currentStage?.expectedReturnAt
                      ? new Date(o.currentStage.expectedReturnAt).toLocaleDateString("pt-PT")
                      : "—"}
                  </td>
                </tr>
              ))}
              {!stageMissing && orders.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    Nenhuma Ordem de Serviço está atualmente na etapa de Lacagem.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
