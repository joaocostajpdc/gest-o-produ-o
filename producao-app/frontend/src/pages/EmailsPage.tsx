import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../contexts/AuthContext";

// ============================================================================
// Emails automáticos (pedido do utilizador de 2026-10-20): à segunda-feira,
// as OS que têm de ser terminadas nessa semana e o material que as lacagens
// têm de entregar. Só o administrador configura: a conta que envia (SMTP),
// quem recebe, o dia e a hora. Ver backend/src/services/emailReportsService.ts.
// ============================================================================

type ReportKey = "osSemana" | "lacagemSemana";
type Canal = "email" | "telegram" | "ambos";
interface ReportCfg {
  canal: Canal;
  tgChats: string[];
  enabled: boolean;
  to: string[];
  weekday: number;
  hour: number;
}
interface Smtp {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  hasPass: boolean;
  fromName: string;
  fromEmail: string;
}
interface Data {
  smtp: Smtp;
  reports: Record<ReportKey, ReportCfg>;
  reportNames: Record<ReportKey, string>;
  telegramChats: { id: string; title: string }[];
  log: Partial<Record<ReportKey, { week: string; at: string; ok: boolean; info: string }>>;
}

const WEEKDAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const PRESETS = [
  { label: "Gmail", host: "smtp.gmail.com", port: 465, secure: true },
  { label: "Outlook / Microsoft 365", host: "smtp.office365.com", port: 587, secure: false },
  { label: "Email do domínio (cPanel)", host: "mail.minhoferragens.pt", port: 465, secure: true },
];

