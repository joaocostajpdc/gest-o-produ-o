import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { canManageConfig, useAuth } from "../contexts/AuthContext";
import { useFeature } from "../contexts/FeaturesContext";
import { FeatureTestBanner } from "../components/FeatureTestBanner";
import { CutPlansPanel } from "../components/CutPlansPanel";
import { CutPlanEditor, EditorInitial, editorInitialFromPlan } from "../components/CutPlanEditor";
import { CutPlanView } from "../components/CutPlanView";
import { CutPlan, CutPlanInput } from "../types";

// ============================================================================
// Otimização de Corte (pedido do utilizador de 2026-10-16: "otimização de
// corte tipo cut list") — chapas (2D) e barras/perfis (1D), com cada plano
// opcionalmente ligado a uma Ordem de Serviço (separador "Cortes" da OS).
//
// Em teste: só administradores (e quem for escolhido para testar) até
// aprovação (ver FeatureTestBanner e FeaturesContext).
// ============================================================================

const FEATURE_KEY = "cutPlans";

function useGate() {
  const feature = useFeature(FEATURE_KEY);
  if (feature.loading) return <div className="muted">A carregar...</div>;
  if (!feature.available) return <Navigate to="/" replace />;
  return null;
}

type SavePayload = {
  name: string;
  material: string | null;
  notes: string | null;
  serviceOrderRef: string | null;
  input: CutPlanInput;
};

export function CutPlansPage() {
  const gate = useGate();
  if (gate) return gate;
  return (
    <div>
      <div className="page-header">
        <h2>Otimização de Corte</h2>
      </div>
      <FeatureTestBanner featureKey={FEATURE_KEY} label="a Otimização de Corte (e o separador Cortes nas OS)" />
      <div className="card">
        <CutPlansPanel />
      </div>
    </div>
  );
}

/** Novo plano: /otimizacao-corte/novo (?os=nº da OS; ou duplicado via state). */
export function CutPlanNewPage() {
  const gate = useGate();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const location = useLocation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const duplicated = (location.state as { duplicate?: EditorInitial } | null)?.duplicate;
  const os = params.get("os");
  const mosquito = params.get("mosquiteiras") === "1";

  if (gate) return gate;
  if (!canManageConfig(user?.role)) return <Navigate to="/otimizacao-corte" replace />;

  async function save(payload: SavePayload) {
    setSaving(true);
    setError(null);
    try {
      const plan = await api.post<CutPlan>("/cut-plans", payload);
      navigate(`/otimizacao-corte/${plan.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao gravar o plano.");
      setSaving(false);
    }
  }

  const initial: EditorInitial | undefined =
    duplicated ?? (os || mosquito ? { serviceOrderRef: os, startMosquito: mosquito } : undefined);

  return (
    <div>
      <div className="page-header">
        <h2>Novo plano de corte</h2>
        <Link to="/otimizacao-corte" className="btn secondary">
          Voltar
        </Link>
      </div>
      {error && <p className="error-text">{error}</p>}
      <CutPlanEditor initial={initial} saving={saving} onSave={save} onCancel={() => navigate(-1)} />
    </div>
  );
}

/** Plano gravado: ver, imprimir, editar, duplicar, apagar. */
export function CutPlanPage() {
  const gate = useGate();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const canWrite = canManageConfig(user?.role);
  const navigate = useNavigate();
  const [plan, setPlan] = useState<CutPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    setPlan(null);
    api
      .get<CutPlan>(`/cut-plans/${id}`)
      .then(setPlan)
      .catch((err) => setError(err instanceof Error ? err.message : "Erro ao carregar o plano."));
  }, [id]);

  if (gate) return gate;
  if (error && !plan) return <p className="error-text">{error}</p>;
  if (!plan) return <div className="muted">A carregar...</div>;

  async function save(payload: SavePayload) {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.put<CutPlan>(`/cut-plans/${plan!.id}`, payload);
      setPlan(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao gravar o plano.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Apagar o plano PC-${plan!.number} "${plan!.name}"?`)) return;
    try {
      await api.delete(`/cut-plans/${plan!.id}`);
      navigate(plan!.serviceOrder ? `/service-orders/${plan!.serviceOrder.id}` : "/otimizacao-corte", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao apagar o plano.");
    }
  }

  if (editing) {
    return (
      <div>
        <div className="page-header">
          <h2>
            Editar PC-{plan.number} — {plan.name}
          </h2>
        </div>
        {error && <p className="error-text">{error}</p>}
        <CutPlanEditor initial={editorInitialFromPlan(plan)} saving={saving} onSave={save} onCancel={() => setEditing(false)} />
      </div>
    );
  }

  const created = new Date(plan.createdAt).toLocaleDateString("pt-PT");
  const settings = plan.input.settings as { kerf: number; trim: number; minRemnant?: number };

  return (
    <div className="cut-plan-page">
      <div className="page-header no-print">
        <h2>
          PC-{plan.number} — {plan.name}
        </h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={() => window.print()}>
            Imprimir
          </button>
          {canWrite && (
            <>
              <button className="btn secondary" onClick={() => setEditing(true)}>
                Editar
              </button>
              <button
                className="btn secondary"
                onClick={() =>
                  navigate("/otimizacao-corte/novo", {
                    state: { duplicate: { ...editorInitialFromPlan(plan), name: `${plan.name} (cópia)` } },
                  })
                }
              >
                Duplicar
              </button>
              <button className="btn danger" onClick={remove}>
                Apagar
              </button>
            </>
          )}
        </div>
      </div>
      {error && <p className="error-text">{error}</p>}

      <div className="card cut-print-head">
        <div className="cut-print-brand">Minho Ferragens · Plano de Corte</div>
        <div className="cut-print-title">
          PC-{plan.number} — {plan.name}
        </div>
        <div className="cut-print-meta">
          <span>{plan.mode === "CHAPAS" ? "Chapas" : "Barras / perfis"}</span>
          {plan.material && <span>Material: {plan.material}</span>}
          {plan.serviceOrder && (
            <span>
              OS:{" "}
              <Link to={`/service-orders/${plan.serviceOrder.id}`}>{plan.serviceOrder.externalId}</Link>
              {plan.serviceOrder.client ? ` — ${plan.serviceOrder.client.name}` : ""}
            </span>
          )}
          <span>
            {plan.mode === "CHAPAS"
              ? `Corte ${settings.kerf} mm · esquadria ${settings.trim} mm`
              : `Lâmina ${settings.kerf} mm · topo ${settings.trim} mm · sobras ≥ ${settings.minRemnant ?? 0} mm`}
          </span>
          <span>
            {created}
            {plan.createdBy ? ` · ${plan.createdBy.name}` : ""}
          </span>
        </div>
        {plan.notes && <p style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{plan.notes}</p>}
      </div>

      <CutPlanView input={plan.input} result={plan.result} />
    </div>
  );
}
