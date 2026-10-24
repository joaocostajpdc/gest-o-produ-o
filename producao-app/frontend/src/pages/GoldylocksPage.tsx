import { Navigate } from "react-router-dom";
import { useFeature } from "../contexts/FeaturesContext";

// O Goldylocks em si é desenhado pelo GoldylocksHost, montado no Layout, para
// os separadores ficarem abertos quando se muda de página (2026-10-24). Esta
// rota só garante o endereço /goldylocks e o acesso.
export function GoldylocksPage() {
  const feature = useFeature("goldylocks");
  if (feature.loading) return <div className="muted">A carregar...</div>;
  if (!feature.available) return <Navigate to="/" replace />;
  return null;
}
