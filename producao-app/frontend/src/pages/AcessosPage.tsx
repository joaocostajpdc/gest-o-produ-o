import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../contexts/AuthContext";
import { useFeatures } from "../contexts/FeaturesContext";
import { AuthUser, FeatureState, UserRole } from "../types";

// ============================================================================
// Acessos (pedido do utilizador de 2026-10-27: "uma atualização onde eu
// consiga gerir melhor na app o que cada um tem acesso"). Uma só tabela com
// cada área/funcionalidade numa linha e cada pessoa numa coluna: um clique dá
// ou tira o acesso a essa pessoa. Também se lança/recolhe para todos e se
// muda o perfil. Só o administrador. Usa as rotas que já existiam
// (/features e /users), por isso não muda nada no servidor.
// ============================================================================

type U = AuthUser & { active?: boolean };

const GROUPS: { title: string; keys: string[] }[] = [
  { title: "Produção", keys: ["osSidePanel", "powderStock", "glassOrders", "cutPlans", "etiquetaPainel"] },
  { title: "Orçamentação e Compras", keys: ["orcamentos", "compras"] },
  { title: "Equipa e Frota", keys: ["horas", "kmViaturas"] },
  { title: "Comunicação", keys: ["chat"] },
  { title: "Financeiro e Gestão", keys: ["financeiro", "financeiroAgenda", "relatorios"] },
  { title: "Aspeto da Central", keys: ["inicio", "abas", "menuHover"] },
];

const ROLE_LABEL: Record<UserRole, string> = {
  ADMINISTRADOR: "Administrador",
  SUPERVISOR: "Supervisor",
  OPERARIO: "Operário",
};

function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() || "?";
}

function estado(f: FeatureState) {
  if (f.restricted) return { label: "Restrito", cls: "restrito", hint: "Só quem escolheres. Nunca abre para todos." };
  if (f.released) return { label: "Todos", cls: "todos", hint: "Disponível para toda a equipa." };
  return { label: "Em teste", cls: "teste", hint: "Só os administradores e quem escolheres." };
}

