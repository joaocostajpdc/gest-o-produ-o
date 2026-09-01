import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { ServiceOrderListItem, Stage } from "../types";
import { minutesToDays, PriorityBadge, StatusBadge } from "../components/Badges";

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
                    <Link to={`/service-orders/${o.id}`}>{o.externalId}</Link>
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
  );
}
