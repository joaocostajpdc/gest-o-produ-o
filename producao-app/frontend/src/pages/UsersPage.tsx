import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import { AuthUser, UserRole } from "../types";

const EMPTY = { name: "", email: "", password: "", role: "OPERARIO" as UserRole };

export function UsersPage() {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [matrix, setMatrix] = useState<Record<UserRole, string[]> | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  async function load() {
    const [u, m] = await Promise.all([
      api.get<AuthUser[]>("/users"),
      api.get<Record<UserRole, string[]>>("/users/permissions-matrix"),
    ]);
    setUsers(u);
    setMatrix(m);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/users", form);
      setForm(EMPTY);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar utilizador.");
    }
  }

  async function toggleActive(user: AuthUser & { active?: boolean }) {
    await api.put(`/users/${user.id}`, { active: !user.active });
    load();
  }

  const allPermissions = matrix ? Array.from(new Set(Object.values(matrix).flat())).sort() : [];
  const activeUsers = users.filter((u) => (u as any).active);
  const inactiveUsers = users.filter((u) => !(u as any).active);

  return (
    <div>
      <div className="page-header">
        <h2>Utilizadores e Permissões</h2>
      </div>

      <div className="card">
        <h4>Novo utilizador</h4>
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div>
              <label>Nome</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label>Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>
            <div>
              <label>Palavra-passe</label>
              <input
                type="password"
                minLength={6}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </div>
            <div>
              <label>Perfil</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}>
                <option value="ADMINISTRADOR">Administrador</option>
                <option value="SUPERVISOR">Supervisor</option>
                <option value="OPERARIO">Operário</option>
              </select>
            </div>
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn" type="submit">
            Criar utilizador
          </button>
        </form>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Email</th>
              <th>Perfil</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {activeUsers.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>{(u as any).active ? "Ativo" : "Inativo"}</td>
                <td>
                  <button className="btn secondary" onClick={() => toggleActive(u as any)}>
                    {(u as any).active ? "Desativar" : "Ativar"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {inactiveUsers.length > 0 && (
          <>
            <button
              className="btn secondary"
              style={{ marginTop: 12 }}
              onClick={() => setShowInactive((v) => !v)}
            >
              {showInactive
                ? "Ocultar utilizadores inativos"
                : `Mostrar utilizadores inativos (${inactiveUsers.length})`}
            </button>
            {showInactive && (
              <table style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Email</th>
                    <th>Perfil</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {inactiveUsers.map((u) => (
                    <tr key={u.id}>
                      <td>{u.name}</td>
                      <td>{u.email}</td>
                      <td>{u.role}</td>
                      <td>Inativo</td>
                      <td>
                        <button className="btn secondary" onClick={() => toggleActive(u as any)}>
                          Ativar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {matrix && (
        <div className="card">
          <h4>Tabela de Permissões por Perfil</h4>
          <table>
            <thead>
              <tr>
                <th>Funcionalidade</th>
                <th>Administrador</th>
                <th>Supervisor</th>
                <th>Operário</th>
              </tr>
            </thead>
            <tbody>
              {allPermissions.map((perm) => (
                <tr key={perm}>
                  <td>{perm}</td>
                  <td>{matrix.ADMINISTRADOR.includes(perm) ? "✓" : "—"}</td>
                  <td>{matrix.SUPERVISOR.includes(perm) ? "✓" : "—"}</td>
                  <td>{matrix.OPERARIO.includes(perm) ? "✓" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