export function AcessosPage() {
  const { user } = useAuth();
  const { features, setReleased, setTesters } = useFeatures();
  const [users, setUsers] = useState<U[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pessoa, setPessoa] = useState<string>("todas");

  const loadUsers = () => api.get<U[]>("/users").then(setUsers).catch(() => undefined);
  useEffect(() => {
    loadUsers();
  }, []);

  const ativos = useMemo(
    () =>
      users
        .filter((u) => u.active)
        .sort((a, b) => (a.role === "ADMINISTRADOR" ? -1 : 0) - (b.role === "ADMINISTRADOR" ? -1 : 0) || a.name.localeCompare(b.name)),
    [users]
  );
  const colunas = pessoa === "todas" ? ativos : ativos.filter((u) => u.id === pessoa);

  const byKey = new Map(features.map((f) => [f.key, f]));
  const conhecidas = new Set(GROUPS.flatMap((g) => g.keys));
  const outras = features.filter((f) => !conhecidas.has(f.key)).map((f) => f.key);
  const grupos = outras.length ? [...GROUPS, { title: "Outras", keys: outras }] : GROUPS;

  if (user?.role !== "ADMINISTRADOR") return <Navigate to="/" replace />;

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setBusy(null);
    }
  }

  function toggle(f: FeatureState, u: U) {
    const cur = f.testerUserIds ?? [];
    const next = cur.includes(u.id) ? cur.filter((x) => x !== u.id) : [...cur, u.id];
    run(`${f.key}:${u.id}`, () => setTesters(f.key, next));
  }

  function toggleTodos(f: FeatureState) {
    const msg = f.released
      ? `Tirar "${f.name}" a toda a equipa? Fica só para os administradores e para quem estiver escolhido.`
      : `Lançar "${f.name}" para toda a equipa?`;
    if (!window.confirm(msg)) return;
    run(`${f.key}:todos`, () => setReleased(f.key, !f.released));
  }

  function mudarPerfil(u: U, role: UserRole) {
    if (role === u.role) return;
    if (u.id === user?.id) {
      setError("Não podes mudar o teu próprio perfil aqui.");
      return;
    }
    if (!window.confirm(`Mudar ${u.name} para ${ROLE_LABEL[role]}?`)) return;
    run(`perfil:${u.id}`, async () => {
      await api.put(`/users/${u.id}`, { role });
      await loadUsers();
    });
  }

  function temAcesso(f: FeatureState, u: U) {
    if (u.role === "ADMINISTRADOR") return true;
    if (f.released && !f.restricted) return true;
    return (f.testerUserIds ?? []).includes(u.id);
  }

  return (
    <div className="acessos">
      <div className="page-header">
        <h2>Acessos</h2>
      </div>
      <p className="muted acessos-intro">
        Cada linha é uma área da Central e cada coluna uma pessoa. Carrega no quadrado para dar ou tirar o acesso a essa pessoa.
        Os administradores veem sempre tudo.
      </p>

      <div className="acessos-tools">
        <label>
          Ver
          <select value={pessoa} onChange={(e) => setPessoa(e.target.value)}>
            <option value="todas">Todas as pessoas</option>
            {ativos.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <div className="acessos-legenda">
          <span><i className="ac-dot sim" /> tem acesso</span>
          <span><i className="ac-dot todos" /> tem porque está para todos</span>
          <span><i className="ac-dot nao" /> não tem</span>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="card acessos-card">
        <div className="acessos-scroll">
          <table className="acessos-table">
            <thead>
              <tr>
                <th className="ac-feat">Área</th>
                <th className="ac-estado">Para quem</th>
                {colunas.map((u) => (
                  <th key={u.id} className="ac-user">
                    <span className="ac-avatar" aria-hidden="true">{initials(u.name)}</span>
                    <span className="ac-name">{u.name}</span>
                    <select
                      className="ac-role"
                      value={u.role}
                      disabled={busy === `perfil:${u.id}` || u.id === user?.id}
                      onChange={(e) => mudarPerfil(u, e.target.value as UserRole)}
                      aria-label={`Perfil de ${u.name}`}
                    >
                      {(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => {
                const rows = g.keys.map((k) => byKey.get(k)).filter(Boolean) as FeatureState[];
                if (!rows.length) return null;
                return [
                  <tr key={`g-${g.title}`} className="ac-group">
                    <td colSpan={2 + colunas.length}>{g.title}</td>
                  </tr>,
                  ...rows.map((f) => {
                    const st = estado(f);
                    const fixo = f.key === "orcamentos";
                    return (
                      <tr key={f.key}>
                        <td className="ac-feat">{f.name}</td>
                        <td className="ac-estado">
                          <span className={`ac-pill ${st.cls}`} title={st.hint}>{st.label}</span>
                          {!f.restricted && !fixo && (
                            <button
                              type="button"
                              className="ac-link"
                              disabled={busy === `${f.key}:todos`}
                              onClick={() => toggleTodos(f)}
                            >
                              {f.released ? "Recolher" : "Lançar para todos"}
                            </button>
                          )}
                        </td>
                        {colunas.map((u) => {
                          const admin = u.role === "ADMINISTRADOR";
                          const porTodos = !admin && f.released && !f.restricted;
                          const tem = temAcesso(f, u);
                          const fixa = admin || porTodos;
                          const id = `${f.key}:${u.id}`;
                          return (
                            <td key={u.id} className="ac-cell">
                              <button
                                type="button"
                                className={`ac-check${tem ? (fixa ? " todos" : " sim") : ""}`}
                                disabled={fixa || busy === id}
                                aria-pressed={tem}
                                aria-label={`${f.name} — ${u.name}: ${tem ? "tem acesso" : "sem acesso"}`}
                                title={
                                  admin
                                    ? "Administrador: vê sempre tudo"
                                    : porTodos
                                      ? "Está para todos. Para escolher pessoa a pessoa, recolhe primeiro."
                                      : tem
                                        ? `Tirar acesso a ${u.name}`
                                        : `Dar acesso a ${u.name}`
                                }
                                onClick={() => toggle(f, u)}
                              >
                                {tem && (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M5 12.5 10 17 19 7" />
                                  </svg>
                                )}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  }),
                ];
              })}
              <tr className="ac-total">
                <td className="ac-feat">Total de áreas</td>
                <td />
                {colunas.map((u) => (
                  <td key={u.id} className="ac-cell">
                    {features.filter((f) => temAcesso(f, u)).length}/{features.length}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="muted acessos-nota">
        O que cada perfil pode fazer dentro das áreas de produção (ver, alterar, apagar) está em Utilizadores e Permissões.
      </p>
    </div>
  );
}
