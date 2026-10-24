import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api } from "../api/client";
import { useFeature } from "../contexts/FeaturesContext";
import { FeatureTestBanner } from "../components/FeatureTestBanner";
import { SERVICE_ORDER_STATUS_LABELS, ServiceOrderListItem } from "../types";

// ============================================================================
// Chat interno (pedido do utilizador de 2026-10-24). Conversa "Geral" para
// toda a equipa e conversas diretas com cada colega. Pergunta por mensagens
// novas de 4 em 4 segundos. Em teste só para o administrador.
// ============================================================================

const FEATURE_KEY = "chat";

interface Channel {
  channel: string;
  nome: string;
  tipo: "geral" | "dm";
  unread: number;
  last: { text: string; createdAt: string; mine: boolean } | null;
}
interface Msg {
  id: string;
  text: string;
  createdAt: string;
  userId: string;
  userName: string;
  mine: boolean;
}

function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() || "?";
}
function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
}
function diaLabel(iso: string) {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date();
  ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === hoje.toDateString()) return "Hoje";
  if (d.toDateString() === ontem.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" });
}
function quando(iso: string) {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? hora(iso) : d.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" });
}

// Ordens de Serviço anexadas à mensagem (pedido de 2026-10-24: "na conversa
// dar para selecionar ordem de serviço"). Ficam no texto como
// [[os:<id>|<número>]] e são mostradas como cartão com os dados atuais da OS.
const OS_TOKEN = /\[\[os:([^|\]]+)\|([^\]]*)\]\]/g;

function semTokens(t: string) {
  return t.replace(OS_TOKEN, (_m, _id, num) => `OS ${num}`).trim();
}

function OsCard({ id, num, os, mine }: { id: string; num: string; os?: ServiceOrderListItem; mine: boolean }) {
  return (
    <Link to={`/service-orders/${id}`} className={`chat-oscard${mine ? " mine" : ""}`}>
      <span className="chat-oscard-ic" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3" /></svg>
      </span>
      <span className="chat-oscard-text">
        <strong>OS {os?.externalId ?? num}</strong>
        {os ? (
          <>
            <span>{os.client.name}</span>
            <span className="chat-oscard-sub">
              {os.product.name} · {SERVICE_ORDER_STATUS_LABELS[os.status]}
              {os.currentStage ? ` · ${os.currentStage.name}` : ""}
            </span>
          </>
        ) : (
          <span className="chat-oscard-sub">Abrir a Ordem de Serviço</span>
        )}
      </span>
    </Link>
  );
}

// Números de OS escritos à mão (ex.: 2026/548) ficam realçados; as OS anexadas viram cartões.
function renderText(t: string, osMap: Map<string, ServiceOrderListItem>, mine: boolean) {
  const out: JSX.Element[] = [];
  let last = 0;
  let k = 0;
  const byNum = new Map([...osMap.values()].map((o) => [o.externalId, o] as [string, ServiceOrderListItem]));
  const plain = (txt: string) =>
    txt.split(/(\b20\d{2}\/\d{1,5}\b)/g).map((p) =>
      /^20\d{2}\/\d{1,5}$/.test(p) ? (
        byNum.get(p) ? (
          <Link key={k++} to={`/service-orders/${byNum.get(p)!.id}`} className="chat-os">{p}</Link>
        ) : (
          <strong key={k++} className="chat-os">{p}</strong>
        )
      ) : (
        <span key={k++}>{p}</span>
      )
    );
  for (const m of t.matchAll(OS_TOKEN)) {
    const before = t.slice(last, m.index).trim();
    if (before) out.push(<span key={k++} className="chat-text">{plain(before)}</span>);
    out.push(<OsCard key={k++} id={m[1]} num={m[2]} os={osMap.get(m[1])} mine={mine} />);
    last = (m.index ?? 0) + m[0].length;
  }
  const rest = t.slice(last).trim();
  if (rest) out.push(<span key={k++} className="chat-text">{plain(rest)}</span>);
  return out;
}

