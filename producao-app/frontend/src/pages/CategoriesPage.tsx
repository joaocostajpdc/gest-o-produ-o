import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import { ProductCategory } from "../types";

const EMPTY = { name: "", description: "", defaultProductionHours: 48 };

export function CategoriesPage() {
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [form, setForm] = useState<typeof EMPTY & { id?: string }>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setCategories(await api.get<ProductCategory[]>("/categories"));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (form.id) {
        await api.put(`/categories/${form.id}`, {
          name: form.name,
          description: form.description,
          defaultProductionHours: Number(form.defaultProductionHours),
        });
      } else {
        await api.post("/categories", {
          name: form.name,
          description: form.description,
          defaultProductionHours: Number(form.defaultProductionHours),
        });
      }
      setForm(EMPTY);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao guardar categoria.");
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Eliminar esta categoria?")) return;
    await api.delete(`/categories/${id}`);
    load();
  }

  return (
    <div>
      <div className="page-header">
        <h2>Categorias de Produtos</h2>
      </div>

      <div className="card">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div>
              <label>Nome</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label>Descrição</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div>
              <label>Prazo de produção padrão (horas)</label>
              <input
                type="number"
                min={0}
                value={form.defaultProductionHours}
                onChange={(e) => setForm({ ...form, defaultProductionHours: Number(e.target.value) })}
                required
              />
            </div>
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn" type="submit">
            {form.id ? "Guardar alterações" : "Criar categoria"}
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
              <th>Descrição</th>
              <th>Prazo padrão</th>
              <th>Produtos</th>
              <th>OS</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="muted">{c.description}</td>
                <td>{c.defaultProductionHours}h</td>
                <td>{c._count?.products ?? 0}</td>
                <td>{c._count?.serviceOrders ?? 0}</td>
                <td style={{ display: "flex", gap: 6 }}>
                  <button
                    className="btn secondary"
                    onClick={() =>
                      setForm({
                        id: c.id,
                        name: c.name,
                        description: c.description ?? "",
                        defaultProductionHours: c.defaultProductionHours,
                      })
                    }
                  >
                    Editar
                  </button>
                  <button className="btn danger" onClick={() => handleDelete(c.id)}>
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
