import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { Product, ProductionLineStep, Stage, Supplier } from "../types";

const EMPTY = { name: "", description: "", category: "", productionDays: 0, externalId: "" };
const EMPTY_STEP = { stageId: "", order: 10, defaultSupplierId: "" };

export function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [form, setForm] = useState<typeof EMPTY & { id?: string }>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  // Etapas do produto atualmente expandido (ver/editar etapas diretamente
  // aqui, sem ter de ir à página separada de Linhas de Produção).
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  const [steps, setSteps] = useState<ProductionLineStep[]>([]);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [stepsError, setStepsError] = useState<string | null>(null);
  const [stepForm, setStepForm] = useState(EMPTY_STEP);
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [editStepForm, setEditStepForm] = useState(EMPTY_STEP);

  async function load() {
    const p = await api.get<Product[]>("/products");
    setProducts(p);
  }

  useEffect(() => {
    load();
    api.get<Stage[]>("/stages").then(setStages);
    api.get<Supplier[]>("/suppliers").then(setSuppliers);
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

  async function loadSteps(productId: string) {
    setStepsLoading(true);
    setStepsError(null);
    try {
      setSteps(await api.get<ProductionLineStep[]>(`/production-lines?productId=${productId}`));
    } catch (err) {
      setStepsError(err instanceof Error ? err.message : "Erro ao carregar as etapas do produto.");
    } finally {
      setStepsLoading(false);
    }
  }

  function toggleExpand(productId: string) {
    if (expandedProductId === productId) {
      setExpandedProductId(null);
      setSteps([]);
      setEditingStepId(null);
      return;
    }
    setExpandedProductId(productId);
    setEditingStepId(null);
    setStepForm({ ...EMPTY_STEP });
    loadSteps(productId);
  }

  async function handleAddStep(e: FormEvent) {
    e.preventDefault();
    if (!expandedProductId) return;
    setStepsError(null);
    try {
      await api.post("/production-lines", {
        productId: expandedProductId,
        stageId: stepForm.stageId,
        order: Number(stepForm.order),
        defaultSupplierId: stepForm.defaultSupplierId || null,
      });
      setStepForm({ stageId: "", order: (steps.length + 1) * 10, defaultSupplierId: "" });
      loadSteps(expandedProductId);
    } catch (err) {
      setStepsError(err instanceof Error ? err.message : "Erro ao adicionar etapa.");
    }
  }

  function startEditStep(step: ProductionLineStep) {
    setEditingStepId(step.id);
    setEditStepForm({
      stageId: step.stageId,
      order: step.order,
      defaultSupplierId: step.defaultSupplierId ?? "",
    });
  }

  async function saveEditStep(stepId: string) {
    if (!expandedProductId) return;
    setStepsError(null);
    try {
      await api.put(`/production-lines/${stepId}`, {
        stageId: editStepForm.stageId,
        order: Number(editStepForm.order),
        defaultSupplierId: editStepForm.defaultSupplierId || null,
      });
      setEditingStepId(null);
      loadSteps(expandedProductId);
    } catch (err) {
      setStepsError(err instanceof Error ? err.message : "Erro ao guardar a etapa.");
    }
  }

  async function handleDeleteStep(stepId: string) {
    if (!expandedProductId) return;
    if (!window.confirm("Remover esta etapa da linha de produção?")) return;
    await api.delete(`/production-lines/${stepId}`);
    loadSteps(expandedProductId);
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
              <Fragment key={p.id}>
                <tr>
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
                  <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button className="btn secondary" onClick={() => toggleExpand(p.id)}>
                      {expandedProductId === p.id ? "Ocultar etapas" : "Ver etapas"}
                    </button>
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
                {expandedProductId === p.id && (
                  <tr>
                    <td colSpan={5}>
                      <div className="card" style={{ margin: "8px 0", background: "#f8f9fa" }}>
                        <h4>Etapas de produção — {p.name}</h4>
                        {stepsLoading ? (
                          <p className="muted">A carregar...</p>
                        ) : (
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
                                .slice()
                                .sort((a, b) => a.order - b.order)
                                .map((s) =>
                                  editingStepId === s.id ? (
                                    <tr key={s.id}>
                                      <td>
                                        <input
                                          type="number"
                                          min={1}
                                          value={editStepForm.order}
                                          onChange={(e) =>
                                            setEditStepForm({ ...editStepForm, order: Number(e.target.value) })
                                          }
                                          style={{ width: 70 }}
                                        />
                                      </td>
                                      <td>
                                        <select
                                          value={editStepForm.stageId}
                                          onChange={(e) =>
                                            setEditStepForm({ ...editStepForm, stageId: e.target.value })
                                          }
                                        >
                                          {stages.map((st) => (
                                            <option key={st.id} value={st.id}>
                                              {st.name}
                                            </option>
                                          ))}
                                        </select>
                                      </td>
                                      <td>
                                        <select
                                          value={editStepForm.defaultSupplierId}
                                          onChange={(e) =>
                                            setEditStepForm({ ...editStepForm, defaultSupplierId: e.target.value })
                                          }
                                        >
                                          <option value="">Nenhum</option>
                                          {suppliers.map((sup) => (
                                            <option key={sup.id} value={sup.id}>
                                              {sup.name}
                                            </option>
                                          ))}
                                        </select>
                                      </td>
                                      <td style={{ display: "flex", gap: 6 }}>
                                        <button className="btn" onClick={() => saveEditStep(s.id)}>
                                          Guardar
                                        </button>
                                        <button className="btn secondary" onClick={() => setEditingStepId(null)}>
                                          Cancelar
                                        </button>
                                      </td>
                                    </tr>
                                  ) : (
                                    <tr key={s.id}>
                                      <td>{s.order}</td>
                                      <td>{s.stage?.name}</td>
                                      <td className="muted">{s.defaultSupplier?.name ?? "—"}</td>
                                      <td style={{ display: "flex", gap: 6 }}>
                                        <button className="btn secondary" onClick={() => startEditStep(s)}>
                                          Editar
                                        </button>
                                        <button className="btn danger" onClick={() => handleDeleteStep(s.id)}>
                                          Remover
                                        </button>
                                      </td>
                                    </tr>
                                  )
                                )}
                              {steps.length === 0 && (
                                <tr>
                                  <td colSpan={4} className="muted">
                                    Este produto ainda não tem uma linha de produção configurada.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        )}

                        {stepsError && <p className="error-text">{stepsError}</p>}

                        <hr />
                        <form onSubmit={handleAddStep}>
                          <div className="form-grid">
                            <div>
                              <label>Etapa</label>
                              <select
                                value={stepForm.stageId}
                                onChange={(e) => setStepForm({ ...stepForm, stageId: e.target.value })}
                                required
                              >
                                <option value="">Escolher etapa...</option>
                                {stages.map((st) => (
                                  <option key={st.id} value={st.id}>
                                    {st.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label>Ordem</label>
                              <input
                                type="number"
                                min={1}
                                value={stepForm.order}
                                onChange={(e) => setStepForm({ ...stepForm, order: Number(e.target.value) })}
                                required
                              />
                            </div>
                            <div>
                              <label>Fornecedor por defeito (opcional)</label>
                              <select
                                value={stepForm.defaultSupplierId}
                                onChange={(e) => setStepForm({ ...stepForm, defaultSupplierId: e.target.value })}
                              >
                                <option value="">Nenhum</option>
                                {suppliers.map((sup) => (
                                  <option key={sup.id} value={sup.id}>
                                    {sup.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <button className="btn" type="submit">
                            Adicionar etapa
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
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
