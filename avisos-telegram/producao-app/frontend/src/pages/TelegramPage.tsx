import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../contexts/AuthContext";

// ============================================================================
// Avisos por Telegram (pedido do utilizador de 2026-10-17): mensagem quando
// uma Ordem de Serviço é lançada e quando é terminada. Só o administrador
// configura: token do bot (@BotFather), conversas que recebem e que avisos.
// ============================================================================

interface Chat {
  id: string;
  title: string;
  type?: string;
}

interface Settings {
  enabled: boolean;
  hasToken: boolean;
  tokenMasked: string;
  botName?: string | null;
  chats: Chat[];
  events: { created: boolean; started: boolean; completed: boolean };
}

const EVENTS: { key: keyof Settings["events"]; label: string; hint: string }[] = [
  { key: "created", label: "OS lançada", hint: "quando uma Ordem de Serviço entra no programa" },
  { key: "completed", label: "OS terminada", hint: "quando sai da última etapa (concluída)" },
  { key: "started", label: "Produção iniciada", hint: "quando se carrega em Iniciar produção" },
];

export function TelegramPage() {
  const { user } = useAuth();
  const [s, setS] = useState<Settings | null>(null);
  const [token, setToken] = useState("");
  const [found, setFound] = useState<Chat[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api
      .get<Settings>("/telegram")
      .then(setS)
      .catch((err) => setMsg({ ok: false, text: err instanceof Error ? err.message : "Erro ao carregar." }));
  }, []);

  if (user?.role !== "ADMINISTRADOR") return <Navigate to="/" replace />;
  if (!s) return <div className="muted">{msg?.text ?? "A carregar..."}</div>;

  async function run(label: string, fn: () => Promise<void>): Promise<boolean> {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Erro." });
      return false;
    } finally {
      setBusy(null);
    }
  }

  const save = (patch: Partial<Settings> & { botToken?: string }, okText?: string) =>
    run("save", async () => {
      const next = await api.put<Settings>("/telegram", {
        enabled: patch.enabled ?? s.enabled,
        chats: (patch.chats ?? s.chats).map((c) => ({ id: c.id, title: c.title })),
        events: patch.events ?? s.events,
        ...(patch.botToken ? { botToken: patch.botToken } : {}),
      });
      setS(next);
      if (okText) setMsg({ ok: true, text: okText });
    });

  const selected = new Set(s.chats.map((c) => c.id));
  const candidates = [...(found ?? []), ...s.chats.filter((c) => !(found ?? []).some((f) => f.id === c.id))];

  return (
    <div>
      <div className="page-header">
        <h2>Avisos por Telegram</h2>
      </div>

      <div className="card" style={{ borderLeft: `4px solid ${s.enabled ? "#16a34a" : "#98a2b3"}` }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
          <div>
            <strong>{s.enabled ? "Avisos ligados" : "Avisos desligados"}</strong>
            <div className="muted" style={{ fontSize: 13 }}>
              {s.enabled
                ? `A enviar para ${s.chats.length} conversa(s)${s.botName ? ` pelo bot @${s.botName}` : ""}.`
                : "Preenche os passos abaixo e liga os avisos."}
            </div>
          </div>
          <button
            className={`btn${s.enabled ? " secondary" : ""}`}
            disabled={busy !== null || (!s.enabled && (!s.hasToken || s.chats.length === 0))}
            onClick={() => save({ enabled: !s.enabled }, s.enabled ? "Avisos desligados." : "Avisos ligados.")}
          >
            {s.enabled ? "Desligar avisos" : "Ligar avisos"}
          </button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>1. Bot do Telegram</h3>
        {s.hasToken ? (
          <p style={{ marginTop: 0 }}>
            Bot ligado: <strong>{s.botName ? `@${s.botName}` : "—"}</strong> <span className="muted">({s.tokenMasked})</span>
          </p>
        ) : (
          <ol className="muted" style={{ marginTop: 0, fontSize: 14, paddingLeft: 18 }}>
            <li>
              No Telegram, abre o <strong>@BotFather</strong> e envia <code>/newbot</code>.
            </li>
            <li>Escolhe um nome (ex.: "Produção Minho Ferragens") e um utilizador acabado em "bot".</li>
            <li>O BotFather responde com um <strong>token</strong> (ex.: 7712345678:AAH…). Cola-o aqui.</li>
          </ol>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={s.hasToken ? "Novo token (só para trocar de bot)" : "Token do bot"}
            style={{ flex: "1 1 300px", maxWidth: 460 }}
            autoComplete="off"
          />
          <button
            className="btn"
            disabled={busy !== null || !token.trim()}
            onClick={() =>
              save({ botToken: token.trim() }, "Token válido — bot ligado.").then((ok) => {
                if (!ok) return;
                setToken("");
                setFound(null);
              })
            }
          >
            {busy === "save" ? "A verificar..." : "Guardar token"}
          </button>
        </div>
      </div>

      <div className="card" style={{ opacity: s.hasToken ? 1 : 0.55 }}>
        <h3 style={{ marginTop: 0 }}>2. Quem recebe</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
          Cada pessoa abre o bot{s.botName ? ` (@${s.botName})` : ""} no Telegram e carrega em <strong>Iniciar</strong> (ou escreve-lhe
          uma mensagem). Para um grupo, adiciona o bot ao grupo e escreve lá qualquer coisa. Depois carrega em "Procurar
          conversas".
        </p>
        <button
          className="btn secondary"
          disabled={busy !== null || !s.hasToken}
          onClick={() =>
            run("discover", async () => {
              const list = await api.post<Chat[]>("/telegram/discover");
              setFound(list);
              if (!list.length) setMsg({ ok: false, text: "Ninguém escreveu ao bot ainda (nas últimas 24 h). Escreve-lhe e tenta outra vez." });
            })
          }
        >
          {busy === "discover" ? "A procurar..." : "Procurar conversas"}
        </button>

        {candidates.length > 0 && (
          <div className="tg-chats">
            {candidates.map((c) => {
              const on = selected.has(c.id);
              return (
                <label key={c.id} className={`tg-chat${on ? " on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={busy !== null}
                    onChange={() =>
                      save({ chats: on ? s.chats.filter((x) => x.id !== c.id) : [...s.chats, { id: c.id, title: c.title }] })
                    }
                  />
                  <span>
                    <strong>{c.title}</strong>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {" "}
                      {c.type === "group" || c.type === "supergroup" ? "grupo" : c.type === "channel" ? "canal" : c.type === "private" ? "pessoa" : ""}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="card" style={{ opacity: s.hasToken ? 1 : 0.55 }}>
        <h3 style={{ marginTop: 0 }}>3. Que avisos</h3>
        {EVENTS.map((e) => (
          <label key={e.key} className="tg-event">
            <input
              type="checkbox"
              checked={s.events[e.key]}
              disabled={busy !== null || !s.hasToken}
              onChange={() => save({ events: { ...s.events, [e.key]: !s.events[e.key] } })}
            />
            <span>
              <strong>{e.label}</strong> <span className="muted">— {e.hint}</span>
            </span>
          </label>
        ))}
        <div style={{ marginTop: 12 }}>
          <button
            className="btn secondary"
            disabled={busy !== null || !s.hasToken || s.chats.length === 0}
            onClick={() =>
              run("test", async () => {
                const r = await api.post<{ title: string; ok: boolean; error?: string }[]>("/telegram/test", {});
                const bad = r.filter((x) => !x.ok);
                setMsg(
                  bad.length
                    ? { ok: false, text: bad.map((x) => `${x.title}: ${x.error}`).join(" · ") }
                    : { ok: true, text: `Mensagem de teste enviada para ${r.map((x) => x.title).join(", ")}.` }
                );
              })
            }
          >
            {busy === "test" ? "A enviar..." : "Enviar mensagem de teste"}
          </button>
        </div>
      </div>

      {msg && <p style={{ fontWeight: 600, color: msg.ok ? "#067647" : "#b42318" }}>{msg.text}</p>}
    </div>
  );
}
