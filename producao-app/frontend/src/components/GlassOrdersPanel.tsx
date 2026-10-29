import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { canManageConfig, useAuth } from "../contexts/AuthContext";
import { GLASS_ORDER_STATUS_LABELS, GlassOrder, GlassOrderStatus, Supplier } from "../types";
import { useFeature } from "../contexts/FeaturesContext";
import { FeatureTestBanner } from "./FeatureTestBanner";
import { exportGlassCsv, printGlassListing } from "./glassListing";

// ============================================================================
// Pedidos de Vidros — tabela + formulário, partilhados pela página "Pedidos
// de Vidros" (todos os vidros) e pelo separador "Vidros" da Ordem de Serviço
// (só os dessa OS, já ligados a ela ao lançar). Pedido do utilizador de
// 2026-10-14, a partir da folha "Pedidos vidros" do Excel: Data / N/Ref. /
// Fornecedor / Medida / Caixa / Quant. / Estado / Nº Encomenda / Previsão de
// entrega / Nota, com as linhas pintadas pelo estado (amarelo = encomendado,
// verde = finalizado).
// ============================================================================

const STATUS_ORDER: GlassOrderStatus[] = ["POR_ENCOMENDAR", "ENCOMENDADO", "FINALIZADO"];

const STATUS_STYLE: Record<GlassOrderStatus, { pill: string; row: string }> = {
  POR_ENCOMENDAR: { pill: "#dc2626", row: "#fef2f2" },
  ENCOMENDADO: { pill: "#d97706", row: "#fff7db" },
  FINALIZADO: { pill: "#16a34a", row: "#ecf7e6" },
};

function todayIso() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDay(iso: string) {
  // As datas vêm como dia (sem hora, guardado em UTC) — mostrar como "14/out".
  const d = new Date(iso);
  return d.toLocaleDateString("pt-PT", { day: "2-digit", month: "short", timeZone: "UTC" }).replace(".", "");
}

const emptyForm = (supplierId = "") => ({
  date: todayIso(),
  nRef: "",
  supplierId,
  medida: "",
  caixa: "",
  quantity: "1",
  status: "POR_ENCOMENDAR" as GlassOrderStatus,
  orderNumber: "",
  expectedDelivery: "",
  notes: "",
});

