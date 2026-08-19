import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import { Stage } from "../types";

const EMPTY = { name: "", description: "", requiresSupplier: false };

export function StagesPage() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [form, setForm] = useState<typeof EMPTY & { id?: string }>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setStages(await api.get<Stage[]>("/stages"));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (form.id) await api.put(`/stages/${form.id}`, form);
      else await api.post("/stages", form);
      setForm(EMPTY);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao guardar etapa.");
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Eliminar esta etapa? Isto pode afetar linhas de produção existentes.")) return;
    await api.delete(`/stages/${id}`);
    load();
  }

  return (
    <div>
      <div className="page-header">
        <h2>Etapas de Produção (catálogo)</h2>
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
              <label>
                <input
                  type="checkbox"
                  checked={form.requiresSupplier}
                  onChange={(e) => setForm({ ...form, requiresSupplier: e.target.checked })}
                  style={{ width: "auto", marginRight: 6 }}
                />
                Exige fornecedor externo
              </label>
            </div>
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn" type="submit">
            {form.id ? "Guardar alterações" : "Criar etapa"}
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
              <th>Exige fornecedor</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {stages.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td className="muted">{s.description}</td>
                <td>{s.requiresSupplier ? "Sim" : "Não"}</td>
                <td style={{ display: "flex", gap: 6 }}>
                  <button
                    className="btn secondary"
                    onClick={() =>
                      setForm({ id: s.id, name: s.name, description: s.description ?? "", requiresSupplier: s.requiresSupplier })
                    }
                  >
                    Editar
                  </button>
                  <button className="btn danger" onClick={() => handleDelete(s.id)}>
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
