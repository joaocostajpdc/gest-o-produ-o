import { Navigate } from "react-router-dom";
import { useFeature } from "../contexts/FeaturesContext";

// ============================================================================
// Orçamentos de chapas quinadas e painéis (pedido do utilizador de
// 2026-10-20) — substitui a folha Excel de orçamentação. O programa de
// orçamentos (public/orcamentos-app) é mostrado aqui dentro e usa a sessão
// e a base de dados da Gestão de Produção (API /api/orcamentos).
// Acesso restrito: só João Costa e David Costa (ver featureReleases.ts).
// ============================================================================

export function OrcamentosPage() {
  const feature = useFeature("orcamentos");

  if (feature.loading) return <div className="muted">A carregar...</div>;
  if (!feature.available) return <Navigate to="/" replace />;

  return (
    <iframe
      title="Orçamentos"
      src="/orcamentos-app/index.html"
      style={{
        display: "block",
        width: "100%",
        height: "calc(100dvh - 40px)",
        minHeight: 600,
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        background: "#fff",
      }}
    />
  );
}
