import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import { ProductCategory, ProductionLineStep, Stage, Supplier } from "../types";

export function ProductionLinesPage() {
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [steps, setSteps] = useState<ProductionLineStep[]>([]);
  const [form, setForm] = useState({ stageId: "", order: 10, defaultSupplierId: "" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<ProductCategory[]>("/categories"),
      api.get<Stage[]>("/stages"),
      api.get<Supplier[]>("/suppliers"),
    ]).then(([c, s, sup]) => {
      setCategories(c);
      setStages(s);
      setSuppliers(sup);
      if (c.length) setSelectedCategoryId(c[0].id);
    });
  }, []);

  async function loadSteps(categoryId: string) {
    if (!categoryId) return;
    setSteps(await api.get<ProductionLineStep[]>(`/production-lines?categoryId=${categoryId}`));
  }

  useEffect(() => {
    loadSteps(selectedCategoryId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategoryId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/production-lines", {
        categoryId: selectedCategoryId,
        stageId: form.stageId,
        order: Number(form.order),
        defaultSupplierId: form.defaultSupplierId || null,
      });
      setForm({ stageId: "", order: (steps.length + 1) * 10, defaultSupplierId: "" });
      loadSteps(selectedCategoryId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao adicionar etapa à linha de produção.");
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Remover esta etapa da linha de produção?")) return;
    await api.delete(`/production-lines/${id}`);
    loadSteps(selectedCategoryId);
  }

  return (
    <div>
      <div className="page-header">
        <h2>Linhas de Produção por Categoria</h2>
      </div>

      <div className="card">
        <label>Categoria</label>
        <select value={selectedCategoryId} onChange={(e) => setSelectedCategoryId(e.target.value)}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="card">
        <h4>Sequência de etapas predefinida</h4>
        <table>
          <thead>
            <tr>
              <th>Ordem</th>
              <th>Etapa</th>
              <th>Fornecedor por defeito</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {steps
              .sort((a, b) => a.order - b.order)
              .map((s) => (
                <tr key={s.id}>
                  <td>{s.order}</td>
                  <td>{s.stage?.name}</td>
                  <td className="muted">{s.defaultSupplier?.name ?? "—"}</td>
                  <td>
                    <button className="btn danger" onClick={() => handleDelete(s.id)}>
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            {steps.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Esta categoria ainda não tem uma linha de produção configurada.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <hr />
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div>
              <label>Etapa</label>
              <select value={form.stageId} onChange={(e) => setForm({ ...form, stageId: e.target.value })} required>
                <option value="">Escolher etapa...</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Ordem</label>
              <input
                type="number"
                min={1}
                value={form.order}
                onChange={(e) => setForm({ ...form, order: Number(e.target.value) })}
                required
              />
            </div>
            <div>
              <label>Fornecedor por defeito (opcional)</label>
              <select
                value={form.defaultSupplierId}
                onChange={(e) => setForm({ ...form, defaultSupplierId: e.target.value })}
              >
                <option value="">Nenhum</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn" type="submit">
            Adicionar à linha de produção
          </button>
        </form>
      </div>
    </div>
  );
}
