import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api/client";
import { useFeature } from "../contexts/FeaturesContext";
import { FeatureTestBanner } from "../components/FeatureTestBanner";

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

// Números de OS (ex.: 2026/548) ficam realçados para se verem bem.
function renderText(t: string) {
  const parts = t.split(/(\b20\d{2}\/\d{1,5}\b)/g);
  return parts.map((p, i) => (/^20\d{2}\/\d{1,5}$/.test(p) ? <strong key={i} className="chat-os">{p}</strong> : <span key={i}>{p}</span>));
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

  if (feature.loading) return <div className="muted">A carregar...</div>;
  if (!feature.available) return <Navigate to="/" replace />;

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setError(null);
    try {
      const m = await api.post<Msg>("/chat/messages", { channel: active, text: t });
      setMsgs((prev) => [...prev, m]);
      lastRef.current = m.createdAt;
      setText("");
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
                  {c.last ? (c.last.mine ? "Tu: " : "") + c.last.text : c.tipo === "geral" ? "Conversa de toda a equipa" : "Sem mensagens"}
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
                      <span className="chat-text">{renderText(m.text)}</span>
                      <span className="chat-time">{hora(m.createdAt)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <form className="chat-input" onSubmit={send}>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              rows={1}
              placeholder="Escreve uma mensagem… (Enter envia, Shift+Enter muda de linha)"
              aria-label="Mensagem"
            />
            <button className="btn" type="submit" disabled={sending || !text.trim()}>
              Enviar
            </button>
          </form>
          {error && <p className="error-text" style={{ padding: "0 14px" }}>{error}</p>}
        </section>
      </div>
    </div>
  );
}
