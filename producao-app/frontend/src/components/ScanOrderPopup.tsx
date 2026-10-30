import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { ServiceOrderDetail, ServiceOrderListItem, StageInstance } from "../types";
import { PriorityBadge, StatusBadge } from "./Badges";
import { useFeature } from "../contexts/FeaturesContext";

// ============================================================================
// Leitura de código de barras → janela da OS (pedido do utilizador de
// 2026-10-30: "quero que ao ler o código de barras abra um pop-up que
// apareça a descrição, etapa atual e opção de passar para a próxima").
// Em teste: só para quem tem a funcionalidade "leituraCodigo".
//
// Duas formas de ler:
//  1. Leitor de código de barras USB/Bluetooth (o "leitor-pistola"): o
//     leitor "escreve" o número muito depressa e termina com Enter. Este
//     componente escuta o teclado em toda a aplicação e, quando chega uma
//     sequência rápida com o formato de uma OS (ex.: 2026/483), abre a
//     janela. Não interfere quando se está a escrever num campo de texto.
//  2. Câmara (página "Ler Código"): a página dispara o evento
//     "central:scan" com o código lido (ver openScanPopup).
// ============================================================================

const SCAN_EVENT = "central:scan";

/** Abre a janela da OS para um código lido (usado pela página Ler Código). */
export function openScanPopup(code: string) {
  window.dispatchEvent(new CustomEvent<string>(SCAN_EVENT, { detail: code }));
}

/** "2026/483", "2026-483" (teclado com outra disposição), "2026 / 483" → "2026/483". */
export function normalizeOsCode(raw: string): string | null {
  const m = raw.trim().match(/^(20\d{2})\s*[^0-9A-Za-z]{0,2}\s*(\d{1,5})$/);
  return m ? `${m[1]}/${Number(m[2])}` : null;
}

