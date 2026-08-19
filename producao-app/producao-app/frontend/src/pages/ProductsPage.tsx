import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import { Product } from "../types";

const EMPTY = { name: "", description: "", productionDays: 0, externalId: "" };

export function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState<typeof EMPTY & { id?: string }>(EMPTY);
  const [error, setError] = useState<string | null>(null);

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
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Tempo de produção (dias)</th>
              <th>ID externo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
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
          </tbody>
        </table>
      </div>
    </div>
  );
}
