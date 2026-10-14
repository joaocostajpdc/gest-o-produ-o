import { Navigate } from "react-router-dom";
import { useFeature } from "../contexts/FeaturesContext";
import { GlassOrdersPanel } from "../components/GlassOrdersPanel";
import { FeatureTestBanner } from "../components/FeatureTestBanner";

// ============================================================================
// Pedidos de Vidros — página com todos os vidros pedidos aos fornecedores
// (pedido do utilizador de 2026-10-14). Os mesmos registos aparecem no
// separador "Vidros" de cada Ordem de Serviço, onde também se podem lançar.
// Em teste: só administradores e os utilizadores escolhidos para testar, até
// aprovação (ver FeatureTestBanner e FeaturesContext).
// ============================================================================

const FEATURE_KEY = "glassOrders";

export function GlassOrdersPage() {
  const feature = useFeature(FEATURE_KEY);

  if (feature.loading) return <div className="muted">A carregar...</div>;
  if (!feature.available) return <Navigate to="/" replace />;

  return (
    <div>
      <div className="page-header">
        <h2>Pedidos de Vidros</h2>
      </div>
      <FeatureTestBanner featureKey={FEATURE_KEY} label="os Pedidos de Vidros (e o separador Vidros nas OS)" />
      <GlassOrdersPanel />
    </div>
  );
}