function isEditable(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function ScanOrderHost() {
  const feature = useFeature("leituraCodigo");
  const [code, setCode] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);

  const open = useCallback((c: string) => {
    setCode(c);
    setSeq((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!feature.available) return;
    const onEvent = (e: Event) => open((e as CustomEvent<string>).detail);
    window.addEventListener(SCAN_EVENT, onEvent);

    // Leitor USB: teclas com menos de ~50 ms entre si, terminadas em Enter.
    let buf = "";
    let last = 0;
    let fast = true;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditable(e.target)) {
        buf = "";
        return;
      }
      const now = performance.now();
      if (now - last > 80) {
        buf = "";
        fast = true;
      } else if (now - last > 50) {
        fast = false;
      }
      last = now;
      if (e.key === "Enter") {
        const c = buf.length >= 6 && fast ? normalizeOsCode(buf) : null;
        buf = "";
        if (c) {
          e.preventDefault();
          open(c);
        }
        return;
      }
      if (e.key.length === 1) buf += e.key;
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener(SCAN_EVENT, onEvent);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [feature.available, open]);

  if (!code) return null;
  return <ScanOrderPopup key={seq} code={code} onClose={() => setCode(null)} />;
}

function nextPending(order: ServiceOrderDetail): StageInstance | null {
  const stages = [...order.stageInstances].sort((a, b) => a.order - b.order);
  const cur = stages.find((s) => s.status === "ATIVA");
  return stages.find((s) => s.status === "PENDENTE" && (!cur || s.order > cur.order)) ?? null;
}

function ScanOrderPopup({ code, onClose }: { code: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [order, setOrder] = useState<ServiceOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async (id?: string) => {
    let orderId = id;
    if (!orderId) {
      const results = await api.get<ServiceOrderListItem[]>(`/service-orders?search=${encodeURIComponent(code)}`);
      const match =
        results.find((o) => o.externalId.toLowerCase() === code.toLowerCase()) ??
        results.find((o) => normalizeOsCode(o.externalId) === normalizeOsCode(code));
      if (!match) throw new Error(`Não foi encontrada nenhuma Ordem de Serviço com o número ${code}.`);
      orderId = match.id;
    }
    setOrder(await api.get<ServiceOrderDetail>(`/service-orders/${orderId}`));
  }, [code]);

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Erro ao abrir a OS."));
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const stages = order ? [...order.stageInstances].sort((a, b) => a.order - b.order) : [];
  const current = stages.find((s) => s.status === "ATIVA") ?? null;
  const next = order ? nextPending(order) : null;

  async function act() {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      if (order.status === "NAO_INICIADA") {
        await api.post(`/service-orders/${order.id}/start`);
        await load(order.id);
        setDone("Produção iniciada.");
      } else {
        if (!next && !window.confirm(`${order.externalId}: esta é a última etapa. Concluir a Ordem de Serviço?`)) {
          setBusy(false);
          return;
        }
        const r = await api.post<{ completed: boolean }>(`/service-orders/${order.id}/stage-flow/advance`);
        await load(order.id);
        setDone(r.completed ? "Ordem de Serviço concluída." : `Passou para ${next?.stage.name ?? "a etapa seguinte"}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível passar de etapa.");
    } finally {
      setBusy(false);
    }
  }

  let actionLabel: string | null = null;
  if (order?.status === "NAO_INICIADA") actionLabel = "Iniciar produção";
  else if (order?.status === "EM_PRODUCAO") actionLabel = next ? `Passar para ${next.stage.name}` : "Concluir a OS";

  return (
    <div className="plan-modal-backdrop scan-pop-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="plan-modal scan-pop" role="dialog" aria-label={`Ordem de Serviço ${code}`}>
        <div className="scan-pop-head">
          <div>
            <div className="scan-pop-kicker">Código lido</div>
            <h3 className="scan-pop-title">
              {order?.externalId ?? code}{" "}
              {order && <StatusBadge status={order.status} />}{" "}
              {order && <PriorityBadge priority={order.priority} label={order.priorityLabel} color={order.priorityColor} />}
            </h3>
            {order && (
              <p className="muted scan-pop-sub">
                {order.client.name} · {order.product.name}
              </p>
            )}
          </div>
          <button className="scan-pop-x" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>

        {!order && !error && <p className="muted">A procurar a OS…</p>}

        {order && (
          <>
            {(order.specifications || order.product.description) && (
              <div className="scan-pop-desc">
                <div className="scan-pop-label">Descrição</div>
                <div className="scan-pop-desc-text">{order.specifications || order.product.description}</div>
              </div>
            )}

            <div className="scan-pop-stage">
              <div>
                <div className="scan-pop-label">Etapa atual</div>
                <div className="scan-pop-stage-name">
                  {current
                    ? current.stage.name
                    : order.status === "CONCLUIDA"
                      ? "Concluída"
                      : order.status === "NAO_INICIADA"
                        ? "Não iniciada"
                        : "—"}
                  {current?.supplier?.name && <span className="muted"> · {current.supplier.name}</span>}
                </div>
              </div>
              {order.status === "EM_PRODUCAO" && (
                <div className="scan-pop-next">
                  <div className="scan-pop-label">A seguir</div>
                  <div>{next ? next.stage.name : "Concluir a OS"}</div>
                </div>
              )}
            </div>

            {stages.length > 0 && (
              <ol className="scan-pop-steps">
                {stages
                  .filter((s) => s.status !== "OMITIDA")
                  .map((s) => (
                    <li key={s.id} className={`scan-step is-${s.status.toLowerCase()}`}>
                      {s.stage.name}
                    </li>
                  ))}
              </ol>
            )}

            {order.status === "SUSPENSA" && (
              <p className="muted">A OS está suspensa — abre-a para retomar a produção.</p>
            )}
          </>
        )}

        {done && <p className="scan-pop-done">✓ {done}</p>}
        {error && <p className="error-text">{error}</p>}

        <div className="scan-pop-actions">
          {order && actionLabel && (
            <button ref={primaryRef} className="btn scan-pop-primary" disabled={busy} onClick={act}>
              {busy ? "A gravar…" : actionLabel}
            </button>
          )}
          {order && (
            <button
              className="btn secondary"
              onClick={() => {
                onClose();
                navigate(`/service-orders/${order.id}`);
              }}
            >
              Abrir OS
            </button>
          )}
          <button className="btn secondary" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
