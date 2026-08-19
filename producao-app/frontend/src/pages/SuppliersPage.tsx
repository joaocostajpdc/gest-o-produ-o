import { Fragment, FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { Product, Supplier } from "../types";

const EMPTY = { name: "", contact: "", email: "", phone: "", notes: "" };

export function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState<typeof EMPTY & { id?: string }>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [expandedSupplierId, setExpandedSupplierId] = useState<string | null>(null);

  async function load() {
    setSuppliers(await api.get<Supplier[]>("/suppliers"));
  }

  useEffect(() => {
    load();
    api.get<Product[]>("/products").then(setProducts).catch(() => {});
  }, []);

  // Categorias de produto existentes, para sugerir no campo de categoria dos
  // prazos de entrega por fornecedor (ex.: "Mosquiteiras", "Painéis").
  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-PT"));
  }, [products]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (form.id) await api.put(`/suppliers/${form.id}`, form);
      else await api.post("/suppliers", form);
      setForm(EMPTY);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao guardar fornecedor.");
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Eliminar este fornecedor?")) return;
    await api.delete(`/suppliers/${id}`);
    load();
  }

  return (
    <div>
      <div className="page-header">
        <h2>Fornecedores</h2>
      </div>

      <div className="card">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div>
              <label>Nome</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label>Contacto</label>
              <input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
            </div>
            <div>
              <label>Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label>Telefone</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn" type="submit">
            {form.id ? "Guardar alterações" : "Criar fornecedor"}
          </button>
          {form.id && (
            <button className="btn secondary" type="button" style={{ marginLeft: 8 }} onClick={() => setForm(EMPTY)}>
              Cancelar
            </button>
          )}
        </form>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Contacto</th>
              <th>Email</th>
              <th>Telefone</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => {
              const isExpanded = expandedSupplierId === s.id;
              return (
                <Fragment key={s.id}>
                  <tr>
                    <td>{s.name}</td>
                    <td className="muted">{s.contact}</td>
                    <td className="muted">{s.email}</td>
                    <td className="muted">{s.phone}</td>
                    <td style={{ display: "flex", gap: 6 }}>
                      <button
                        className="btn secondary"
                        onClick={() =>
                          setForm({
                            id: s.id,
                            name: s.name,
                            contact: s.contact ?? "",
                            email: s.email ?? "",
                            phone: s.phone ?? "",
                            notes: s.notes ?? "",
                          })
                        }
                      >
                        Editar
                      </button>
                      <button
                        className="btn secondary"
                        onClick={() => setExpandedSupplierId(isExpanded ? null : s.id)}
                      >
                        {isExpanded ? "Fechar prazos" : "Prazos de entrega"}
                      </button>
                      <button className="btn danger" onClick={() => handleDelete(s.id)}>
                        Eliminar
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={5} style={{ background: "#fafbfd" }}>
                        <LeadTimesPanel supplier={s} categories={categories} onChanged={load} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LeadTimesPanel({
  supplier,
  categories,
  onChanged,
}: {
  supplier: Supplier;
  categories: string[];
  onChanged: () => void;
}) {
  const [category, setCategory] = useState("");
  const [leadDays, setLeadDays] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDays, setEditingDays] = useState(0);

  const leadTimes = supplier.leadTimes ?? [];

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!category.trim()) return;
    setError(null);
    try {
      await api.post(`/suppliers/${supplier.id}/lead-times`, {
        category: category.trim(),
        leadDays: Number(leadDays),
      });
      setCategory("");
      setLeadDays(0);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao guardar prazo de entrega.");
    }
  }

  async function handleSaveEdit(leadTimeId: string) {
    setError(null);
    try {
      await api.put(`/suppliers/${supplier.id}/lead-times/${leadTimeId}`, { leadDays: Number(editingDays) });
      setEditingId(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar prazo de entrega.");
    }
  }

  async function handleDelete(leadTimeId: string) {
    if (!window.confirm("Eliminar este prazo de entrega?")) return;
    await api.delete(`/suppliers/${supplier.id}/lead-times/${leadTimeId}`);
    onChanged();
  }

  return (
    <div className="lead-times-panel">
      <h4 style={{ marginTop: 0 }}>Prazos de entrega por categoria — {supplier.name}</h4>
      <p className="muted" style={{ marginTop: -6, marginBottom: 10 }}>
        Usado para calcular a data de entrega prevista quando uma Ordem de Serviço está na etapa "Lacagem" com
        este fornecedor (ex.: {supplier.name} · Mosquiteiras → 10 dias).
      </p>
      <table>
        <thead>
          <tr>
            <th>Categoria</th>
            <th>Prazo (dias)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {leadTimes.map((lt) => (
            <tr key={lt.id}>
              <td>{lt.category}</td>
              <td>
                {editingId === lt.id ? (
                  <input
                    type="number"
                    min={0}
                    style={{ width: 80 }}
                    value={editingDays}
                    onChange={(e) => setEditingDays(Number(e.target.value))}
                  />
                ) : (
                  `${lt.leadDays} dias`
                )}
              </td>
              <td style={{ display: "flex", gap: 6 }}>
                {editingId === lt.id ? (
                  <>
                    <button className="btn secondary" onClick={() => handleSaveEdit(lt.id)}>
                      Guardar
                    </button>
                    <button className="btn secondary" onClick={() => setEditingId(null)}>
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="btn secondary"
                      onClick={() => {
                        setEditingId(lt.id);
                        setEditingDays(lt.leadDays);
                      }}
                    >
                      Editar
                    </button>
                    <button className="btn danger" onClick={() => handleDelete(lt.id)}>
                      Eliminar
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {leadTimes.length === 0 && (
            <tr>
              <td colSpan={3} className="muted">
                Sem prazos definidos para este fornecedor.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <form onSubmit={handleAdd} className="form-grid" style={{ marginBottom: 0 }}>
        <div>
          <label>Categoria</label>
          <input
            list={`lead-time-categories-${supplier.id}`}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="ex.: Mosquiteiras"
          />
          <datalist id={`lead-time-categories-${supplier.id}`}>
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div>
          <label>Prazo de entrega (dias)</label>
          <input type="number" min={0} value={leadDays} onChange={(e) => setLeadDays(Number(e.target.value))} />
        </div>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button className="btn" type="submit" disabled={!category.trim()}>
            Adicionar / atualizar
          </button>
        </div>
      </form>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
