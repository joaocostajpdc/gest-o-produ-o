import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import { Product, ProductionLineStep, Stage, Supplier } from "../types";

export function ProductionLinesPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [steps, setSteps] = useState<ProductionLineStep[]>([]);
  const [form, setForm] = useState({ stageId: "", order: 10, defaultSupplierId: "" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<Product[]>("/products"),
      api.get<Stage[]>("/stages"),
      api.get<Supplier[]>("/suppliers"),
    ]).then(([p, s, sup]) => {
      setProducts(p);
      setStages(s);
      setSuppliers(sup);
      if (p.length) setSelectedProductId(p[0].id);
    });
  }, []);

  async function loadSteps(productId: string) {
    if (!productId) return;
    setSteps(await api.get<ProductionLineStep[]>(`/production-lines?productId=${productId}`));
  }

  useEffect(() => {
    loadSteps(selectedProductId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProductId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/production-lines", {
        productId: selectedProductId,
        stageId: form.stageId,
        order: Number(form.order),
        defaultSupplierId: form.defaultSupplierId || null,
      });
      setForm({ stageId: "", order: (steps.length + 1) * 10, defaultSupplierId: "" });
      loadSteps(selectedProductId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao adicionar etapa à linha de produção.");
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Remover esta etapa da linha de produção?")) return;
    await api.delete(`/production-lines/${id}`);
    loadSteps(selectedProductId);
  }

  return (
    <div>
      <div className="page-header">
        <h2>Linhas de Produção por Produto</h2>
      </div>

      <div className="card">
        <label>Produto</label>
        <select value={selectedProductId} onChange={(e) => setSelectedProductId(e.target.value)}>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
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
                  Este produto ainda não tem uma linha de produção configurada.
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