export function ChatPage() {
  const feature = useFeature(FEATURE_KEY);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [active, setActive] = useState("geral");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showList, setShowList] = useState(true); // telemóvel: lista ou conversa
  const [osList, setOsList] = useState<ServiceOrderListItem[]>([]);
  const [anexos, setAnexos] = useState<ServiceOrderListItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickQ, setPickQ] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastRef = useRef<string | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  const loadChannels = () => api.get<Channel[]>("/chat/channels").then(setChannels).catch(() => undefined);

  useEffect(() => {
    if (!feature.available) return;
    loadChannels();
    const t = setInterval(loadChannels, 10000);
    return () => clearInterval(t);
  }, [feature.available]);

  // Carrega a conversa escolhida e depois só as mensagens novas.
  useEffect(() => {
    if (!feature.available) return;
    let stop = false;
    setMsgs([]);
    lastRef.current = null;
    api
      .get<Msg[]>(`/chat/messages?channel=${encodeURIComponent(active)}`)
      .then((m) => {
        if (stop) return;
        setMsgs(m);
        lastRef.current = m.length ? m[m.length - 1].createdAt : null;
        api.post("/chat/read", { channel: active }).then(loadChannels).catch(() => undefined);
      })
      .catch(() => undefined);
    const t = setInterval(() => {
      const ch = activeRef.current;
      const after = lastRef.current;
      api
        .get<Msg[]>(`/chat/messages?channel=${encodeURIComponent(ch)}${after ? `&after=${encodeURIComponent(after)}` : ""}`)
        .then((m) => {
          if (stop || ch !== activeRef.current || !m.length) return;
          setMsgs((prev) => {
            const ids = new Set(prev.map((x) => x.id));
            return [...prev, ...m.filter((x) => !ids.has(x.id))];
          });
          lastRef.current = m[m.length - 1].createdAt;
          api.post("/chat/read", { channel: ch }).catch(() => undefined);
        })
        .catch(() => undefined);
    }, 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [active, feature.available]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  // Lista de OS para escolher e para mostrar os cartões com dados atuais.
  useEffect(() => {
    if (!feature.available) return;
    const load = () => api.get<ServiceOrderListItem[]>("/service-orders").then(setOsList).catch(() => undefined);
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [feature.available]);

  useEffect(() => {
    if (!pickerOpen) return;
    const h = (e: MouseEvent) => { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [pickerOpen]);

  if (feature.loading) return <div className="muted">A carregar...</div>;
  if (!feature.available) return <Navigate to="/" replace />;

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const tokens = anexos.map((o) => `[[os:${o.id}|${o.externalId}]]`).join("\n");
    const t = [text.trim(), tokens].filter(Boolean).join("\n");
    if (!t || sending) return;
    setSending(true);
    setError(null);
    try {
      const m = await api.post<Msg>("/chat/messages", { channel: active, text: t });
      setMsgs((prev) => [...prev, m]);
      lastRef.current = m.createdAt;
      setText("");
      setAnexos([]);
      loadChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar.");
    } finally {
      setSending(false);
    }
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const cur = channels.find((c) => c.channel === active);
  const osMap = new Map(osList.map((o) => [o.id, o] as [string, ServiceOrderListItem]));
  const norm = (x: string) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const pickMatches = osList
    .filter((o) => !anexos.some((a) => a.id === o.id))
    .filter((o) => !pickQ.trim() || norm(`${o.externalId} ${o.client.name} ${o.product.name}`).includes(norm(pickQ.trim())))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30);

  return (
    <div>
      <div className="page-header">
        <h2>Chat</h2>
      </div>
      <FeatureTestBanner featureKey={FEATURE_KEY} label="o chat interno" />
      <div className={`chat${showList ? " show-list" : " show-conv"}`}>
        <aside className="chat-list" aria-label="Conversas">
          {channels.map((c) => (
            <button
              key={c.channel}
              type="button"
              className={`chat-item${c.channel === active ? " on" : ""}`}
              onClick={() => {
                setActive(c.channel);
                setShowList(false);
              }}
            >
              <span className={`chat-avatar${c.tipo === "geral" ? " geral" : ""}`} aria-hidden="true">
                {c.tipo === "geral" ? "#" : initials(c.nome)}
              </span>
              <span className="chat-item-text">
                <span className="chat-item-top">
                  <strong>{c.nome}</strong>
                  {c.last && <span className="chat-item-time">{quando(c.last.createdAt)}</span>}
                </span>
                <span className="chat-item-last">
                  {c.last ? (c.last.mine ? "Tu: " : "") + semTokens(c.last.text) : c.tipo === "geral" ? "Conversa de toda a equipa" : "Sem mensagens"}
                </span>
              </span>
              {c.unread > 0 && <span className="chat-unread" aria-label={`${c.unread} por ler`}>{c.unread}</span>}
            </button>
          ))}
        </aside>

        <section className="chat-conv" aria-label={cur ? `Conversa: ${cur.nome}` : "Conversa"}>
          <header className="chat-conv-head">
            <button type="button" className="chat-back" onClick={() => setShowList(true)} aria-label="Voltar às conversas">
              ‹
            </button>
            <span className={`chat-avatar${cur?.tipo === "geral" ? " geral" : ""}`} aria-hidden="true">
              {cur?.tipo === "geral" ? "#" : initials(cur?.nome ?? "")}
            </span>
            <div>
              <strong>{cur?.nome ?? "Geral"}</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                {cur?.tipo === "dm" ? "Conversa privada" : "Toda a equipa"}
              </div>
            </div>
          </header>
          <div className="chat-msgs" ref={scrollRef} aria-live="polite">
            {msgs.length === 0 && <div className="chat-empty">Ainda não há mensagens. Escreve a primeira.</div>}
            {msgs.map((m, i) => {
              const prev = msgs[i - 1];
              const novoDia = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
              const agrupado = !novoDia && prev && prev.userId === m.userId && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60000;
              return (
                <div key={m.id}>
                  {novoDia && <div className="chat-day">{diaLabel(m.createdAt)}</div>}
                  <div className={`chat-msg${m.mine ? " mine" : ""}${agrupado ? " grouped" : ""}`}>
                    {!m.mine && !agrupado && cur?.tipo === "geral" && <div className="chat-author">{m.userName}</div>}
                    <div className="chat-bubble">
                      <span className="chat-content">{renderText(m.text, osMap, m.mine)}</span>
                      <span className="chat-time">{hora(m.createdAt)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {anexos.length > 0 && (
            <div className="chat-anexos">
              {anexos.map((o) => (
                <span key={o.id} className="chat-anexo">
                  OS {o.externalId} · {o.client.name}
                  <button type="button" onClick={() => setAnexos(anexos.filter((a) => a.id !== o.id))} aria-label={`Tirar OS ${o.externalId}`}>×</button>
                </span>
              ))}
            </div>
          )}
          <form className="chat-input" onSubmit={send}>
            <div className="chat-pick" ref={pickerRef}>
              <button
                type="button"
                className="btn secondary chat-pick-btn"
                onClick={() => { setPickerOpen((o) => !o); setPickQ(""); }}
                aria-expanded={pickerOpen}
                title="Anexar Ordem de Serviço"
              >
                + OS
              </button>
              {pickerOpen && (
                <div className="chat-picker" role="dialog" aria-label="Escolher Ordem de Serviço">
                  <input
                    autoFocus
                    type="search"
                    placeholder="Procurar nº, cliente ou produto…"
                    value={pickQ}
                    onChange={(e) => setPickQ(e.target.value)}
                    aria-label="Procurar Ordem de Serviço"
                  />
                  <div className="chat-picker-list">
                    {pickMatches.length === 0 && <div className="muted" style={{ padding: 10, fontSize: 13 }}>Nenhuma OS encontrada.</div>}
                    {pickMatches.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => { setAnexos([...anexos, o]); setPickerOpen(false); }}
                      >
                        <strong>{o.externalId}</strong>
                        <span>{o.client.name}</span>
                        <span className="muted">{o.product.name} · {SERVICE_ORDER_STATUS_LABELS[o.status]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              rows={1}
              placeholder="Escreve uma mensagem… (Enter envia, Shift+Enter muda de linha)"
              aria-label="Mensagem"
            />
            <button className="btn" type="submit" disabled={sending || (!text.trim() && !anexos.length)}>
              Enviar
            </button>
          </form>
          {error && <p className="error-text" style={{ padding: "0 14px" }}>{error}</p>}
        </section>
      </div>
    </div>
  );
}
