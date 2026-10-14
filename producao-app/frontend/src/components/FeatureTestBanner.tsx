import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../contexts/AuthContext";
import { useFeature, useFeatures } from "../contexts/FeaturesContext";
import { AuthUser } from "../types";

// ============================================================================
// Aviso "Em teste" no topo de uma funcionalidade nova, só para o
// administrador (ver FeaturesContext). Permite:
//  - escolher utilizadores que já a podem testar antes de ser aprovada
//    (pedido do utilizador de 2026-10-14: "lançar o teste do vidro para o
//    utilizador Marco Costa");
//  - aprovar e lançar para todos;
//  - depois de aprovada, voltar a restringir.
// ============================================================================

export function FeatureTestBanner({ featureKey, label }: { featureKey: string; label: string }) {
  const { user } = useAuth();
  const feature = useFeature(featureKey);
  const { setReleased, setTesters } = useFeatures();
  const isAdmin = user?.role === "ADMINISTRADOR";
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState("");

  useEffect(() => {
    if (!isAdmin || feature.released) return;
    api
      .get<(AuthUser & { active?: boolean })[]>("/users")
      .then((list) => setUsers(list.filter((u) => u.role !== "ADMINISTRADOR" && u.active !== false)))
      .catch(() => setUsers([]));
  }, [isAdmin, feature.released]);

  if (!isAdmin) return null;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao alterar o lançamento.");
    } finally {
      setBusy(false);
    }
  }

  if (feature.released) {
    return (
      <p className="muted" style={{ fontSize: 13 }}>
        {label} está disponível para todos.{" "}
        <button
          className="btn secondary"
          style={{ padding: "2px 8px", fontSize: 12 }}
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Voltar a esconder ${label} dos outros utilizadores?`)) {
              run(() => setReleased(featureKey, false));
            }
          }}
        >
          Voltar a restringir
        </button>
      </p>
    );
  }

  const testers = feature.testerUserIds;
  const testerUsers = users.filter((u) => testers.includes(u.id));
  const candidates = users.filter((u) => !testers.includes(u.id));

  return (
    <div className="card" style={{ borderLeft: "4px solid #d97706", background: "#fffbeb" }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <strong>Em teste — só os administradores {testers.length > 0 ? "e os utilizadores abaixo " : ""}veem {label}.</strong>
          <div className="muted">Quando estiver tudo bem, aprova para ficar disponível para todos.</div>
        </div>
        <button
          className="btn"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Aprovar ${label} e tornar visível para todos os utilizadores?`)) {
              run(() => setReleased(featureKey, true));
            }
          }}
        >
          Aprovar e lançar para todos
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>A testar:</span>
        {testerUsers.length === 0 && <span className="muted" style={{ fontSize: 13 }}>ninguém além dos administradores</span>}
        {testerUsers.map((u) => (
          <span
            key={u.id}
            className="badge"
            style={{ background: "#0e7490", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            {u.name}
            <button
              type="button"
              title={`Tirar ${u.name} do teste`}
              disabled={busy}
              onClick={() => run(() => setTesters(featureKey, testers.filter((id) => id !== u.id)))}
              style={{ background: "none", border: 0, color: "#fff", cursor: "pointer", padding: 0, fontSize: 12 }}
            >
              ✕
            </button>
          </span>
        ))}
        {candidates.length > 0 && (
          <select
            value={adding}
            disabled={busy}
            onChange={(e) => {
              const id = e.target.value;
              setAdding("");
              if (id) run(() => setTesters(featureKey, [...testers, id]));
            }}
          >
            <option value="">+ Adicionar utilizador ao teste</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
