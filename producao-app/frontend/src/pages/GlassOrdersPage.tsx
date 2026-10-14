import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useFeature, useFeatures } from "../contexts/FeaturesContext";
import { GlassOrdersPanel } from "../components/GlassOrdersPanel";

// ============================================================================
// Pedidos de Vidros — página com todos os vidros pedidos aos fornecedores
// (pedido do utilizador de 2026-10-14). Os mesmos registos aparecem no
// separador "Vidros" de cada Ordem de Serviço, onde também se podem lançar.
// Em teste: só administradores, até aprovação (ver FeaturesContext).
// ============================================================================

const FEATURE_KEY = "glassOrders";

export function GlassOrdersPage() {
  const { user } = useAuth();
  const feature = useFeature(FEATURE_KEY);
  const { setReleased } = useFeatures();
  const isAdmin = user?.role === "ADMINISTRADOR";
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRelease(released: boolean) {
    const msg = released
      ? "Aprovar os Pedidos de Vidros e torná-los visíveis para todos os utilizadores?"
      : "Voltar a esconder os Pedidos de Vidros dos outros utilizadores (só administradores)?";
    if (!window.confirm(msg)) return;
    setReleasing(true);
    try {
      await setReleased(FEATURE_KEY, released);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao alterar o lançamento.");
    } finally {
      setReleasing(false);
    }
  }

  if (feature.loading) return <div className="muted">A carregar...</div>;
  if (!feature.available) return <Navigate to="/" replace />;

  return (
    <div>
      <div className="page-header">
        <h2>Pedidos de Vidros</h2>
      </div>

      {isAdmin && !feature.released && (
        <div
          className="card"
          style={{
            borderLeft: "4px solid #d97706",
            background: "#fffbeb",
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <strong>Em teste — só os administradores veem esta aba (e o separador Vidros nas OS).</strong>
            <div className="muted">Quando estiver tudo bem, aprova para ficar disponível para todos.</div>
          </div>
          <button className="btn" disabled={releasing} onClick={() => handleRelease(true)}>
            Aprovar e lançar para todos
          </button>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}

      <GlassOrdersPanel />

      {isAdmin && feature.released && (
        <p className="muted" style={{ fontSize: 13 }}>
          Esta aba está disponível para todos.{" "}
          <button
            className="btn secondary"
            style={{ padding: "2px 8px", fontSize: 12 }}
            disabled={releasing}
            onClick={() => handleRelease(false)}
          >
            Voltar a restringir a administradores
          </button>
        </p>
      )}
    </div>
  );
}