export function GlassOrdersPanel({
  serviceOrder,
}: {
  /** Quando dado, mostra e lança só os vidros desta Ordem de Serviço. */
  serviceOrder?: { id: string; externalId: string };
}) {
  const { user } = useAuth();
  const canWrite = canManageConfig(user?.role);
  const inOrder = !!serviceOrder;
  // Listagem dos pedidos (2026-10-29) — em teste: "listagemVidros".
  const listagem = useFeature("listagemVidros").available && !inOrder;

  const [items, setItems] = useState<GlassOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showFinished, setShowFinished] = useState(inOrder);
  const [search, setSearch] = useState("");
  // Filtros (pedido do utilizador de 2026-10-28: "põe filtros aqui").
  const [fStatus, setFStatus] = useState<"" | GlassOrderStatus>("");
  const [fSupplier, setFSupplier] = useState("");
  const [fOrder, setFOrder] = useState("");
  const [fPeriod, setFPeriod] = useState("");
  const [busy, setBusy] = useState(false);

  // Fornecedor mais usado nos vidros (ex.: Vitralia) fica pré-escolhido.
  const defaultSupplierId = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((i) => i.supplierId && counts.set(i.supplierId, (counts.get(i.supplierId) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }, [items]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const query = serviceOrder ? `?serviceOrderId=${encodeURIComponent(serviceOrder.id)}` : "";
      const [list, sup] = await Promise.all([
        api.get<GlassOrder[]>(`/glass-orders${query}`),
        api.get<Supplier[]>("/suppliers").catch(() => [] as Supplier[]),
      ]);
      setItems(list);
      setSuppliers([...sup].sort((a, b) => a.name.localeCompare(b.name, "pt")));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar os pedidos de vidros.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceOrder?.id]);

  function openNew() {
    setEditingId(null);
    setForm(emptyForm(defaultSupplierId));
    setShowForm(true);
  }

  function openEdit(o: GlassOrder) {
    setEditingId(o.id);
    setForm({
      date: o.date.slice(0, 10),
      nRef: o.nRef ?? "",
      supplierId: o.supplierId ?? "",
      medida: o.medida,
      caixa: o.caixa,
      quantity: String(o.quantity),
      status: o.status,
      orderNumber: o.orderNumber ?? "",
      expectedDelivery: o.expectedDelivery ?? "",
      notes: o.notes ?? "",
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      date: form.date,
      ...(serviceOrder ? { serviceOrderId: serviceOrder.id } : { nRef: form.nRef || null }),
      supplierId: form.supplierId || null,
      medida: form.medida,
      caixa: form.caixa,
      quantity: Number(form.quantity) || 1,
      status: form.status,
      orderNumber: form.orderNumber || null,
      expectedDelivery: form.expectedDelivery || null,
      notes: form.notes || null,
    };
    try {
      if (editingId) await api.put(`/glass-orders/${editingId}`, payload);
      else await api.post("/glass-orders", payload);
      // Depois de lançar, mantém o formulário aberto com o mesmo fornecedor,
      // data e N/Ref. — normalmente lançam-se vários vidros seguidos.
      setForm((f) => ({ ...emptyForm(f.supplierId), date: f.date, nRef: f.nRef, status: f.status, orderNumber: f.orderNumber }));
      if (editingId) {
        setEditingId(null);
        setShowForm(false);
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao guardar o pedido de vidro.");
    } finally {
      setBusy(false);
    }
  }

  async function advance(o: GlassOrder) {
    const next = STATUS_ORDER[STATUS_ORDER.indexOf(o.status) + 1];
    if (!next) return;
    const body: Record<string, unknown> = { status: next };
    // Ao marcar como encomendado, pede o Nº da encomenda ao fornecedor.
    if (next === "ENCOMENDADO" && !o.orderNumber) {
      const n = window.prompt("Nº da encomenda ao fornecedor (opcional):", "");
      if (n === null) return;
      if (n.trim()) body.orderNumber = n.trim();
    }
    try {
      await api.put(`/glass-orders/${o.id}`, body);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao alterar o estado.");
    }
  }

  async function remove(o: GlassOrder) {
    if (!window.confirm(`Remover o vidro ${o.medida} (${o.caixa})?`)) return;
    try {
      await api.delete(`/glass-orders/${o.id}`);
      if (editingId === o.id) {
        setEditingId(null);
        setShowForm(false);
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao remover.");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const since = fPeriod ? Date.now() - Number(fPeriod) * 86400000 : 0;
    return items.filter((o) => {
      if (fStatus) {
        if (o.status !== fStatus) return false;
      } else if (!showFinished && o.status === "FINALIZADO") return false;
      if (fSupplier && (o.supplier?.id ?? "__sem") !== fSupplier) return false;
      if (fOrder && (o.orderNumber ?? "__sem") !== fOrder) return false;
      if (since && new Date(o.date).getTime() < since) return false;
      if (!q) return true;
      return [o.nRef ?? "", o.medida, o.caixa, o.orderNumber ?? "", o.supplier?.name ?? "", o.notes ?? ""].some((v) =>
        v.toLowerCase().includes(q)
      );
    });
  }, [items, search, showFinished, fStatus, fSupplier, fOrder, fPeriod]);

  // Opções só com o que existe nos pedidos (não aparecem escolhas vazias).
  const supplierOpts = useMemo(() => {
    const m = new Map<string, string>();
    items.forEach((o) => m.set(o.supplier?.id ?? "__sem", o.supplier?.name ?? "Sem fornecedor"));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-PT"));
  }, [items]);
  const orderOpts = useMemo(() => {
    const set = new Set<string>();
    items.forEach((o) => {
      if (fStatus ? o.status === fStatus : showFinished || o.status !== "FINALIZADO") set.add(o.orderNumber ?? "__sem");
    });
    return [...set].sort((a, b) => (a === "__sem" ? 1 : b === "__sem" ? -1 : b.localeCompare(a, "pt-PT", { numeric: true })));
  }, [items, fStatus, showFinished]);
  const hasFilters = !!(fStatus || fSupplier || fOrder || fPeriod || search.trim());
  function clearFilters() {
    setFStatus("");
    setFSupplier("");
    setFOrder("");
    setFPeriod("");
    setSearch("");
  }

  function filtersSummary() {
    const parts: string[] = [];
    if (fStatus) parts.push(`Estado: ${GLASS_ORDER_STATUS_LABELS[fStatus]}`);
    else if (!showFinished) parts.push("Sem os finalizados");
    if (fSupplier) parts.push(`Fornecedor: ${supplierOpts.find(([id]) => id === fSupplier)?.[1] ?? fSupplier}`);
    if (fOrder) parts.push(`Nº encomenda: ${fOrder === "__sem" ? "sem nº" : fOrder}`);
    if (fPeriod) parts.push(`Últimos ${fPeriod} dias`);
    if (search.trim()) parts.push(`Pesquisa: "${search.trim()}"`);
    return parts.length ? parts.join(" · ") : "Todos os pedidos";
  }

  const finishedCount = items.filter((o) => o.status === "FINALIZADO").length;
  const pendingCount = items.length - finishedCount;
  const colCount = (inOrder ? 9 : 10) + (canWrite ? 1 : 0);

  // Composições de caixa já usadas, como sugestões (ex.: "Fosco 4 + Cx. 18 + Fosco 4").
  const caixaOptions = useMemo(() => [...new Set(items.map((i) => i.caixa))].slice(0, 50), [items]);

  return (
    <div>
      {canWrite && (
        <div className={inOrder ? "" : "card"} style={inOrder ? { marginBottom: 16 } : undefined}>
          {!showForm ? (
            <button className="btn" onClick={openNew}>
              {inOrder ? "Pedir vidro para esta OS" : "Novo pedido de vidro"}
            </button>
          ) : (
            <form onSubmit={handleSubmit}>
              <h4>{editingId ? "Editar vidro" : inOrder ? `Pedir vidro — OS ${serviceOrder!.externalId}` : "Novo pedido de vidro"}</h4>
              <div className="form-grid">
                <div>
                  <label>Data</label>
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
                </div>
                {!inOrder && (
                  <div>
                    <label>N/Ref. (Ordem de Serviço)</label>
                    <input
                      type="text"
                      value={form.nRef}
                      onChange={(e) => setForm({ ...form, nRef: e.target.value })}
                      placeholder="Ex.: 2026/448"
                    />
                  </div>
                )}
                <div>
                  <label>Fornecedor</label>
                  <select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
                    <option value="">(por definir)</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Medida</label>
                  <input
                    type="text"
                    value={form.medida}
                    onChange={(e) => setForm({ ...form, medida: e.target.value })}
                    placeholder="Ex.: 1160x220"
                    required
                  />
                </div>
                <div>
                  <label>Caixa (composição)</label>
                  <input
                    type="text"
                    list="glass-caixa-options"
                    value={form.caixa}
                    onChange={(e) => setForm({ ...form, caixa: e.target.value })}
                    placeholder="Ex.: Fosco 4 + Cx. 18 + Fosco 4"
                    required
                  />
                  <datalist id="glass-caixa-options">
                    {caixaOptions.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label>Quant.</label>
                  <input
                    type="number"
                    min={1}
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label>Estado</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as GlassOrderStatus })}
                  >
                    {STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>
                        {GLASS_ORDER_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Nº Encomenda</label>
                  <input
                    type="text"
                    value={form.orderNumber}
                    onChange={(e) => setForm({ ...form, orderNumber: e.target.value })}
                    placeholder="Ex.: 2026/275"
                  />
                </div>
                <div>
                  <label>Previsão de entrega</label>
                  <input
                    type="text"
                    value={form.expectedDelivery}
                    onChange={(e) => setForm({ ...form, expectedDelivery: e.target.value })}
                    placeholder="Ex.: 20/out, Pronto, Em stock"
                  />
                </div>
                <div>
                  <label>Nota</label>
                  <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" type="submit" disabled={busy}>
                  {editingId ? "Guardar" : "Adicionar"}
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setEditingId(null);
                  }}
                >
                  Fechar
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      <div className={inOrder ? "" : "card"}>
        {!inOrder && (
          <div className="filters-bar">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Procurar N/Ref., medida, caixa, nº encomenda..."
            />
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value as "" | GlassOrderStatus)} aria-label="Estado">
              <option value="">Estado (todos)</option>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {GLASS_ORDER_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <select value={fSupplier} onChange={(e) => setFSupplier(e.target.value)} aria-label="Fornecedor">
              <option value="">Fornecedor (todos)</option>
              {supplierOpts.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <select value={fOrder} onChange={(e) => setFOrder(e.target.value)} aria-label="Nº encomenda">
              <option value="">Nº encomenda (todas)</option>
              {orderOpts.map((n) => (
                <option key={n} value={n}>
                  {n === "__sem" ? "Sem nº (ainda por encomendar)" : n}
                </option>
              ))}
            </select>
            <select value={fPeriod} onChange={(e) => setFPeriod(e.target.value)} aria-label="Data do pedido">
              <option value="">Data (todas)</option>
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 3 meses</option>
            </select>
            {hasFilters && (
              <button type="button" className="link-button" onClick={clearFilters} style={{ alignSelf: "center" }}>
                Limpar filtros
              </button>
            )}
            <span className="muted" style={{ alignSelf: "center" }}>
              {hasFilters ? `${filtered.length} de ${items.length} · ` : ""}
              {pendingCount} por receber
            </span>
            {listagem && (
              <>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={filtered.length === 0}
                  onClick={() => printGlassListing(filtered, filtersSummary())}
                  title="Imprimir ou guardar em PDF o que está na tabela"
                >
                  Listagem (imprimir/PDF)
                </button>
                <button type="button" className="btn secondary" disabled={filtered.length === 0} onClick={() => exportGlassCsv(filtered)}>
                  Exportar CSV
                </button>
              </>
            )}
          </div>
        )}
        {listagem && <FeatureTestBanner featureKey="listagemVidros" label="a listagem dos Pedidos de Vidros" />}
        {loading ? (
          <p className="muted">A carregar...</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  {!inOrder && <th>N/Ref.</th>}
                  <th>Fornecedor</th>
                  <th>Medida</th>
                  <th>Caixa</th>
                  <th style={{ textAlign: "center" }}>Quant.</th>
                  <th>Estado</th>
                  <th>Nº Encomenda</th>
                  <th>Previsão de entrega</th>
                  <th>Nota</th>
                  {canWrite && <th></th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => {
                  const next = STATUS_ORDER[STATUS_ORDER.indexOf(o.status) + 1];
                  return (
                    <tr key={o.id} style={{ background: STATUS_STYLE[o.status].row }}>
                      <td style={{ whiteSpace: "nowrap" }}>{formatDay(o.date)}</td>
                      {!inOrder && (
                        <td style={{ whiteSpace: "nowrap" }}>
                          {o.serviceOrder ? (
                            <Link to={`/service-orders/${o.serviceOrder.id}`}>{o.serviceOrder.externalId}</Link>
                          ) : (
                            o.nRef || "—"
                          )}
                        </td>
                      )}
                      <td>{o.supplier?.name ?? "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{o.medida}</td>
                      <td>{o.caixa}</td>
                      <td style={{ textAlign: "center" }}>{o.quantity}</td>
                      <td>
                        <span className="badge" style={{ background: STATUS_STYLE[o.status].pill }}>
                          {GLASS_ORDER_STATUS_LABELS[o.status]}
                        </span>
                      </td>
                      <td>{o.orderNumber || "—"}</td>
                      <td>{o.expectedDelivery || "—"}</td>
                      <td>{o.notes || ""}</td>
                      {canWrite && (
                        <td>
                          <div style={{ display: "flex", gap: 6 }}>
                            {next && (
                              <button
                                className="btn secondary"
                                style={{ whiteSpace: "nowrap" }}
                                onClick={() => advance(o)}
                              >
                                → {GLASS_ORDER_STATUS_LABELS[next]}
                              </button>
                            )}
                            <button className="btn secondary" onClick={() => openEdit(o)}>
                              Editar
                            </button>
                            <button className="btn secondary" style={{ color: "#dc2626" }} onClick={() => remove(o)}>
                              ✕
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={colCount} className="muted">
                      {inOrder ? "Sem vidros pedidos para esta Ordem de Serviço." : "Sem vidros por receber."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {!inOrder && finishedCount > 0 && (
          <button className="btn secondary" style={{ marginTop: 12 }} onClick={() => setShowFinished((v) => !v)}>
            {showFinished ? "Ocultar finalizados" : `Mostrar finalizados (${finishedCount})`}
          </button>
        )}
      </div>
    </div>
  );
}
