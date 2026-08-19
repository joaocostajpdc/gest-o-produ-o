import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import {
  HistoryEvent,
  INTERRUPTION_REASON_LABELS,
  InterruptionReason,
  ServiceOrderDetail,
  Stage,
} from "../types";
import { minutesToHuman, PriorityBadge, StatusBadge } from "../components/Badges";
import { canChangeFlow, useAuth } from "../contexts/AuthContext";

type Tab = "etapas" | "tempos" | "interrupcoes" | "observacoes" | "historico";

export function ServiceOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [order, setOrder] = useState<ServiceOrderDetail | null>(null);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [tab, setTab] = useState<Tab>("etapas");
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const [o, h] = await Promise.all([
        api.get<ServiceOrderDetail>(`/service-orders/${id}`),
        api.get<HistoryEvent[]>(`/service-orders/${id}/history`),
      ]);
      setOrder(o);
      setHistory(h);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    api.get<Stage[]>("/stages").then(setStages).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function runAction(action: () => Promise<unknown>): Promise<void> {
    setActionError(null);
    setBusy(true);
    try {
      await action();
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Ocorreu um erro.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !order) return <p className="muted">A carregar...</p>;

  const canFlow = canChangeFlow(user?.role);

  return (
    <div>
      <p>
        <Link to="/">&larr; Voltar às Ordens de Serviço</Link>
      </p>

      <div className="page-header">
        <div>
          <h2>
            {order.externalId} <StatusBadge status={order.status} />{" "}
            <PriorityBadge priority={order.priority} label={order.priorityLabel} color={order.priorityColor} />
          </h2>
          <p className="muted">
            {order.client.name} · {order.product.name}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {order.status === "NAO_INICIADA" && (
            <button className="btn" disabled={busy} onClick={() => runAction(() => api.post(`/service-orders/${id}/start`))}>
              Iniciar produção
            </button>
          )}
          {order.status === "EM_PRODUCAO" && (
            <button
              className="btn"
              disabled={busy}
              onClick={() => runAction(() => api.post(`/service-orders/${id}/stage-flow/advance`))}
            >
              Avançar etapa
            </button>
          )}
          {(order.status === "NAO_INICIADA" || order.status === "EM_PRODUCAO" || order.status === "SUSPENSA") && (
            <button
              className="btn danger"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt("Motivo do cancelamento:");
                if (reason) runAction(() => api.post(`/service-orders/${id}/cancel`, { reason }));
              }}
            >
              Cancelar OS
            </button>
          )}
        </div>
      </div>

      {actionError && <p className="error-text">{actionError}</p>}

      {order.specifications && (
        <div className="card spec-card">
          <div className="spec-card-label">Características do Produto</div>
          <div className="spec-card-body">
            {order.specifications.split("\n").map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="form-grid">
          <div>
            <div className="muted">Data de entrada</div>
            <div>{new Date(order.createdAt).toLocaleString("pt-PT")}</div>
          </div>
          <div>
            <div className="muted">Início da produção</div>
            <div>{order.startedAt ? new Date(order.startedAt).toLocaleString("pt-PT") : "—"}</div>
          </div>
          <div>
            <div className="muted">Data-limite</div>
            <div>{order.deadlineAt ? new Date(order.deadlineAt).toLocaleString("pt-PT") : "—"}</div>
          </div>
          <div>
            <div className="muted">Conclusão</div>
            <div>{order.completedAt ? new Date(order.completedAt).toLocaleString("pt-PT") : "—"}</div>
          </div>
          <div>
            <div className="muted">Tempo de produção (total)</div>
            <div>{minutesToHuman(order.productionMinutes)}</div>
          </div>
        </div>
      </div>

      <div className="tabs">
        {(["etapas", "tempos", "interrupcoes", "observacoes", "historico"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {tabLabel(t)}
          </button>
        ))}
      </div>

      {tab === "etapas" && (
        <EtapasTab
          order={order}
          stages={stages}
          canFlow={canFlow}
          busy={busy}
          onAction={runAction}
          id={id!}
        />
      )}

      {tab === "tempos" && <TemposTab order={order} />}

      {tab === "interrupcoes" && <InterrupcoesTab order={order} busy={busy} onAction={runAction} id={id!} />}

      {tab === "observacoes" && <ObservacoesTab order={order} busy={busy} onAction={runAction} id={id!} />}

      {tab === "historico" && <HistoricoTab history={history} />}
    </div>
  );
}

function tabLabel(t: Tab) {
  return {
    etapas: "Etapas",
    tempos: "Tempos",
    interrupcoes: "Interrupções",
    observacoes: "Observações",
    historico: "Histórico",
  }[t];
}

function EtapasTab({
  order,
  stages,
  canFlow,
  busy,
  onAction,
  id,
}: {
  order: ServiceOrderDetail;
  stages: Stage[];
  canFlow: boolean;
  busy: boolean;
  onAction: (fn: () => Promise<unknown>) => Promise<void>;
  id: string;
}) {
  const [insertStageId, setInsertStageId] = useState("");
  const [returnStageId, setReturnStageId] = useState("");
  const [revertStageId, setRevertStageId] = useState("");

  const visited = order.stageInstances.filter((si) => si.status === "CONCLUIDA" || si.status === "ATIVA");

  return (
    <div className="card">
      <div className="stage-timeline">
        {order.stageInstances.map((si) => (
          <div key={si.id} className={`stage-pill ${si.status.toLowerCase()}`}>
            <strong>{si.stage.name}</strong>
            {si.wasManuallyAdded && <div className="muted">(alteração pontual)</div>}
            {si.supplier && <div className="muted">Fornecedor: {si.supplier.name}</div>}
            <div className="muted">{minutesToHuman(si.residenceMinutes)} de permanência</div>
            {si.status === "PENDENTE" && canFlow && (
              <button
                className="btn secondary"
                style={{ marginTop: 6, fontSize: 11, padding: "4px 8px" }}
                disabled={busy}
                onClick={() => onAction(() => api.post(`/service-orders/${id}/stage-flow/skip`, { stageInstanceId: si.id }))}
              >
                Omitir
              </button>
            )}
          </div>
        ))}
      </div>

      {canFlow && (
        <>
          <hr />
          <h4>Alterações pontuais ao fluxo</h4>
          <div className="form-grid">
            <div>
              <label>Inserir etapa adicional</label>
              <select value={insertStageId} onChange={(e) => setInsertStageId(e.target.value)}>
                <option value="">Escolher etapa...</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                className="btn secondary"
                style={{ marginTop: 6 }}
                disabled={!insertStageId || busy}
                onClick={() =>
                  onAction(() => api.post(`/service-orders/${id}/stage-flow/insert`, { stageId: insertStageId }))
                }
              >
                Inserir
              </button>
            </div>

            <div>
              <label>Regressar a etapa anterior</label>
              <select value={returnStageId} onChange={(e) => setReturnStageId(e.target.value)}>
                <option value="">Escolher etapa já visitada...</option>
                {visited.map((si) => (
                  <option key={si.id} value={si.stageId}>
                    {si.stage.name}
                  </option>
                ))}
              </select>
              <button
                className="btn secondary"
                style={{ marginTop: 6 }}
                disabled={!returnStageId || busy}
                onClick={() =>
                  onAction(() => api.post(`/service-orders/${id}/stage-flow/return`, { stageId: returnStageId }))
                }
              >
                Regressar
              </button>
            </div>

            <div>
              <label>Voltar à Linha de Produção</label>
              <select value={revertStageId} onChange={(e) => setRevertStageId(e.target.value)}>
                <option value="">Retomar a partir de...</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                className="btn secondary"
                style={{ marginTop: 6 }}
                disabled={!revertStageId || busy}
                onClick={() =>
                  onAction(() =>
                    api.post(`/service-orders/${id}/stage-flow/revert-to-default`, { stageId: revertStageId })
                  )
                }
              >
                Retomar fluxo predefinido
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TemposTab({ order }: { order: ServiceOrderDetail }) {
  return (
    <div className="card">
      <table>
        <thead>
          <tr>
            <th>Etapa</th>
            <th>Entrada</th>
            <th>Saída</th>
            <th>Tempo de permanência</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {order.stageInstances.map((si) => (
            <tr key={si.id}>
              <td>{si.stage.name}</td>
              <td>{si.enteredAt ? new Date(si.enteredAt).toLocaleString("pt-PT") : "—"}</td>
              <td>{si.exitedAt ? new Date(si.exitedAt).toLocaleString("pt-PT") : "—"}</td>
              <td>{minutesToHuman(si.residenceMinutes)}</td>
              <td>{si.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ marginTop: 12 }}>
        Tempo de produção total (exclui suspensões): <strong>{minutesToHuman(order.productionMinutes)}</strong>.
        O tempo de permanência por etapa (acima) inclui eventuais períodos de suspensão, pelo que pode ser
        superior ao tempo de produção.
      </p>
    </div>
  );
}

function InterrupcoesTab({
  order,
  busy,
  onAction,
  id,
}: {
  order: ServiceOrderDetail;
  busy: boolean;
  onAction: (fn: () => Promise<unknown>) => Promise<void>;
  id: string;
}) {
  const [reason, setReason] = useState<InterruptionReason>("FALTA_MATERIA_PRIMA");
  const [otherDescription, setOtherDescription] = useState("");

  function handleStart(e: FormEvent) {
    e.preventDefault();
    onAction(() =>
      api.post(`/service-orders/${id}/interruptions`, {
        reason,
        otherDescription: reason === "OUTRO" ? otherDescription : undefined,
      })
    );
  }

  return (
    <div className="card">
      {order.status === "EM_PRODUCAO" && (
        <form onSubmit={handleStart} style={{ marginBottom: 16 }}>
          <h4>Registar interrupção</h4>
          <div className="form-grid">
            <div>
              <label>Motivo</label>
              <select value={reason} onChange={(e) => setReason(e.target.value as InterruptionReason)}>
                {Object.entries(INTERRUPTION_REASON_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            {reason === "OUTRO" && (
              <div>
                <label>Descrição</label>
                <input
                  type="text"
                  value={otherDescription}
                  onChange={(e) => setOtherDescription(e.target.value)}
                  required
                />
              </div>
            )}
          </div>
          <button className="btn" type="submit" disabled={busy}>
            Iniciar interrupção
          </button>
        </form>
      )}

      <table>
        <thead>
          <tr>
            <th>Motivo</th>
            <th>Início</th>
            <th>Fim</th>
            <th>Duração</th>
            <th>Utilizador</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {order.interruptions.map((i) => (
            <tr key={i.id}>
              <td>
                {INTERRUPTION_REASON_LABELS[i.reason]}
                {i.otherDescription ? ` — ${i.otherDescription}` : ""}
              </td>
              <td>{new Date(i.startedAt).toLocaleString("pt-PT")}</td>
              <td>{i.endedAt ? new Date(i.endedAt).toLocaleString("pt-PT") : "Em curso"}</td>
              <td>{i.durationMinutes !== null ? minutesToHuman(i.durationMinutes) : "—"}</td>
              <td>{i.user.name}</td>
              <td>
                {!i.endedAt && (
                  <button
                    className="btn secondary"
                    disabled={busy}
                    onClick={() => onAction(() => api.post(`/service-orders/${id}/interruptions/${i.id}/end`))}
                  >
                    Terminar
                  </button>
                )}
              </td>
            </tr>
          ))}
          {order.interruptions.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                Sem interrupções registadas.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ObservacoesTab({
  order,
  busy,
  onAction,
  id,
}: {
  order: ServiceOrderDetail;
  busy: boolean;
  onAction: (fn: () => Promise<unknown>) => Promise<void>;
  id: string;
}) {
  const [text, setText] = useState("");
  const activeStage = order.stageInstances.find((si) => si.status === "ATIVA");
  const [stageInstanceId, setStageInstanceId] = useState(activeStage?.id ?? "");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    onAction(() =>
      api.post(`/service-orders/${id}/observations`, { text, stageInstanceId: stageInstanceId || undefined })
    ).then(() => setText(""));
  }

  // Etapas já visitadas/atuais, para escolher a que a observação diz respeito
  // (uma OS pode passar mais do que uma vez pela mesma etapa — cada passagem
  // é uma instância própria, listada separadamente).
  const stageOptions = order.stageInstances.filter((si) => si.status !== "PENDENTE" || si.id === stageInstanceId);

  return (
    <div className="card">
      <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
        <div className="form-grid">
          <div>
            <label>Etapa (opcional)</label>
            <select value={stageInstanceId} onChange={(e) => setStageInstanceId(e.target.value)}>
              <option value="">Geral (sem etapa específica)</option>
              {stageOptions.map((si) => (
                <option key={si.id} value={si.id}>
                  {si.stage.name}
                  {si.status === "ATIVA" ? " (etapa atual)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label>Nova observação</label>
        <textarea rows={3} style={{ width: "100%" }} value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn" type="submit" disabled={busy} style={{ marginTop: 8 }}>
          Adicionar
        </button>
      </form>

      <ul className="history-list">
        {order.observations.map((o) => (
          <li key={o.id}>
            <time>
              {new Date(o.createdAt).toLocaleString("pt-PT")} — {o.user.name}
              {o.stageInstance && (
                <span className="badge badge-neutral" style={{ marginLeft: 8 }}>
                  {o.stageInstance.stage.name}
                </span>
              )}
            </time>
            {o.text}
          </li>
        ))}
        {order.observations.length === 0 && <li className="muted">Sem observações registadas.</li>}
      </ul>
    </div>
  );
}

function HistoricoTab({ history }: { history: HistoryEvent[] }) {
  return (
    <div className="card">
      <ul className="history-list">
        {history.map((h) => (
          <li key={h.id}>
            <time>
              {new Date(h.createdAt).toLocaleString("pt-PT")} — {h.user?.name ?? "Sistema"} · {h.type}
            </time>
            {h.description}
          </li>
        ))}
        {history.length === 0 && <li className="muted">Sem eventos de histórico.</li>}
      </ul>
    </div>
  );
}
