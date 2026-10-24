import { ReactNode, useEffect } from "react";
import { Link } from "react-router-dom";
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
  horas: <svg {...S}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  carrinha: <svg {...S}><path d="M2 17V7a1 1 0 0 1 1-1h11v11" /><path d="M14 9h4l4 4v4h-2" /><circle cx="7" cy="17.5" r="2" /><circle cx="17" cy="17.5" r="2" /><path d="M9 17.5h6" /></svg>,
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
  desc: string;
  icon: ReactNode;
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

const areaIcons = {
  producao: <svg {...S}><path d="M3 21V10l5 3V10l5 3V10l5 3V4h3v17z" /><path d="M7 17h2M12 17h2M17 17h1" /></svg>,
  compras: <svg {...S}><path d="M3 4h2l2.5 11h11L21 7H7" /><circle cx="9" cy="19.5" r="1.5" /><circle cx="17" cy="19.5" r="1.5" /></svg>,
  equipa: <svg {...S}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><circle cx="17" cy="9" r="2.5" /><path d="M16 14a5 5 0 0 1 6 5" /></svg>,
  financeiro: <svg {...S}><rect x="2.5" y="6" width="19" height="13" rx="2" /><path d="M2.5 10h19M6.5 15h4" /></svg>,
  orcamentacao: <svg {...S}><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M15 8.5a3 3 0 1 0 0 5M8.5 10h5M8.5 12.5h5M8 17h8" /></svg>,
};

export const CENTRAL_UI_KEY = "central_ui";

export function HomePage() {
  const { user, logout } = useAuth();
  const inicio = useFeature("inicio");
  const cutPlans = useFeature("cutPlans");
  const compras = useFeature("compras");
  const glassOrders = useFeature("glassOrders");
  const powderStock = useFeature("powderStock");
  const orcamentos = useFeature("orcamentos");
  const horas = useFeature("horas");
  const kmViaturas = useFeature("kmViaturas");
  const financeiro = useFeature("financeiro");

  const areas: Area[] = [
    {
      key: "producao",
      title: "Produção",
      desc: "Ordens de serviço, corte e lacagem",
      icon: areaIcons.producao,
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
      desc: "Fornecedores, material e stock",
      icon: areaIcons.compras,
      color: "#c2410c",
      soft: "#fdeee5",
      tiles: [
        ...(compras.available ? [{ to: "/compras", title: "Resumo de Compras", sub: "Tudo o que está por pedir", icon: icons.compras }] : []),
        { to: "/material-a-pedir", title: "Material a Pedir", sub: "Pedidos a fornecedores", icon: icons.pedir },
        ...(glassOrders.available ? [{ to: "/pedidos-vidros", title: "Pedidos de Vidros", sub: "Encomendados e a receber", icon: icons.vidros }] : []),
        ...(powderStock.available ? [{ to: "/po-em-stock", title: "Pó em Stock", sub: "Tintas em pó por RAL e local", icon: icons.po }] : []),
      ],
    },
  ];
  if (horas.available || kmViaturas.available) {
    areas.push({
      key: "equipa",
      title: "Equipa e Frota",
      desc: "Horas dos colaboradores e carrinhas",
      icon: areaIcons.equipa,
      color: "#6d28d9",
      soft: "#f1ebff",
      tiles: [
        ...(horas.available ? [{ to: "/controlo-horas", title: "Controlo de Horas", sub: "Entradas, saídas, extras e ausências", icon: icons.horas }] : []),
        ...(kmViaturas.available ? [{ to: "/km-carrinhas", title: "Km das Carrinhas", sub: "Resumos por carrinha e por condutor", icon: icons.carrinha }] : []),
      ],
    });
  }
  if (orcamentos.available) {
    areas.push({
      key: "orcamentacao",
      title: "Orçamentação",
      desc: "Orçamentos a clientes",
      icon: areaIcons.orcamentacao,
      color: "#047857",
      soft: "#e3f5ee",
      tiles: [
        {
          to: "/orcamentos",
          title: "Orçamentos",
          sub: "Painéis e chapas quinadas",
          icon: icons.orcamentos,
        },
      ],
    });
  }

  if (financeiro.available && user?.role === "ADMINISTRADOR") {
    areas.push({
      key: "financeiro",
      title: "Financeiro",
      desc: "Só para o administrador",
      icon: areaIcons.financeiro,
      color: "#0f766e",
      soft: "#e0f2f1",
      tiles: [
        {
          to: "/financeiro",
          title: "Cheques passados",
          sub: "O que vai sair do banco e quando",
          icon: areaIcons.financeiro,
          badge: <span className="home-lock" title="Só tu vês">{icons.lock} Só tu</span>,
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

  // Lembra neste computador que já há acesso ao novo visual, para o ecrã de
  // entrada também aparecer novo aqui enquanto está em teste.
  useEffect(() => {
    try {
      localStorage.setItem(CENTRAL_UI_KEY, "1");
    } catch {
      /* sem armazenamento: não faz mal */
    }
  }, []);

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
          <p className="home-date">{today()}</p>
          <h1>
            {greeting()}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="home-company">Escolhe a área em que vais trabalhar.</p>
        </section>
      </div>

      <div className="home-body">
        {!inicio.released && (
          <div style={{ marginBottom: 24 }}>
            <FeatureTestBanner featureKey="inicio" label="o novo ecrã inicial" />
          </div>
        )}

        <div className="home-areas">
          {areas.map((area) => (
            <section
              key={area.key}
              className="home-panel"
              aria-labelledby={`area-${area.key}`}
              style={{ ["--accent" as string]: area.color, ["--accent-soft" as string]: area.soft }}
            >
              <div className="home-panel-head">
                <span className="home-panel-icon">{area.icon}</span>
                <div className="home-panel-title">
                  <h2 id={`area-${area.key}`}>{area.title}</h2>
                  <p>{area.desc}</p>
                </div>
              </div>
              <nav className="home-panel-links" aria-label={area.title}>
                {area.tiles.map((t) => (
                  <Link key={t.to} to={t.to} className="home-link">
                    <span className="home-link-icon">{t.icon}</span>
                    <span className="home-link-text">
                      <span className="home-link-title">
                        {t.title}
                        {t.badge}
                      </span>
                      <span className="home-link-sub">{t.sub}</span>
                    </span>
                    <span className="home-link-arrow">{icons.arrow}</span>
                  </Link>
                ))}
              </nav>
            </section>
          ))}
        </div>

        {config.length > 0 && (
          <section className="home-config-wrap" aria-labelledby="area-config">
            <h2 id="area-config">Configuração</h2>
            <div className="home-config">
              {config.map((c) => (
                <Link key={c.to} to={c.to} className="home-chip">
                  {c.label}
                </Link>
              ))}
            </div>
          </section>
        )}

        <footer className="home-foot">Central Minho Ferragens · JPDC - Mynhoferragens, Lda.</footer>
      </div>
    </div>
  );
}
