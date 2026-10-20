import { ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { canManageConfig, canManageUsers, useAuth } from "../contexts/AuthContext";
import { useFeature } from "../contexts/FeaturesContext";
import { FeatureTestBanner } from "../components/FeatureTestBanner";
import logoMark from "../assets/logo-mark.png";

// ============================================================================
// Ecrã inicial "Central Minho Ferragens" — pedido do utilizador de 2026-10-20.
// Ecrã de entrada sem menu lateral (o menu só aparece depois de entrar numa
// área), com barra superior própria, resumo das ordens e mosaicos agrupados
// por área: Produção, Compras e Orçamentação. Fica em teste só para o
// administrador até ser aprovado (feature "inicio").
// ============================================================================

const S = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const icons = {
  os: <svg {...S}><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3" /></svg>,
  scan: <svg {...S}><path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3" /><path d="M7 12h10" /></svg>,
  cut: <svg {...S}><rect x="3" y="5" width="18" height="14" rx="1" /><path d="M3 12h18M10 5v7M15 12v7" strokeDasharray="2.5 2" /></svg>,
  lacagem: <svg {...S}><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" /></svg>,
  listagens: <svg {...S}><path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M6 14h12v7H6z" /></svg>,
  compras: <svg {...S}><path d="M6 7h12l-1 13H7z" /><path d="M9 7a3 3 0 0 1 6 0" /></svg>,
  pedir: <svg {...S}><path d="M3 4h2l2.5 11h11L21 7H7" /><circle cx="9" cy="19.5" r="1.5" /><circle cx="17" cy="19.5" r="1.5" /></svg>,
  vidros: <svg {...S}><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M9 3v18M15 3v18" /></svg>,
  po: <svg {...S}><path d="M5 7h14l-1.5 12.5a1.5 1.5 0 0 1-1.5 1.5H8a1.5 1.5 0 0 1-1.5-1.5L5 7Z" /><ellipse cx="12" cy="7" rx="7" ry="2.5" /></svg>,
  orcamentos: <svg {...S}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>,
  lock: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>,
  arrow: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  logout: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" /></svg>,
};

interface Tile {
  to: string;
  title: string;
  sub: string;
  icon: ReactNode;
  badge?: ReactNode;
}

interface Area {
  key: string;
  title: string;
  color: string;
  soft: string;
  tiles: Tile[];
}

function initials(name?: string) {
  if (!name) return "?";
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

function greeting() {
  const h = new Date().getHours();
  if (h < 13) return "Bom dia";
  if (h < 20) return "Boa tarde";
  return "Boa noite";
}

const today = () =>
  new Date().toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export function HomePage() {
  const { user, logout } = useAuth();
  const inicio = useFeature("inicio");
  const cutPlans = useFeature("cutPlans");
  const compras = useFeature("compras");
  const glassOrders = useFeature("glassOrders");
  const powderStock = useFeature("powderStock");
  const orcamentos = useFeature("orcamentos");
  const [counts, setCounts] = useState<{ total: number; producao: number; espera: number; suspensas: number } | null>(null);

  useEffect(() => {
    api
      .get<{ status: string }[]>("/service-orders")
      .then((list) => {
        const n = (s: string) => list.filter((o) => o.status === s).length;
        const espera = n("NAO_INICIADA");
        const producao = n("EM_PRODUCAO");
        const suspensas = n("SUSPENSA");
        setCounts({ total: espera + producao + suspensas, producao, espera, suspensas });
      })
      .catch(() => setCounts(null));
  }, []);

  const areas: Area[] = [
    {
      key: "producao",
      title: "Produção",
      color: "#1d4ed8",
      soft: "#e8eeff",
      tiles: [
        { to: "/ordens-servico", title: "Ordens de Serviço", sub: "Lançar OS, prioridades e prazos", icon: icons.os },
        { to: "/scan", title: "Ler Código", sub: "Entradas e saídas por código", icon: icons.scan },
        ...(cutPlans.available ? [{ to: "/otimizacao-corte", title: "Planos de Corte", sub: "Mosquiteiras, chapas e perfis", icon: icons.cut }] : []),
        { to: "/material-lacagem", title: "Material em Lacagem", sub: "O que está fora a lacar", icon: icons.lacagem },
        { to: "/reports", title: "Listagens", sub: "Listas para imprimir", icon: icons.listagens },
      ],
    },
    {
      key: "compras",
      title: "Compras",
      color: "#c2410c",
      soft: "#fdeee5",
      tiles: [
        ...(compras.available ? [{ to: "/compras", title: "Resumo de Compras", sub: "Tudo o que está por pedir", icon: icons.compras }] : []),
        { to: "/material-a-pedir", title: "Material a Pedir", sub: "Pedidos a fornecedores", icon: icons.pedir },
        ...(glassOrders.available ? [{ to: "/pedidos-vidros", title: "Pedidos de Vidros", sub: "Vidros encomendados e a receber", icon: icons.vidros }] : []),
        ...(powderStock.available ? [{ to: "/po-em-stock", title: "Pó em Stock", sub: "Tintas em pó por RAL e local", icon: icons.po }] : []),
      ],
    },
  ];
  if (orcamentos.available) {
    areas.push({
      key: "orcamentacao",
      title: "Orçamentação",
      color: "#047857",
      soft: "#e3f5ee",
      tiles: [
        {
          to: "/orcamentos",
          title: "Orçamentos",
          sub: "Painéis e chapas quinadas",
          icon: icons.orcamentos,
          badge: <span className="home-lock" title="Acesso restrito">{icons.lock} Restrito</span>,
        },
      ],
    });
  }

  const config: { to: string; label: string }[] = [];
  if (canManageConfig(user?.role)) {
    config.push(
      { to: "/products", label: "Produtos" },
      { to: "/stages", label: "Etapas" },
      { to: "/production-lines", label: "Linhas de Produção" },
      { to: "/suppliers", label: "Fornecedores" }
    );
  }
  if (canManageUsers(user?.role)) {
    config.push({ to: "/users", label: "Utilizadores e Permissões" }, { to: "/avisos-telegram", label: "Avisos Telegram" });
  }

  const firstName = user?.name?.split(" ")[0];

  const kpis = [
    { label: "Ordens em curso", value: counts?.total, tone: "#4f6bff" },
    { label: "Em produção", value: counts?.producao, tone: "#16a34a" },
    { label: "Por iniciar", value: counts?.espera, tone: "#94a3b8" },
    { label: "Suspensas", value: counts?.suspensas, tone: "#f59e0b" },
  ];

  return (
    <div className="home">
      <div className="home-band">
        <header className="home-topbar">
          <div className="home-brand">
            <span className="home-brand-logo">
              <img src={logoMark} alt="" />
            </span>
            <span className="home-brand-text">
              <strong>Central</strong>
              <span>Minho Ferragens</span>
            </span>
          </div>
          <div className="home-user">
            <span className="home-avatar" aria-hidden="true">{initials(user?.name)}</span>
            <span className="home-user-text">
              <strong>{user?.name}</strong>
              <span>{user?.role}</span>
            </span>
            <button type="button" className="home-logout" onClick={logout} aria-label="Terminar sessão" title="Terminar sessão">
              {icons.logout}
            </button>
          </div>
        </header>

        <section className="home-hero">
          <div className="home-hero-text">
            <p className="home-date">{today()}</p>
            <h1>
              {greeting()}
              {firstName ? `, ${firstName}` : ""}
            </h1>
            <p className="home-company">JPDC - Mynhoferragens, Lda. · Produção, compras e orçamentação</p>
          </div>
          <div className="home-actions">
            <Link to="/ordens-servico" className="home-action primary">
              {icons.os} Ordens de Serviço
            </Link>
            <Link to="/scan" className="home-action">
              {icons.scan} Ler Código
            </Link>
          </div>
        </section>

        <div className="home-kpis">
          {kpis.map((k) => (
            <Link key={k.label} to="/ordens-servico" className="home-kpi">
              <span className="home-kpi-label">
                <span className="home-kpi-dot" style={{ background: k.tone }} />
                {k.label}
              </span>
              <span className="home-kpi-value">{k.value ?? "—"}</span>
            </Link>
          ))}
        </div>
      </div>

      <div className="home-body">
        {!inicio.released && (
          <div style={{ marginBottom: 24 }}>
            <FeatureTestBanner featureKey="inicio" label="o novo ecrã inicial" />
          </div>
        )}

        {areas.map((area) => (
          <section key={area.key} className="home-area" aria-labelledby={`area-${area.key}`}>
            <div className="home-area-head">
              <h2 id={`area-${area.key}`}>{area.title}</h2>
              <span className="home-area-count">
                {area.tiles.length} {area.tiles.length === 1 ? "módulo" : "módulos"}
              </span>
            </div>
            <div className="home-grid">
              {area.tiles.map((t) => (
                <Link
                  key={t.to}
                  to={t.to}
                  className="home-card"
                  style={{ ["--accent" as string]: area.color, ["--accent-soft" as string]: area.soft }}
                >
                  <span className="home-card-icon">{t.icon}</span>
                  <span className="home-card-text">
                    <span className="home-card-title">
                      {t.title}
                      {t.badge}
                    </span>
                    <span className="home-card-sub">{t.sub}</span>
                  </span>
                  <span className="home-card-arrow">{icons.arrow}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}

        {config.length > 0 && (
          <section className="home-area" aria-labelledby="area-config">
            <div className="home-area-head">
              <h2 id="area-config">Configuração</h2>
            </div>
            <div className="home-config">
              {config.map((c) => (
                <Link key={c.to} to={c.to} className="home-chip">
                  {c.label}
                </Link>
              ))}
            </div>
          </section>
        )}

        <footer className="home-foot">Central Minho Ferragens</footer>
      </div>
    </div>
  );
}
