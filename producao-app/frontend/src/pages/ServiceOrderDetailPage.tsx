import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, downloadBlob } from "../api/client";
import {
  Attachment,
  HistoryEvent,
  INTERRUPTION_REASON_LABELS,
  InterruptionReason,
  ServiceOrderDetail,
  Stage,
  Supplier,
} from "../types";
import { minutesToDays, minutesToHuman, PriorityBadge, StatusBadge } from "../components/Badges";
import { canChangeFlow, canDeleteServiceOrders, useAuth } from "../contexts/AuthContext";

type Tab = "etapas" | "tempos" | "interrupcoes" | "observacoes" | "anexos" | "historico";

// Faz upload de um ficheiro em bruto para uma OS (e, opcionalmente, associado
// a uma observação — ver ObservacoesTab). O nome original do ficheiro segue
// como query param porque um upload em bruto (sem multipart) não o expõe de
// outra forma ao servidor.
async function uploadAttachment(orderId: string, file: File, observationId?: string): Promise<Attachment> {
  const params = new URLSearchParams({ filename: file.name });
  if (observationId) params.set("observationId", observationId);
  // A câmara de alguns telemóveis/browsers pode não preencher file.type —
  // nesse caso assume-se imagem (é sempre uma foto, neste fluxo), já que
  // "application/octet-stream" seria rejeitado pelo filtro de tipos aceites
  // no servidor.
  return api.postFile<Attachment>(
    `/service-orders/${orderId}/attachments?${params.toString()}`,
    file,
    file.type || "image/jpeg"
  );
}

