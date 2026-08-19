import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { Product } from "../types";

const EMPTY = { name: "", description: "", category: "", productionDays: 0, externalId: "" };

export function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState<typeof EMPTY & { id?: string }>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  async function load() {
    const p = await api.get<Product[]>("/products");
    setProducts(p);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const payload = {
        name: form.name,
        description: form.description,
        category: form.category || undefined,
        productionDays: Number(form.productionDays),
        externalId: form.externalId || undefined,
      };
      if (form.id) await api.put(`/products/${form.id}`, payload);
      else await api.post("/products", payload);
      setForm(EMPTY);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao guardar produto.");
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Eliminar este produto?")) return;
    await api.delete(`/products/${id}`);
    load();
  }

  // Categorias já usadas nos produtos existentes — para o filtro e para
  // sugerir opções no campo do formulário (datalist), em vez de obrigar a
  // escrever sempre o nome da categoria do zero.
  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-PT"));
  }, [products]);

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((p) => {
      if (categoryFilter && p.category !== categoryFilter) return false;
      if (!term) return true;
      return (
        p.name.toLowerCase().includes(term) ||
        (p.externalId ?? "").toLowerCase().includes(term) ||
        (p.category ?? "").toLowerCase().includes(term)
      );
    });
  }, [products, search, categoryFilter]);

  return (
    <div>
      <div className="page-header">
        <h2>Produtos</h2>
      </div>

      <div className="card">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div>
              <label>Nome</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label>Categoria</label>
              <input
                list="product-categories"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="ex.: Mosquiteiras"
              />
              <datalist id="product-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div>
              <label>Tempo de produção (dias)</label>
              <input
                type="number"
                min={0}
                value={form.productionDays}
                onChange={(e) => setForm({ ...form, productionDays: Number(e.target.value) })}
                required
              />
            </div>
            <div>
              <label>ID externo (Goldylocks)</label>
              <input value={form.externalId} onChange={(e) => setForm({ ...form, externalId: e.target.value })} />
            </div>
            <div>
              <label>Descrição</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn" type="submit">
            {form.id ? "Guardar alterações" : "Criar produto"}
          </button>
          {form.id && (
            <button
              className="btn secondary"
              type="button"
              style={{ marginLeft: 8 }}
              onClick={() => setForm(EMPTY)}
            >
              Cancelar
            </button>
          )}
        </form>
      </div>

      <div className="card">
        <div className="filters-bar">
          <input
            type="text"
            placeholder="Pesquisar por nome, ID externo ou categoria..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 260 }}
          />
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">Categoria (todas)</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Categoria</th>
              <th>Tempo de produção (dias)</th>
              <th>ID externo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>
                  {p.category ? (
                    <span className="badge badge-neutral">{p.category}</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>{p.productionDays}</td>
                <td className="muted">{p.externalId ?? "—"}</td>
                <td style={{ display: "flex", gap: 6 }}>
                  <button
                    className="btn secondary"
                    onClick={() =>
                      setForm({
                        id: p.id,
                        name: p.name,
                        description: p.description ?? "",
                        category: p.category ?? "",
                        productionDays: p.productionDays,
                        externalId: p.externalId ?? "",
                      })
                    }
                  >
                    Editar
                  </button>
                  <button className="btn danger" onClick={() => handleDelete(p.id)}>
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
            {filteredProducts.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Sem produtos para os filtros aplicados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
