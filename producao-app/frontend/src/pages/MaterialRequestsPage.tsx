import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import { canManageConfig, useAuth } from "../contexts/AuthContext";
import {
  MATERIAL_REQUEST_STATUS_LABELS,
  MaterialRequest,
  MaterialRequestStatus,
  Supplier,
} from "../types";

// ============================================================================
// Material a pedir aos fornecedores — lista simples de matéria-prima/
// encomendas (ex.: vidro, alumínio, parafusos) a acompanhar até chegarem,
// independente das Ordens de Serviço.
// ============================================================================

const EMPTY = { description: "", quantity: "", supplierId: "", notes: "" };

const STATUS_ORDER: MaterialRequestStatus[] = ["A_PEDIR", "PEDIDO", "RECEBIDO"];

const STATUS_COLORS: Record<MaterialRequestStatus, string> = {
  A_PEDIR: "#dc2626",
  PEDIDO: "#f97316",
  RECEBIDO: "#16a34a",
};

function StatusPill({ status }: { status: MaterialRequestStatus }) {
  return (
    <span className="badge" style={{ background: STATUS_COLORS[status] }}>
      {MATERIAL_REQUEST_STATUS_LABELS[status]}
    </span>
  );
}

export function MaterialRequestsPage() {
  const { user } = useAuth();
  const canWrite = canManageConfig(user?.role);

  const [items, setItems] = useState<MaterialRequest[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [showReceived, setShowReceived] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [list, sup] = await Promise.all([
        api.get<MaterialRequest[]>("/material-requests"),
        api.get<Supplier[]>("/suppliers"),
      ]);
      setItems(list);
      setSuppliers(sup);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar o material a pedir.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/material-requests", {
        description: form.description,
        quantity: form.quantity || undefined,
        supplierId: form.supplierId || undefined,
        notes: form.notes || undefined,
      });
      setForm(EMPTY);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao adicionar o pedido de material.");
    }
  }

  async function advanceStatus(item: MaterialRequest) {
    const next = STATUS_ORDER[STATUS_ORDER.indexOf(item.status) + 1];
    if (!next) return;
    await api.put(`/material-requests/${item.id}`, { status: next });
    load();
  }

  async function handleDelete(item: MaterialRequest) {
    await api.delete(`/material-requests/${item.id}`);
    load();
  }

  const pending = items.filter((i) => i.status !== "RECEBIDO");
  const received = items.filter((i) => i.status === "RECEBIDO");

  function renderRow(item: MaterialRequest) {
    const next = STATUS_ORDER[STATUS_ORDER.indexOf(item.status) + 1];
    return (
      <tr key={item.id}>
        <td>{item.description}</td>
        <td>{item.quantity || "—"}</td>
        <td>{item.supplier?.name ?? "—"}</td>
        <td>
          <StatusPill status={item.status} />
        </td>
        <td>{item.notes || "—"}</td>
        <td>{item.requestedBy?.name ?? "—"}</td>
        {canWrite && (
          <td style={{ display: "flex", gap: 6 }}>
            {next && (
              <button className="btn secondary" onClick={() => advanceStatus(item)}>
                Marcar como {MATERIAL_REQUEST_STATUS_LABELS[next].toLowerCase()}
              </button>
            )}
            <button className="btn secondary" onClick={() => handleDelete(item)}>
              Remover
            </button>
          </td>
        )}
      </tr>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h2>Material a Pedir aos Fornecedores</h2>
      </div>
      <p className="muted" style={{ marginBottom: 16 }}>
        Matéria-prima e encomendas (ex.: vidro, alumínio, parafusos) a acompanhar até chegarem — independente das
        Ordens de Serviço.
      </p>

      {canWrite && (
        <div className="card">
          <h4>Novo pedido de material</h4>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div>
                <label>Descrição</label>
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Ex.: Vidro 4mm, alumínio branco, parafusos M4..."
                  required
                />
              </div>
              <div>
                <label>Quantidade</label>
                <input
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  placeholder="Ex.: 10 un, 2 rolos..."
                />
              </div>
              <div>
                <label>Fornecedor</label>
                <select
                  value={form.supplierId}
                  onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
                >
                  <option value="">(por definir)</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>Notas</label>
                <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <button className="btn" type="submit">
              Adicionar
            </button>
          </form>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      <div className="card">
        {loading ? (
          <p className="muted">A carregar...</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Descrição</th>
                <th>Quantidade</th>
                <th>Fornecedor</th>
                <th>Estado</th>
                <th>Notas</th>
                <th>Pedido por</th>
                {canWrite && <th></th>}
              </tr>
            </thead>
            <tbody>
              {pending.map(renderRow)}
              {pending.length === 0 && (
                <tr>
                  <td colSpan={canWrite ? 7 : 6} className="muted">
                    Sem material pendente a pedir aos fornecedores.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {received.length > 0 && (
          <>
            <button
              className="btn secondary"
              style={{ marginTop: 12 }}
              onClick={() => setShowReceived((v) => !v)}
            >
              {showReceived ? "Ocultar recebidos" : `Mostrar recebidos (${received.length})`}
            </button>
            {showReceived && (
              <table style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Descrição</th>
                    <th>Quantidade</th>
                    <th>Fornecedor</th>
                    <th>Estado</th>
                    <th>Notas</th>
                    <th>Pedido por</th>
                    {canWrite && <th></th>}
                  </tr>
                </thead>
                <tbody>{received.map(renderRow)}</tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}
