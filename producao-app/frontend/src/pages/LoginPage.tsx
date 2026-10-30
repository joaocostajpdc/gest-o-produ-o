import { FormEvent, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { ApiError } from "../api/client";
import logoMark from "../assets/logo-mark.png";
import { CENTRAL_UI_KEY } from "./HomePage";

// Se a app redirecionou para aqui automaticamente por o token ter expirado
// (ver handleUnauthorized em api/client.ts), mostra um aviso claro em vez de
// deixar a pessoa sem perceber porque é que "de repente" foi para o login.
// Período de manutenção (23:00–07:00, só o administrador entra).
function wasMaintenance(): boolean {
  return new URLSearchParams(window.location.search).get("manutencao") === "1";
}

function wasSessionExpired(): boolean {
  return new URLSearchParams(window.location.search).get("sessao_expirada") === "1";
}

// Novo visual "Central Minho Ferragens" (pedido de 2026-10-20). Enquanto o
// ecrã inicial novo está em teste, o login novo só aparece nos computadores
// onde um administrador já entrou (marca em localStorage); depois de aprovado
// (GET /api/public/ui), aparece para todos.
function hasCentralFlag(): boolean {
  try {
    return localStorage.getItem(CENTRAL_UI_KEY) === "1";
  } catch {
    return false;
  }
}

const areas = [
  {
    title: "Produção",
    sub: "Ordens de serviço, corte e lacagem",
    icon: <path d="M3 21V10l5 3V10l5 3V10l5 3V4h3v17z" />,
  },
  {
    title: "Compras",
    sub: "Fornecedores, material e stock",
    icon: (
      <>
        <path d="M3 4h2l2.5 11h11L21 7H7" />
        <circle cx="9" cy="19.5" r="1.5" />
        <circle cx="17" cy="19.5" r="1.5" />
      </>
    ),
  },
  {
    title: "Orçamentação",
    sub: "Orçamentos a clientes",
    icon: (
      <>
        <rect x="5" y="2" width="14" height="20" rx="2" />
        <path d="M15 8.5a3 3 0 1 0 0 5M8.5 10h5M8.5 12.5h5M8 17h8" />
      </>
    ),
  },
];

// Relógio do ecrã de entrada (pedido do utilizador de 2026-10-30: "mete as
// horas"), sempre na hora de Lisboa, com a data por extenso e o estado da
// Central (aberta, ou em manutenção das 23:00 às 07:00).
const LISBON = "Europe/Lisbon";

function lisbonParts(d: Date) {
  const time = d.toLocaleTimeString("pt-PT", { timeZone: LISBON, hour: "2-digit", minute: "2-digit", hour12: false });
  const seconds = d.toLocaleTimeString("pt-PT", { timeZone: LISBON, second: "2-digit" }).padStart(2, "0");
  const date = d.toLocaleDateString("pt-PT", { timeZone: LISBON, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const hour = Number(d.toLocaleTimeString("pt-PT", { timeZone: LISBON, hour: "2-digit", hour12: false }));
  return { time, seconds: seconds.slice(-2), date: date.charAt(0).toUpperCase() + date.slice(1), hour };
}

function greeting(hour: number) {
  if (hour >= 6 && hour < 12) return "Bom dia";
  if (hour >= 12 && hour < 20) return "Boa tarde";
  return "Boa noite";
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function CentralClock() {
  const { time, seconds, date, hour } = lisbonParts(useNow());
  const open = hour >= 7 && hour < 23;
  return (
    <div className="cl-clock" aria-live="off">
      <div className="cl-clock-time">
        {time}
        <span className="cl-clock-sec">{seconds}</span>
      </div>
      <div className="cl-clock-date">{date}</div>
      <div className={`cl-status ${open ? "is-open" : "is-closed"}`}>
        <span className="cl-status-dot" />
        {open ? "Central disponível · 07:00 – 23:00" : "Manutenção · reabre às 07:00"}
      </div>
    </div>
  );
}

export function LoginPage() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sessionExpired] = useState(wasSessionExpired);
  const [maintenance] = useState(wasMaintenance);
  const [central, setCentral] = useState(hasCentralFlag);

  useEffect(() => {
    if (central) return;
    fetch("/api/public/ui")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.central && setCentral(true))
      .catch(() => undefined);
  }, [central]);

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível iniciar sessão.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!central) {
    return (
      <div className="login-page">
        <form className="login-card" onSubmit={handleSubmit}>
          <img src={logoMark} alt="Minho Ferragens" className="login-logo" />
          <h1>Gestão de Produção</h1>
          <p className="muted">Inicia sessão para aceder à aplicação.</p>

          {sessionExpired && <p className="error-text">A sua sessão expirou. Inicie sessão novamente.</p>}
          {maintenance && <p className="error-text">O programa está em manutenção das 23:00 às 07:00. Volte a entrar a partir das 07:00.</p>}

          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="password">Palavra-passe</label>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>

          {error && <p className="error-text">{error}</p>}

          <button className="btn" type="submit" disabled={submitting} style={{ width: "100%" }}>
            {submitting ? "A entrar..." : "Entrar"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="cl-page">
      <aside className="cl-side">
        <div className="cl-brand">
          <span className="cl-brand-logo">
            <img src={logoMark} alt="" />
          </span>
          <span className="cl-brand-text">
            <strong>Central</strong>
            <span>Minho Ferragens</span>
          </span>
        </div>

        <div className="cl-pitch">
          <CentralClock />
          <h1>Toda a operação da empresa num só lugar.</h1>
          <ul className="cl-areas">
            {areas.map((a) => (
              <li key={a.title}>
                <span className="cl-area-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {a.icon}
                  </svg>
                </span>
                <span>
                  <strong>{a.title}</strong>
                  <span>{a.sub}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="cl-legal">© {new Date().getFullYear()} JPDC - Mynhoferragens, Lda. · Ponte da Barca</p>
      </aside>

      <main className="cl-main">
        <form className="cl-form" onSubmit={handleSubmit}>
          <div className="cl-mobile-clock">
            <CentralClock />
          </div>
          <p className="cl-greet">{greeting(lisbonParts(new Date()).hour)}</p>
          <h2>Iniciar sessão</h2>
          <p className="cl-form-sub">Entra com a tua conta da empresa.</p>

          {sessionExpired && <p className="cl-alert">A sessão expirou. Inicia sessão novamente.</p>}
          {maintenance && <p className="cl-alert">O programa está em manutenção das 23:00 às 07:00. Volta a entrar a partir das 07:00.</p>}

          <div className="cl-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="nome@minhoferragens.pt"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="cl-field">
            <label htmlFor="password">Palavra-passe</label>
            <div className="cl-password">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="cl-eye"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Esconder palavra-passe" : "Mostrar palavra-passe"}
                aria-pressed={showPassword}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                  {showPassword && <path d="M4 4l16 16" />}
                </svg>
              </button>
            </div>
          </div>

          {error && (
            <p className="cl-alert" role="alert">
              {error}
            </p>
          )}

          <button className="cl-submit" type="submit" disabled={submitting}>
            {submitting ? "A entrar..." : "Entrar"}
          </button>

          <div className="cl-divider" />
          <p className="cl-help">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            Acesso reservado a colaboradores. Sem acesso ou esqueceste a palavra-passe? Fala com o administrador.
          </p>
        </form>
      </main>
    </div>
  );
}