// Renderiza o texto livre de "Características do Produto". Quando a OS tem
// um só artigo (o caso normal), mostra-se exatamente como sempre — linha a
// linha, sem tratamento especial. Quando tem vários artigos (ver
// goldylocksPdfParser.ts no backend, que os separa em blocos "Artigo N —
// ..."), sem isto sairia tudo seguido, difícil de separar visualmente —
// por isso cada artigo passa a ter o seu próprio título destacado e espaço
// entre blocos, e a linha "Referente a:" (partilhada por toda a OS) sai à
// parte, no fim, em vez de misturada com os campos do último artigo (pedido
// do utilizador de 2026-09-02: "melhora isto", a propósito da OS 2026/430
// com 2 artigos).
function SpecificationsBody({ specifications }: { specifications: string }) {
  const headerRe = /^Artigo \d+\s*—.*$/gm;
  const headers = [...specifications.matchAll(headerRe)];

  if (headers.length === 0) {
    return (
      <div className="spec-card-body">
        {specifications.split("\n").map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    );
  }

  const referenciaMatch = specifications.match(/^Referente a:\s*(.+)$/m);
  const referencia = referenciaMatch ? referenciaMatch[1].trim().replace(/,\s*$/, "") : null;
  const bodyText = referenciaMatch ? specifications.slice(0, referenciaMatch.index).trimEnd() : specifications;

  const blocks = headers.map((h, i) => {
    const start = h.index! + h[0].length;
    const end = i + 1 < headers.length ? headers[i + 1].index! : bodyText.length;
    return {
      title: h[0].trim(),
      lines: bodyText
        .slice(start, end)
        .split("\n")
        .filter((line) => line.trim().length > 0),
    };
  });

  return (
    <div className="spec-card-body">
      {blocks.map((block, i) => (
        <div key={i} className="spec-article-block">
          <div className="spec-article-title">{block.title}</div>
          {block.lines.map((line, j) => (
            <div key={j}>{line}</div>
          ))}
        </div>
      ))}
      {referencia && <div className="spec-referencia">Referente a: {referencia}</div>}
    </div>
  );
}

// Converte um ISO string para o formato aceite por <input type="datetime-local">.
function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ServiceOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [order, setOrder] = useState<ServiceOrderDetail | null>(null);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [tab, setTab] = useState<Tab>("etapas");
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [editingDeadline, setEditingDeadline] = useState(false);
  const [deadlineInput, setDeadlineInput] = useState("");
  const [deadlineReason, setDeadlineReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [downloadingLabel, setDownloadingLabel] = useState<"barcode" | "product" | "mosquiteira" | null>(null);

  async function downloadTravelerPdf() {
    if (!id) return;
    setDownloadingPdf(true);
    setActionError(null);
    try {
      const blob = await api.getBlob(`/service-orders/${id}/pdf`);
      downloadBlob(blob, `ficha-producao-${order?.externalId ?? id}.pdf`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Erro ao gerar a Ficha de Produção.");
    } finally {
      setDownloadingPdf(false);
    }
  }

  async function downloadLabel(kind: "barcode" | "product" | "mosquiteira") {
    if (!id) return;
    setDownloadingLabel(kind);
    setActionError(null);
    try {
      const blob = await api.getBlob(`/service-orders/${id}/label-${kind}`);
      const suffix =
        kind === "barcode" ? "etiqueta-barras" : kind === "product" ? "etiqueta-produto" : "etiqueta-mosquiteira";
      downloadBlob(blob, `${suffix}-${order?.externalId ?? id}.pdf`);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Erro ao gerar a etiqueta."
      );
    } finally {
      setDownloadingLabel(null);
    }
  }

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const [o, h, a] = await Promise.all([
        api.get<ServiceOrderDetail>(`/service-orders/${id}`),
        api.get<HistoryEvent[]>(`/service-orders/${id}/history`),
        api.get<Attachment[]>(`/service-orders/${id}/attachments`),
      ]);
      setOrder(o);
      setHistory(h);
      setAttachments(a);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    api.get<Stage[]>("/stages").then(setStages).catch(() => {});
    api.get<Supplier[]>("/suppliers").then(setSuppliers).catch(() => {});
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

  async function saveDeadline() {
    if (!id) return;
    if (!deadlineReason.trim()) {
      setActionError("É obrigatório justificar a alteração da data-limite.");
      return;
    }
    await runAction(() =>
      api.put(`/service-orders/${id}/deadline`, {
        deadlineAt: deadlineInput ? new Date(deadlineInput).toISOString() : null,
        reason: deadlineReason.trim(),
      })
    );
    setEditingDeadline(false);
    setDeadlineReason("");
  }

  async function handleDelete() {
    if (!id || !order) return;
    const confirmed = window.confirm(
      `Apagar definitivamente a Ordem de Serviço "${order.externalId}"?\n\n` +
        "Esta ação remove também todas as etapas, interrupções, observações e histórico associados, e não pode ser desfeita."
    );
    if (!confirmed) return;
    setDeleting(true);
    setActionError(null);
    try {
      await api.delete(`/service-orders/${id}`);
      navigate("/");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Erro ao apagar a Ordem de Serviço.");
      setDeleting(false);
    }
  }

  if (loading || !order) return <p className="muted">A carregar...</p>;

  const canFlow = canChangeFlow(user?.role);

  return (
    <div>
      <p>
        <Link to="/">&larr; Voltar às Ordens de Serviço</Link>
      </p>

      <div className="os-header">
        <div>
          <h2>
            {order.externalId} <StatusBadge status={order.status} />{" "}
            <PriorityBadge priority={order.priority} label={order.priorityLabel} color={order.priorityColor} />
          </h2>
          <p className="muted">
            {order.client.name} · {order.product.name}
            {order.product.externalId ? ` (${order.product.externalId})` : ""}
          </p>
        </div>
        <div className="os-header-actions">
          <div className="os-actions-group">
            {order.status === "NAO_INICIADA" && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => runAction(() => api.post(`/service-orders/${id}/start`))}
              >
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
            <button className="btn secondary" disabled={downloadingPdf} onClick={downloadTravelerPdf}>
              {downloadingPdf ? "A gerar..." : "Ficha de Produção (PDF)"}
            </button>
            {order.product.category === "Painéis" && (
              <>
                <button
                  className="btn secondary"
                  disabled={downloadingLabel !== null}
                  onClick={() => downloadLabel("barcode")}
                  title="Etiqueta pequena com código de barras para colar no produto — lê-se com o botão &quot;Ler Código&quot; na aplicação para abrir esta OS"
                >
                  {downloadingLabel === "barcode" ? "A gerar..." : "Etiqueta Código de Barras"}
                </button>
                <button
                  className="btn secondary"
                  disabled={downloadingLabel !== null}
                  onClick={() => downloadLabel("product")}
                  title="Etiqueta com as características do produto"
                >
                  {downloadingLabel === "product" ? "A gerar..." : "Etiqueta do Produto"}
                </button>
              </>
            )}
            {order.product.category === "Mosquiteiras" && (
              <button
                className="btn secondary"
                disabled={downloadingLabel !== null}
                onClick={() => downloadLabel("mosquiteira")}
                title="Etiqueta de mosquiteira — uma por unidade física"
              >
                {downloadingLabel === "mosquiteira" ? "A gerar..." : "Etiqueta de Mosquiteira"}
              </button>
            )}
          </div>

          {((order.status === "NAO_INICIADA" || order.status === "EM_PRODUCAO" || order.status === "SUSPENSA") ||
            canDeleteServiceOrders(user?.role)) && (
            <>
              <div className="os-actions-divider" />
              <div className="os-actions-group">
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
                {canDeleteServiceOrders(user?.role) && (
                  <button className="btn danger" disabled={busy || deleting} onClick={handleDelete}>
                    {deleting ? "A apagar..." : "Apagar OS"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {actionError && <p className="error-text">{actionError}</p>}

      {order.specifications && (
        <div className="card spec-card">
          <div className="spec-card-label">Características do Produto</div>
          <SpecificationsBody specifications={order.specifications} />
        </div>
      )}

      {order.currentStage?.expectedReturnAt && (
        <div className="card spec-card">
          <div className="spec-card-label">
            {order.currentStage.name}
            {order.currentStage.supplier ? ` — ${order.currentStage.supplier}` : ""}
          </div>
          <div className="spec-card-body">
            Entrega prevista: {new Date(order.currentStage.expectedReturnAt).toLocaleDateString("pt-PT")}
            {order.currentStage.leadDays != null && ` (prazo de ${order.currentStage.leadDays} dias)`}
          </div>
        </div>
      )}

      <div className="info-tiles">
        <div className="info-tile">
          <div className="info-tile-label">Data de início</div>
          <div className="info-tile-value">{new Date(order.createdAt).toLocaleString("pt-PT")}</div>
        </div>
        <div className="info-tile">
          <div className="info-tile-label">Início da produção</div>
          <div className="info-tile-value">
            {order.startedAt ? new Date(order.startedAt).toLocaleString("pt-PT") : "—"}
          </div>
        </div>
        <div className="info-tile">
          <div className="info-tile-label">Data-limite</div>
          <div className="info-tile-value">
            {editingDeadline ? (
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="datetime-local"
                  value={deadlineInput}
                  onChange={(e) => setDeadlineInput(e.target.value)}
                  style={{ fontSize: 13, padding: "4px 6px" }}
                />
                <input
                  type="text"
                  placeholder="Motivo da alteração (obrigatório)"
                  value={deadlineReason}
                  onChange={(e) => setDeadlineReason(e.target.value)}
                  style={{ fontSize: 13, padding: "4px 6px", minWidth: 220 }}
                />
                <button
                  className="btn secondary"
                  style={{ padding: "4px 8px", fontSize: 12 }}
                  disabled={busy || !deadlineReason.trim()}
                  onClick={saveDeadline}
                >
                  Guardar
                </button>
                <button
                  className="btn secondary"
                  style={{ padding: "4px 8px", fontSize: 12 }}
                  onClick={() => {
                    setEditingDeadline(false);
                    setDeadlineReason("");
                  }}
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <div>
                {order.deadlineAt ? new Date(order.deadlineAt).toLocaleString("pt-PT") : "—"}
                {canFlow && (
                  <button
                    className="btn secondary"
                    style={{ marginLeft: 8, padding: "2px 8px", fontSize: 11 }}
                    onClick={() => {
                      setDeadlineInput(toDatetimeLocalValue(order.deadlineAt));
                      setEditingDeadline(true);
                    }}
                  >
                    Editar
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="info-tile">
          <div className="info-tile-label">Conclusão</div>
          <div className="info-tile-value">
            {order.completedAt ? new Date(order.completedAt).toLocaleString("pt-PT") : "—"}
          </div>
        </div>
        <div className="info-tile">
          <div className="info-tile-label">Tempo de produção (total)</div>
          <div className="info-tile-value">{minutesToDays(order.productionMinutes)}</div>
        </div>
      </div>

      <div className="tabs">
        {(["etapas", "tempos", "interrupcoes", "observacoes", "anexos", "historico"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {tabLabel(t)}
          </button>
        ))}
      </div>

      {tab === "etapas" && (
        <EtapasTab
          order={order}
          stages={stages}
          suppliers={suppliers}
          canFlow={canFlow}
          busy={busy}
          onAction={runAction}
          id={id!}
        />
      )}

      {tab === "tempos" && <TemposTab order={order} />}

      {tab === "interrupcoes" && <InterrupcoesTab order={order} busy={busy} onAction={runAction} id={id!} />}

      {tab === "observacoes" && (
        <ObservacoesTab
          order={order}
          attachments={attachments}
          busy={busy}
          onAction={runAction}
          id={id!}
        />
      )}

      {tab === "anexos" && (
        <AnexosTab attachments={attachments} busy={busy} onAction={runAction} id={id!} />
      )}

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
    anexos: "Anexos",
    historico: "Histórico",
  }[t];
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Pré-visualização/download de um anexo autenticado: como a rota exige o
// token JWT (enviado via header, não cookie), não é possível usar
// diretamente <img src="..."> ou <a href="..."> — é preciso ir buscar o
// ficheiro (Blob) através do cliente da API e transformá-lo num URL local.
function AttachmentThumb({ id, attachment }: { id: string; attachment: Attachment }) {
  const [url, setUrl] = useState<string | null>(null);
  const isImage = attachment.mimeType.startsWith("image/");

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    if (isImage) {
      api.getBlob(`/service-orders/${id}/attachments/${attachment.id}`).then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      });
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.id]);

  async function handleDownload() {
    const blob = await api.getBlob(`/service-orders/${id}/attachments/${attachment.id}`);
    downloadBlob(blob, attachment.filename);
  }

  if (isImage) {
    return (
      <button
        type="button"
        className="attachment-thumb"
        onClick={handleDownload}
        title={attachment.filename}
        style={{ padding: 0, border: "none", background: "none", cursor: "pointer" }}
      >
        {url ? (
          <img
            src={url}
            alt={attachment.filename}
            style={{
              width: 96,
              height: 96,
              objectFit: "cover",
              borderRadius: 8,
              border: "1px solid var(--color-border)",
            }}
          />
        ) : (
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: 8,
              border: "1px solid var(--color-border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            className="muted"
          >
            ...
          </div>
        )}
      </button>
    );
  }

  return (
    <button className="btn secondary" style={{ fontSize: 12, padding: "4px 8px" }} onClick={handleDownload}>
      Baixar {attachment.filename}
    </button>
  );
}

function EtapasTab({
  order,
  stages,
  suppliers,
  canFlow,
  busy,
  onAction,
  id,
}: {
  order: ServiceOrderDetail;
  stages: Stage[];
  suppliers: Supplier[];
  canFlow: boolean;
  busy: boolean;
  onAction: (fn: () => Promise<unknown>) => Promise<void>;
  id: string;
}) {
  const [insertStageId, setInsertStageId] = useState("");
  const [returnStageId, setReturnStageId] = useState("");
  const [revertStageId, setRevertStageId] = useState("");
  const [expandedStageId, setExpandedStageId] = useState<string | null>(null);

  const visited = order.stageInstances.filter((si) => si.status === "CONCLUIDA" || si.status === "ATIVA");

  return (
    <div className="card">
      <div className="stage-timeline">
        {order.stageInstances.map((si) => {
          const siObservations = order.observations.filter((o) => o.stageInstanceId === si.id);
          const isExpanded = expandedStageId === si.id;
          return (
            <div
              key={si.id}
              className={`stage-pill ${si.status.toLowerCase()} clickable`}
              onClick={() => setExpandedStageId(isExpanded ? null : si.id)}
            >
              <div className="stage-pill-header">
                <strong>{si.stage.name}</strong>
                {siObservations.length > 0 && (
                  <span className="badge stage-note-count">{siObservations.length}</span>
                )}
              </div>
              {si.wasManuallyAdded && <div className="muted">(alteração pontual)</div>}
              {si.stage.requiresSupplier && si.status === "ATIVA" && canFlow ? (
                <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 4 }}>
                  <select
                    value={si.supplierId ?? ""}
                    disabled={busy}
                    onChange={(e) =>
                      onAction(() =>
                        api.put(`/service-orders/${id}/stage-instances/${si.id}/supplier`, {
                          supplierId: e.target.value || null,
                        })
                      )
                    }
                    style={{ fontSize: 12, padding: "4px 6px", width: "100%" }}
                  >
                    <option value="">Escolher fornecedor...</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                si.supplier && <div className="muted">Fornecedor: {si.supplier.name}</div>
              )}
              <div className="muted">{minutesToDays(si.residenceMinutes)} de permanência</div>
              {order.currentStage?.id === si.id && order.currentStage.expectedReturnAt && (
                <div className="lead-time-hint">
                  Entrega prevista: {new Date(order.currentStage.expectedReturnAt).toLocaleDateString("pt-PT")}
                </div>
              )}
              {si.status === "PENDENTE" && canFlow && (
                <button
                  className="btn secondary"
                  style={{ marginTop: 6, fontSize: 11, padding: "4px 8px" }}
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAction(() => api.post(`/service-orders/${id}/stage-flow/skip`, { stageInstanceId: si.id }));
                  }}
                >
                  Omitir
                </button>
              )}
              {isExpanded && (
                <div className="stage-pill-observations" onClick={(e) => e.stopPropagation()}>
                  {siObservations.length === 0 && (
                    <div className="muted">Sem observações registadas nesta etapa.</div>
                  )}
                  {siObservations.map((o) => (
                    <div key={o.id} className="stage-pill-observation">
                      <div className="muted">
                        {o.user.name} · {new Date(o.createdAt).toLocaleString("pt-PT")}
                      </div>
                      {o.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
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
              <td>{minutesToDays(si.residenceMinutes)}</td>
              <td>{si.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ marginTop: 12 }}>
        Tempo de produção total (exclui suspensões): <strong>{minutesToDays(order.productionMinutes)}</strong>.
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
  attachments,
  busy,
  onAction,
  id,
}: {
  order: ServiceOrderDetail;
  attachments: Attachment[];
  busy: boolean;
  onAction: (fn: () => Promise<unknown>) => Promise<void>;
  id: string;
}) {
  const [text, setText] = useState("");
  const activeStage = order.stageInstances.find((si) => si.status === "ATIVA");
  const [stageInstanceId, setStageInstanceId] = useState(activeStage?.id ?? "");
  const [photo, setPhoto] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setUploading(true);
    onAction(async () => {
      const observation = await api.post<{ id: string }>(`/service-orders/${id}/observations`, {
        text,
        stageInstanceId: stageInstanceId || undefined,
      });
      if (photo) {
        await uploadAttachment(id, photo, observation.id);
      }
    })
      .then(() => {
        setText("");
        setPhoto(null);
      })
      .finally(() => setUploading(false));
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
        <div style={{ marginTop: 8 }}>
          <label>
            Fotografia (opcional) — tirar diretamente no telemóvel ou escolher do dispositivo
          </label>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
          {photo && <span className="muted" style={{ marginLeft: 8 }}>{photo.name}</span>}
        </div>
        <button className="btn" type="submit" disabled={busy || uploading} style={{ marginTop: 8 }}>
          {uploading ? "A adicionar..." : "Adicionar"}
        </button>
      </form>

      <ul className="history-list">
        {order.observations.map((o) => {
          const photos = attachments.filter((a) => a.observationId === o.id);
          return (
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
              {photos.length > 0 && (
                <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  {photos.map((a) => (
                    <AttachmentThumb key={a.id} id={id} attachment={a} />
                  ))}
                </div>
              )}
            </li>
          );
        })}
        {order.observations.length === 0 && <li className="muted">Sem observações registadas.</li>}
      </ul>
    </div>
  );
}

function AnexosTab({
  attachments,
  busy,
  onAction,
  id,
}: {
  attachments: Attachment[];
  busy: boolean;
  onAction: (fn: () => Promise<unknown>) => Promise<void>;
  id: string;
}) {
  const [uploading, setUploading] = useState(false);
  const general = attachments.filter((a) => !a.observationId);

  function handleFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    onAction(() => uploadAttachment(id, file)).finally(() => setUploading(false));
  }

  return (
    <div className="card">
      <p className="muted">
        Desenhos técnicos, fotos do produto ou outros ficheiros gerais desta Ordem de Serviço (imagens ou PDF).
      </p>
      <input
        type="file"
        accept="image/*,application/pdf"
        disabled={uploading || busy}
        onChange={(e) => {
          handleFile(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
      {uploading && <p className="muted">A enviar...</p>}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 16 }}>
        {general.map((a) => (
          <div key={a.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <AttachmentThumb id={id} attachment={a} />
            <div className="muted" style={{ fontSize: 11, maxWidth: 100, textAlign: "center", wordBreak: "break-word" }}>
              {a.filename}
            </div>
            <div className="muted" style={{ fontSize: 10 }}>
              {formatFileSize(a.size)} · {a.uploadedBy?.name ?? "—"}
            </div>
            <button
              className="btn secondary"
              style={{ fontSize: 11, padding: "2px 6px" }}
              disabled={busy}
              onClick={() => onAction(() => api.delete(`/service-orders/${id}/attachments/${a.id}`))}
            >
              Remover
            </button>
          </div>
        ))}
        {general.length === 0 && <p className="muted">Sem anexos.</p>}
      </div>
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
