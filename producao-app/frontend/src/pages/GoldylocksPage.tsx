import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useFeature } from "../contexts/FeaturesContext";
import { FeatureTestBanner } from "../components/FeatureTestBanner";

// ============================================================================
// Goldylocks dentro do programa (pedido do utilizador de 2026-10-23: "dentro
// de lá ter as abas do Goldylocks, assim trabalhamos só com 1 link").
// Mostra o Goldylocks numa janela dentro da Central. Se o Goldylocks não
// deixar ser mostrado dentro de outro site (bloqueio de segurança dele), fica
// o botão para o abrir num separador novo. Em teste só para o administrador.
// ============================================================================

const FEATURE_KEY = "goldylocks";
const GOLDYLOCKS_URL = "https://app.goldylocks.pt/jpdcmynhoferragens/";

export function GoldylocksPage() {
  const feature = useFeature(FEATURE_KEY);
  const [key, setKey] = useState(0);

  if (feature.loading) return <div className="muted">A carregar...</div>;
  if (!feature.available) return <Navigate to="/" replace />;

  return (
    <div className="gl-page">
      <div className="page-header" style={{ marginBottom: 12 }}>
        <h2>Goldylocks</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn secondary" onClick={() => setKey((k) => k + 1)}>
            Recarregar
          </button>
          <a className="btn" href={GOLDYLOCKS_URL} target="_blank" rel="noopener noreferrer">
            Abrir num separador novo
          </a>
        </div>
      </div>
      <FeatureTestBanner featureKey={FEATURE_KEY} label="o Goldylocks dentro do programa" />
      <p className="muted" style={{ fontSize: 13, margin: "0 0 10px" }}>
        Se o Goldylocks não aparecer em baixo (ou pedir sempre o login), o Goldylocks não deixa ser aberto dentro de
        outro programa — use "Abrir num separador novo".
      </p>
      <iframe
        key={key}
        title="Goldylocks"
        src={GOLDYLOCKS_URL}
        className="gl-frame"
        allow="clipboard-read; clipboard-write; fullscreen"
      />
    </div>
  );
}