export function EmailsPage() {
  const { user } = useAuth();
  const [d, setD] = useState<Data | null>(null);
  const [pass, setPass] = useState("");
  const [toText, setToText] = useState<Record<ReportKey, string>>({ osSemana: "", lacagemSemana: "" });
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);

  function load(data: Data) {
    setD(data);
    setToText({ osSemana: data.reports.osSemana.to.join(", "), lacagemSemana: data.reports.lacagemSemana.to.join(", ") });
    setPass("");
  }

  useEffect(() => {
    api
      .get<Data>("/email-reports")
      .then(load)
      .catch((err) => setMsg({ ok: false, text: err instanceof Error ? err.message : "Erro ao carregar." }));
  }, []);

  if (user?.role !== "ADMINISTRADOR") return <Navigate to="/" replace />;
  if (!d) return <div className="muted">{msg?.text ?? "A carregar..."}</div>;

  const keys = Object.keys(d.reportNames) as ReportKey[];
  const setSmtp = (p: Partial<Smtp>) => setD({ ...d, smtp: { ...d.smtp, ...p } });
  const setRep = (k: ReportKey, p: Partial<ReportCfg>) => setD({ ...d, reports: { ...d.reports, [k]: { ...d.reports[k], ...p } } });
  const parseTo = (t: string) => t.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

  async function run(label: string, fn: () => Promise<string | void>) {
    setBusy(label);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ ok: true, text });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Erro." });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const body = {
      smtp: { ...d!.smtp, pass },
      reports: Object.fromEntries(keys.map((k) => [k, { ...d!.reports[k], to: parseTo(toText[k]) }])),
    };
    const out = await api.put<Data>("/email-reports", body);
    load(out);
  }

  return (
    <div>
      <div className="page-header">
        <h2>Avisos Semanais</h2>
      </div>
      {msg && (
        <p className={msg.ok ? "" : "error-text"} style={msg.ok ? { color: "#16a34a", fontWeight: 600 } : undefined}>
          {msg.text}
        </p>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Conta de email que envia</h3>
        <p className="muted" style={{ marginTop: -6 }}>
          Só é usada nos avisos enviados por email. Atenção: no plano gratuito do Render o envio de email está bloqueado
          (dá "Connection timeout") — use o Telegram.
        </p>
        <p className="muted" style={{ marginTop: -6 }}>
          O email de onde saem as mensagens. Em Gmail ou Microsoft 365 use uma <b>palavra-passe de aplicação</b>, não a palavra-passe normal.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {PRESETS.map((p) => (
            <button key={p.label} type="button" className="btn secondary" onClick={() => setSmtp({ host: p.host, port: p.port, secure: p.secure })}>
              {p.label}
            </button>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <div className="field">
            <label>Servidor SMTP</label>
            <input value={d.smtp.host} onChange={(e) => setSmtp({ host: e.target.value })} placeholder="smtp.gmail.com" />
          </div>
          <div className="field">
            <label>Porta</label>
            <input type="number" value={d.smtp.port} onChange={(e) => setSmtp({ port: Number(e.target.value) || 465 })} />
          </div>
          <div className="field">
            <label>Ligação segura</label>
            <select value={d.smtp.secure ? "1" : "0"} onChange={(e) => setSmtp({ secure: e.target.value === "1" })}>
              <option value="1">SSL (porta 465)</option>
              <option value="0">STARTTLS (porta 587)</option>
            </select>
          </div>
          <div className="field">
            <label>Utilizador (email)</label>
            <input value={d.smtp.user} onChange={(e) => setSmtp({ user: e.target.value })} placeholder="geral@minhoferragens.pt" />
          </div>
          <div className="field">
            <label>Palavra-passe</label>
            <input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder={d.smtp.hasPass ? "•••••••• (guardada — deixe vazio para manter)" : "palavra-passe de aplicação"}
              autoComplete="new-password"
            />
          </div>
          <div className="field">
            <label>Nome do remetente</label>
            <input value={d.smtp.fromName} onChange={(e) => setSmtp({ fromName: e.target.value })} />
          </div>
          <div className="field">
            <label>Email do remetente (opcional)</label>
            <input value={d.smtp.fromEmail} onChange={(e) => setSmtp({ fromEmail: e.target.value })} placeholder="igual ao utilizador" />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 12 }}>
          <div className="field" style={{ margin: 0, minWidth: 260 }}>
            <label>Enviar email de teste para</label>
            <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="o-seu-email@…" />
          </div>
          <button
            className="btn secondary"
            disabled={!!busy || !testTo}
            onClick={() =>
              run("test", async () => {
                await save();
                await api.post("/email-reports/test", { to: testTo });
                return `Email de teste enviado para ${testTo}.`;
              })
            }
          >
            {busy === "test" ? "A enviar…" : "Gravar e enviar teste"}
          </button>
        </div>
      </div>

      {keys.map((k) => {
        const r = d.reports[k];
        const log = d.log[k];
        return (
          <div className="card" key={k}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h3 style={{ margin: 0 }}>{d.reportNames[k]}</h3>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600 }}>
                <input type="checkbox" checked={r.enabled} onChange={(e) => setRep(k, { enabled: e.target.checked })} />
                Ativo
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr 1fr", gap: 12, marginTop: 12 }}>
              <div className="field">
                <label>Enviar por</label>
                <select value={r.canal} onChange={(e) => setRep(k, { canal: e.target.value as Canal })}>
                  <option value="telegram">Telegram</option>
                  <option value="email">Email</option>
                  <option value="ambos">Telegram e email</option>
                </select>
              </div>
              <div className="field">
                <label>{r.canal === "telegram" ? "Destinatários" : "Emails (separe vários com vírgula)"}</label>
                {r.canal === "telegram" ? (
                  <div style={{ display: "flex", gap: "6px 14px", flexWrap: "wrap", paddingTop: 6 }}>
                    {d.telegramChats.length === 0 && <span className="muted">Sem conversas — configure em Avisos Telegram.</span>}
                    {d.telegramChats.map((c) => (
                      <label key={c.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input
                          type="checkbox"
                          checked={r.tgChats.length === 0 || r.tgChats.includes(c.id)}
                          onChange={(e) => {
                            const all = d.telegramChats.map((x) => x.id);
                            const cur = r.tgChats.length === 0 ? all : r.tgChats;
                            const next = e.target.checked ? [...new Set([...cur, c.id])] : cur.filter((x) => x !== c.id);
                            if (next.length === 0) return; // pelo menos uma conversa
                            setRep(k, { tgChats: next.length === all.length ? [] : next });
                          }}
                        />
                        {c.title}
                      </label>
                    ))}
                  </div>
                ) : (
                  <input value={toText[k]} onChange={(e) => setToText({ ...toText, [k]: e.target.value })} placeholder="producao@minhoferragens.pt" />
                )}
              </div>
              <div className="field">
                <label>Dia</label>
                <select value={r.weekday} onChange={(e) => setRep(k, { weekday: Number(e.target.value) })}>
                  {WEEKDAYS.map((w, i) => (
                    <option key={w} value={i + 1}>
                      {w}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Hora</label>
                <select value={r.hour} onChange={(e) => setRep(k, { hour: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>
              {log
                ? `Último envio: ${new Date(log.at).toLocaleString("pt-PT")} — ${log.ok ? "enviado" : "falhou"} (${log.info})`
                : "Ainda não foi enviado."}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn secondary"
                disabled={!!busy}
                onClick={() =>
                  run("prev" + k, async () => {
                    const p = await api.get<{ subject: string; html: string }>(`/email-reports/${k}/preview`);
                    setPreview(p);
                  })
                }
              >
                Pré-visualizar esta semana
              </button>
              <button
                className="btn secondary"
                disabled={!!busy}
                onClick={() =>
                  run("pdf" + k, async () => {
                    // Abre já a janela (senão o browser bloqueia) e depois mostra o PDF.
                    const w = window.open("", "_blank");
                    const blob = await api.getBlob(`/email-reports/${k}/pdf`);
                    const url = URL.createObjectURL(blob);
                    if (w) w.location.href = url;
                    else window.location.href = url;
                  })
                }
              >
                {busy === "pdf" + k ? "A gerar…" : "Ver PDF desta semana"}
              </button>
              <button
                className="btn secondary"
                disabled={!!busy}
                onClick={() =>
                  run("send" + k, async () => {
                    await save();
                    const out = await api.post<{ count: number }>(`/email-reports/${k}/send`, {});
                    return `Enviado agora (${out.count} linha(s)).`;
                  })
                }
              >
                {busy === "send" + k ? "A enviar…" : "Enviar agora"}
              </button>
            </div>
          </div>
        );
      })}

      <button className="btn" disabled={!!busy} onClick={() => run("save", async () => (await save(), "Configuração gravada."))}>
        {busy === "save" ? "A gravar…" : "Gravar"}
      </button>

      {preview && (
        <div
          onClick={() => setPreview(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(10,14,30,.55)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "min(960px, 100%)", maxHeight: "90vh", display: "flex", flexDirection: "column", margin: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 10 }}>
              <strong>{preview.subject}</strong>
              <button className="btn secondary" onClick={() => setPreview(null)}>
                Fechar
              </button>
            </div>
            <iframe title="Pré-visualização" srcDoc={preview.html} style={{ flex: 1, minHeight: 500, border: "1px solid #e4e6ed", borderRadius: 8 }} />
          </div>
        </div>
      )}
    </div>
  );
}
