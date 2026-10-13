import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { api } from "../api/client";
import { FeatureState } from "../types";
import { useAuth } from "./AuthContext";

// ============================================================================
// Lançamento faseado de funcionalidades novas — pedido do utilizador de
// 2026-10-13: "quero primeiro lançar as atualizações apenas para o
// administrador e só depois de ele aprovar lançar para o resto".
//
// Carrega uma vez, depois do login, o estado de cada funcionalidade nova
// (GET /api/features). "available" diz se este utilizador a pode usar (o
// administrador pode sempre; os outros só depois de aprovada); "released" diz
// se já foi aprovada para todos. O backend aplica a mesma regra em cada rota
// (requireFeature), isto serve só para mostrar/esconder no menu.
// ============================================================================

interface FeaturesContextValue {
  features: FeatureState[];
  loading: boolean;
  setReleased: (key: string, released: boolean) => Promise<void>;
}

const FeaturesContext = createContext<FeaturesContextValue | undefined>(undefined);

export function FeaturesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [features, setFeatures] = useState<FeatureState[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setFeatures([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .get<FeatureState[]>("/features")
      .then(setFeatures)
      .catch(() => setFeatures([]))
      .finally(() => setLoading(false));
  }, [user]);

  const setReleased = useCallback(async (key: string, released: boolean) => {
    const updated = await api.put<FeatureState>(`/features/${key}`, { released });
    setFeatures((prev) => prev.map((f) => (f.key === key ? { ...f, ...updated } : f)));
  }, []);

  return (
    <FeaturesContext.Provider value={{ features, loading, setReleased }}>{children}</FeaturesContext.Provider>
  );
}

export function useFeatures(): FeaturesContextValue {
  const ctx = useContext(FeaturesContext);
  if (!ctx) throw new Error("useFeatures deve ser usado dentro de <FeaturesProvider>.");
  return ctx;
}

export function useFeature(key: string) {
  const { features, loading } = useFeatures();
  const f = features.find((x) => x.key === key);
  return {
    loading,
    available: !!f?.available,
    released: !!f?.released,
    name: f?.name ?? key,
  };
}
