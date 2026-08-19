import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import { Supplier } from "../types";

const EMPTY = { name: "", contact: "", email: "", phone: "", notes: "" };

export function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [form, setForm] = useState<typeof EMPTY & { id?: string }>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setSuppliers(await api.get<Supplier[]>("/suppliers"));
  }

  useEffect(() => {
    load();
  }, []);

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
            {suppliers.map((s) => (
              <tr key={s.id}>
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
