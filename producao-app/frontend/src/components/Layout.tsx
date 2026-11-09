import { Fragment, ReactNode, SVGProps, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { canManageConfig, canManageUsers, useAuth } from "../contexts/AuthContext";
import { useFeature } from "../contexts/FeaturesContext";
import { ScanOrderHost } from "./ScanOrderPopup";
import { api } from "../api/client";
import { FeatureTestBanner } from "./FeatureTestBanner";
import { pedirFiltroOS } from "./osFilter";
import { lembrarOsAberta } from "../pages/HomePage";
import { TabsProvider } from "../contexts/TabsContext";
import { TabPanes, TabStrip } from "./TabStrip";
import logoMark from "../assets/logo-mark.png";
import {
  IconBox,
  IconClipboard,
  IconClose,
  IconDroplet,
  IconLayers,
  IconLogout,
  IconMenu,
  IconPrinter,
  IconRoute,
  IconShoppingCart,
  IconTruck,
  IconUsers,
} from "./icons";

// Ícone do "Ler Código" definido aqui em vez de em icons.tsx, para não ser
// preciso mexer em mais um ficheiro só para um ícone novo.
function IconScan(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3" />
      <path d="M7 12h10" />
    </svg>
  );
}

// Ícone do "Pó em Stock" (lata/balde de tinta) — também aqui, pelo mesmo
// motivo do ícone acima.
function IconPaintBucket(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M5 7h14l-1.5 12.5a1.5 1.5 0 0 1-1.5 1.5H8a1.5 1.5 0 0 1-1.5-1.5L5 7Z" />
      <ellipse cx="12" cy="7" rx="7" ry="2.5" />
      <path d="M9 12h6" />
    </svg>
  );
}

// Ícone dos "Pedidos de Vidros" (vidro duplo com caixa de ar).
function IconGlass(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M9 3v18M15 3v18" />
      <path d="M17.5 7l-1.5 1.5" />
    </svg>
  );
}

// Ícone do "Resumo de Compras" (saco de compras).
function IconCart(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M6 7h12l-1 13H7z" />
      <path d="M9 7a3 3 0 0 1 6 0" />
    </svg>
  );
}

// Ícone dos "Orçamentos" (folha com linhas e €).
function IconFileText(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}

// Ícone da "Otimização de Corte" (chapa com linhas de corte).
function IconCut(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="3" y="5" width="18" height="14" rx="1" />
      <path d="M3 12h18M10 5v7M15 12v7" strokeDasharray="2.5 2" />
    </svg>
  );
}

// Ícone dos "Avisos Telegram" (avião de papel).
function IconKey(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="8" cy="15" r="4" />
      <path d="M10.8 12.2 20 3M16 7l3 3M14 9l2 2" />
    </svg>
  );
}

function IconSend(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M21 3 3 10.5l7 2.5 2.5 7L21 3Z" />
      <path d="m10 13 4.5-4.5" />
    </svg>
  );
}

// Objetivos (2026-10-30).
function IconTarget(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" />
    </svg>
  );
}

// Ícones da "Equipa e Frota" (relógio e carrinha).
function IconCalendar(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4M7.5 14h3M13.5 14h3M7.5 17h3" />
    </svg>
  );
}

function IconClock(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function IconVan(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M2 17V7a1 1 0 0 1 1-1h11v11" />
      <path d="M14 9h4l4 4v4h-2" />
      <circle cx="7" cy="17.5" r="2" />
      <circle cx="17" cy="17.5" r="2" />
      <path d="M9 17.5h6" />
    </svg>
  );
}

function IconWallet(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="2.5" y="6" width="19" height="13" rx="2" />
      <path d="M2.5 10h19M6.5 15h4" />
    </svg>
  );
}

// Ícone do "Chat" (balão de conversa).
function IconChart(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 3v18h18" />
      <path d="M7 15v2M11 11v6M15 8v9M19 5v12" />
    </svg>
  );
}

function IconChat(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 12a8 8 0 0 1-11.7 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
    </svg>
  );
}

// Ícone do "Início" (casa).
function IconHome(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 11 12 4l9 7" />
      <path d="M5 10v10h14V10M10 20v-6h4v6" />
    </svg>
  );
}

// Marca "Teste" ao lado de uma aba ainda não aprovada pelo administrador.
function TestBadge() {
  return (
    <span
      className="badge"
      style={{ background: "#d97706", marginLeft: "auto", fontSize: 10, padding: "1px 6px" }}
      title="Só visível para administradores até ser aprovado"
    >
      Teste
    </span>
  );
}

function initials(name?: string) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

// ============================================================================
// Menu lateral arrumado (pedido do utilizador de 2026-11-09: "melhora este
// layout") — em teste: "menuNovo". Cada secção abre e fecha ao clicar no
// título; a escolha fica guardada neste computador. A secção da página
// aberta fica sempre aberta. Sem a funcionalidade, o menu fica como antes.
// ============================================================================
const MENU_KEY = "menu.secoesFechadas";
function readClosed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(MENU_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function NavSection({
  id,
  title,
  novo,
  first,
  children,
}: {
  id: string;
  title: string;
  novo: boolean;
  first?: boolean;
  children: ReactNode;
}) {
  const [closed, setClosed] = useState(() => readClosed().includes(id));
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const [hasActive, setHasActive] = useState(false);
  useEffect(() => {
    setHasActive(!!ref.current?.querySelector("a.active"));
  }, [location.pathname]);
  if (!novo) {
    return (
      <>
        <div className="section-label" style={first ? { marginTop: 4 } : undefined}>
          {title}
        </div>
        {children}
      </>
    );
  }
  const open = !closed || hasActive;
  function toggle() {
    const next = !closed;
    setClosed(next);
    try {
      const list = readClosed().filter((x) => x !== id);
      if (next) list.push(id);
      localStorage.setItem(MENU_KEY, JSON.stringify(list));
    } catch {
      /* sem armazenamento: só não fica lembrado */
    }
  }
  return (
    <div className={`nav-sec${open ? "" : " closed"}`} ref={ref}>
      <button type="button" className="nav-sec-head section-label" onClick={toggle} aria-expanded={open}>
        <span>{title}</span>
        <svg className="nav-sec-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div className="nav-sec-items">{children}</div>
    </div>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  // Pó em Stock: enquanto não for aprovado pelo administrador, só aparece
  // no menu dos administradores, com a marca "Teste" (ver FeaturesContext).
  const powderStock = useFeature("powderStock");
  const glassOrders = useFeature("glassOrders");
  const cutPlans = useFeature("cutPlans");
  const planeamento = useFeature("planeamento");
  const objetivos = useFeature("objetivos");
  // Orçamentos: acesso restrito (João Costa e David Costa), nunca para todos.
  const orcamentos = useFeature("orcamentos");
  const compras = useFeature("compras");
  // Ecrã inicial "Central Minho Ferragens" (em teste só para o administrador):
  // quem o tem vê o novo nome e uma entrada "Início"; as OS passam para
  // /ordens-servico. Os restantes continuam exatamente como estavam.
  const inicio = useFeature("inicio");
  const horas = useFeature("horas");
  const kmViaturas = useFeature("kmViaturas");
  const financeiro = useFeature("financeiro");
  const relatorios = useFeature("relatorios");
  // Chat interno (2026-10-24): contador de mensagens por ler no menu.
  const chat = useFeature("chat");
  const [chatUnread, setChatUnread] = useState(0);
  useEffect(() => {
    if (!chat.available) return;
    const load = () => api.get<{ total: number }>("/chat/unread").then((r) => setChatUnread(r.total)).catch(() => undefined);
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [chat.available]);
  // Menu lateral recolhido (só ícones) que abre ao passar o rato — pedido do
  // utilizador de 2026-10-20 ("esta barra só quero que apareça quando passo
  // o rato"). Em teste só para o administrador; só em ecrã de computador.
  const menuHover = useFeature("menuHover");
  const menuNovo = useFeature("menuNovo").available;
  // Abas como no browser + Início só com os ícones das áreas (2026-10-25).
  // Em teste só para o administrador até ser aprovado.
  const abas = useFeature("abas");
  const appName = inicio.available ? "Central Minho Ferragens" : "Gestão de Produção";
  // Em telemóvel/tablet o menu lateral fica escondido por omissão (vira uma
  // gaveta deslizante aberta pela barra superior); em ecrã de computador o
  // CSS ignora esta flag e o menu está sempre visível.
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Fecha a gaveta sempre que se navega para outra página.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);
  // Início novo: "Abertas recentemente" (2026-11-09).
  useEffect(() => {
    const m = location.pathname.match(/^\/service-orders\/([^/]+)$/);
    if (m) lembrarOsAberta(m[1]);
  }, [location.pathname]);

  // Dentro de um separador da área de trabalho (iframe do próprio programa):
  // só a página, sem menu lateral nem barra do telemóvel (2026-10-24).
  if (typeof window !== "undefined" && window.self !== window.top) {
    return (
      <main className="main-content main-embed">
        <Outlet />
      </main>
    );
  }

  const isHome = inicio.available && location.pathname === "/";

  // Ecrã inicial: sem menu lateral nem barra do telemóvel; o menu só aparece
  // depois de entrar numa área (pedido do utilizador de 2026-10-20).
  if (isHome && !abas.available) {
    return (
      <>
        <Outlet />
        <ScanOrderHost />
      </>
    );
  }

  const sidebarParts = (
    <>
      <header className="mobile-topbar">
        <button
          className="mobile-menu-btn"
          onClick={() => setMenuOpen(true)}
          aria-label="Abrir menu"
        >
          <IconMenu />
        </button>
        <img src={logoMark} alt="Minho Ferragens" className="mobile-topbar-logo" />
        <span className="mobile-topbar-title">{appName}</span>
      </header>

      {menuOpen && <div className="sidebar-overlay" onClick={() => setMenuOpen(false)} />}

      {menuNovo ? (
        <aside className={`sidebar sd2${menuOpen ? " open" : ""}`}>
          <SidebarD2
            f={{ inicio, objetivos, chat, planeamento, cutPlans, compras, glassOrders, powderStock, horas, kmViaturas, orcamentos, relatorios, financeiro }}
            chatUnread={chatUnread}
            userName={user?.name}
            onLogout={logout}
            canConfig={canManageConfig(user?.role)}
            canUsers={canManageUsers(user?.role)}
            onClose={() => setMenuOpen(false)}
          />
        </aside>
      ) : (
      <aside className={`sidebar${menuOpen ? " open" : ""}`}>
        <div className="sidebar-brand">
          <div className="sidebar-logo">
            <img src={logoMark} alt="Minho Ferragens" />
          </div>
          <div className="sidebar-brand-text">
            <div className="sidebar-brand-name">{inicio.available ? "Central" : "Minho Ferragens"}</div>
            <div className="sidebar-brand-sub">{inicio.available ? "Minho Ferragens" : "Gestão de Produção"}</div>
          </div>
          <button
            className="sidebar-close-btn"
            onClick={() => setMenuOpen(false)}
            aria-label="Fechar menu"
          >
            <IconClose />
          </button>
        </div>

        <nav>
          {/* Menu separado por áreas (pedido do utilizador de 2026-10-20:
              "separa o que é gestão de produção e orçamentação" e "cria uma
              aba para compras"). */}
          {inicio.available && (
            <NavLink to="/" end>
              <IconHome /> Início
              {!inicio.released && <TestBadge />}
            </NavLink>
          )}
          {objetivos.available && (
            <NavLink to="/objetivos">
              <IconTarget /> Objetivos
              {!objetivos.released && <TestBadge />}
            </NavLink>
          )}
          {chat.available && (
            <NavLink to="/chat">
              <IconChat /> Chat
              {chatUnread > 0 && <span className="badge" style={{ marginLeft: "auto", background: "#dc2626", fontSize: 10.5, padding: "1px 7px" }}>{chatUnread}</span>}
              {!chat.released && <TestBadge />}
            </NavLink>
          )}
          <NavSection id="producao" title="Produção" novo={false} first>
          <NavLink to={inicio.available ? "/ordens-servico" : "/"} end>
            <IconClipboard /> Ordens de Serviço
          </NavLink>
          <NavLink to="/scan">
            <IconScan /> Ler Código
          </NavLink>
          {planeamento.available && (
            <NavLink to="/planeamento">
              <IconCalendar /> Planeamento Semanal
              {!planeamento.released && <TestBadge />}
            </NavLink>
          )}
          <NavLink to="/material-lacagem">
            <IconDroplet /> Material em Lacagem
          </NavLink>
          {cutPlans.available && (
            <NavLink to="/otimizacao-corte">
              <IconCut /> Otimização de Corte
              {!cutPlans.released && <TestBadge />}
            </NavLink>
          )}
          <NavLink to="/reports">
            <IconPrinter /> Listagens Imprimíveis
          </NavLink>
          </NavSection>

          <NavSection id="compras" title="Compras" novo={false}>
          {compras.available && (
            <NavLink to="/compras" end>
              <IconCart /> Resumo de Compras
              {!compras.released && <TestBadge />}
            </NavLink>
          )}
          <NavLink to="/material-a-pedir">
            <IconShoppingCart /> Material a Pedir
          </NavLink>
          {glassOrders.available && (
            <NavLink to="/pedidos-vidros">
              <IconGlass /> Pedidos de Vidros
              {!glassOrders.released && <TestBadge />}
            </NavLink>
          )}
          {powderStock.available && (
            <NavLink to="/po-em-stock">
              <IconPaintBucket /> Pó em Stock
              {!powderStock.released && <TestBadge />}
            </NavLink>
          )}
          </NavSection>

          {(horas.available || kmViaturas.available) && (
            <NavSection id="equipa" title="Equipa e Frota" novo={false}>
              {horas.available && (
                <NavLink to="/controlo-horas">
                  <IconClock /> Controlo de Horas
                  {!horas.released && <TestBadge />}
                </NavLink>
              )}
              {kmViaturas.available && (
                <NavLink to="/km-carrinhas">
                  <IconVan /> Km das Carrinhas
                  {!kmViaturas.released && <TestBadge />}
                </NavLink>
              )}
            </NavSection>
          )}

          {orcamentos.available && (
            <NavSection id="orcamentacao" title="Orçamentação" novo={false}>
              <NavLink to="/orcamentos">
                <IconFileText /> Orçamentos
              </NavLink>
            </NavSection>
          )}

          {relatorios.available && (
            <NavSection id="gestao" title="Gestão" novo={false}>
              <NavLink to="/relatorios">
                <IconChart /> Relatório de Produção
              </NavLink>
            </NavSection>
          )}

          {financeiro.available && (
            <NavSection id="financeiro" title="Financeiro" novo={false}>
              <NavLink to="/financeiro">
                <IconWallet /> Cheques passados
              </NavLink>
            </NavSection>
          )}

          {canManageConfig(user?.role) && (
            <NavSection id="configuracao" title="Configuração" novo={false}>
              <NavLink to="/products">
                <IconBox /> Produtos
              </NavLink>
              <NavLink to="/stages">
                <IconLayers /> Etapas
              </NavLink>
              <NavLink to="/production-lines">
                <IconRoute /> Linhas de Produção
              </NavLink>
              <NavLink to="/suppliers">
                <IconTruck /> Fornecedores
              </NavLink>
            </NavSection>
          )}

          {canManageUsers(user?.role) && (
            <NavSection id="administracao" title="Administração" novo={false}>
              <NavLink to="/users">
                <IconUsers /> Utilizadores e Permissões
              </NavLink>
              <NavLink to="/acessos">
                <IconKey /> Acessos
              </NavLink>
              <NavLink to="/avisos-telegram">
                <IconSend /> Avisos Telegram
              </NavLink>
              <NavLink to="/emails-automaticos">
                <IconSend /> Avisos Semanais
              </NavLink>
            </NavSection>
          )}
        </nav>

        <div className="user-box">
          <div className="avatar">{initials(user?.name)}</div>
          <div className="user-box-text">
            <div className="name">{user?.name}</div>
            <div className="role">{user?.role}</div>
          </div>
          <button onClick={logout} title="Terminar sessão">
            <IconLogout />
          </button>
        </div>
      </aside>
      )}
    </>
  );

  const menuHoverBanner = menuHover.available && !menuHover.released && location.pathname === "/ordens-servico" && (
    <FeatureTestBanner featureKey="menuHover" label="o menu lateral que abre ao passar o rato" />
  );

  // Com abas: barra de abas em cima e, por baixo, todas as abas abertas
  // (cada uma com a sua página). O Início continua sem menu lateral.
  if (abas.available) {
    return (
      <TabsProvider>
        <div className="tabs-mode">
          <TabStrip />
          <div className={`app-shell${menuHover.available && !menuNovo ? " sb-hover" : ""}${isHome ? " tabs-home" : ""}`}>
            {!isHome && sidebarParts}
            <main className={isHome ? "tabs-home-main" : "main-content"}>
              {!isHome && menuHoverBanner}
              <TabPanes />
            </main>
          </div>
        </div>
      </TabsProvider>
    );
  }

  return (
    <div className={`app-shell${menuHover.available && !menuNovo ? " sb-hover" : ""}`}>
      {sidebarParts}
      <main className="main-content">
        {menuHoverBanner}
        <Outlet />
      </main>
      <ScanOrderHost />
    </div>
  );
}

// ============================================================================
// Menu novo "D2" (pedido do utilizador de 2026-11-09: proposta mistura da B e
// da C, versão com a barra de áreas escura) — em teste: "menuNovo".
// À esquerda, uma barra escura só com as grandes áreas; ao lado, as páginas
// da área escolhida, em claro, com pesquisa (Ctrl K), atalhos ★ guardados
// neste computador, contadores e uma parte "Atenção" (prazo ultrapassado e
// urgentes). Sem a funcionalidade, o menu fica como antes.
// ============================================================================

interface D2Page {
  to: string;
  label: string;
  icon: (p: SVGProps<SVGSVGElement>) => JSX.Element;
  group?: string;
  count?: number;
  warn?: boolean;
  end?: boolean;
  onClick?: () => void;
  key?: string;
}
interface D2Area {
  id: string;
  label: string;
  short: string;
  sub: string;
  icon: (p: SVGProps<SVGSVGElement>) => JSX.Element;
  pages: D2Page[];
  dot?: boolean;
}

function IconFactory(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 21V10l5 3V10l5 3V10l5 3V4h3v17z" />
    </svg>
  );
}
function IconGear(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </svg>
  );
}
function IconSearch(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
function IconTeam(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6" />
    </svg>
  );
}

const FAV_KEY = "menu.favoritos";
function readFavs(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

interface OsLite {
  id: string;
  externalId: string;
  status: string;
  priority: string | null;
  client?: { name: string };
  currentStage?: { name: string } | null;
}

function SidebarD2({
  f,
  chatUnread,
  userName,
  onLogout,
  canConfig,
  canUsers,
  onClose,
}: {
  f: Record<string, { available: boolean }>;
  chatUnread: number;
  userName?: string;
  onLogout: () => void;
  canConfig: boolean;
  canUsers: boolean;
  onClose: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<OsLite[]>([]);
  const [vidrosPorEncomendar, setVidros] = useState(0);
  const [favs, setFavs] = useState<string[]>(readFavs);
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Contadores: lidos ao abrir e de 2 em 2 minutos.
  useEffect(() => {
    let alive = true;
    const load = () => {
      api
        .get<OsLite[]>("/service-orders")
        .then((r) => alive && setOrders(r))
        .catch(() => undefined);
      if (f.glassOrders?.available)
        api
          .get<{ status: string }[]>("/glass-orders")
          .then((r) => alive && setVidros(r.filter((g) => g.status === "POR_ENCOMENDAR").length))
          .catch(() => undefined);
    };
    load();
    const t = setInterval(load, 120000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [f.glassOrders?.available]);

  // Ctrl K / ⌘ K abre a pesquisa.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ativas = orders.filter((o) => o.status === "NAO_INICIADA" || o.status === "EM_PRODUCAO" || o.status === "SUSPENSA");
  const nLacagem = ativas.filter((o) => o.currentStage?.name === "Lacagem").length;
  const nPrazo = ativas.filter((o) => o.priority === "PRAZO_ULTRAPASSADO").length;
  const nUrg = ativas.filter((o) => o.priority === "URGENTE").length;
  const osPath = f.inicio?.available ? "/ordens-servico" : "/";

  const areas: D2Area[] = [
    {
      id: "producao",
      label: "Produção",
      short: "Produção",
      sub: "Ordens, planeamento, lacagem e corte",
      icon: IconFactory,
      dot: nPrazo > 0,
      pages: [
        { to: osPath, label: "Ordens de Serviço", icon: IconClipboard, count: ativas.length || undefined, end: true },
        { to: "/scan", label: "Ler Código", icon: IconScan },
        ...(f.planeamento?.available ? [{ to: "/planeamento", label: "Planeamento Semanal", icon: IconCalendar }] : []),
        { to: "/material-lacagem", label: "Material em Lacagem", icon: IconDroplet, count: nLacagem || undefined },
        ...(f.cutPlans?.available ? [{ to: "/otimizacao-corte", label: "Otimização de Corte", icon: IconCut }] : []),
        { to: "/reports", label: "Listagens Imprimíveis", icon: IconPrinter, group: "Listagens" },
        ...(nPrazo || nUrg
          ? [
              ...(nPrazo
                ? [{ key: "att-prazo", to: osPath, label: "Prazo ultrapassado", icon: IconClock, group: "Atenção", count: nPrazo, warn: true, onClick: () => pedirFiltroOS("PRAZO_ULTRAPASSADO") }]
                : []),
              ...(nUrg
                ? [{ key: "att-urg", to: osPath, label: "Urgentes", icon: IconTarget, group: "Atenção", count: nUrg, warn: true, onClick: () => pedirFiltroOS("URGENTE") }]
                : []),
            ]
          : []),
      ],
    },
    {
      id: "compras",
      label: "Compras",
      short: "Compras",
      sub: "Material, vidros e pó",
      icon: IconCart,
      pages: [
        ...(f.compras?.available ? [{ to: "/compras", label: "Resumo de Compras", icon: IconCart, end: true }] : []),
        { to: "/material-a-pedir", label: "Material a Pedir", icon: IconShoppingCart },
        ...(f.glassOrders?.available ? [{ to: "/pedidos-vidros", label: "Pedidos de Vidros", icon: IconGlass, count: vidrosPorEncomendar || undefined }] : []),
        ...(f.powderStock?.available ? [{ to: "/po-em-stock", label: "Pó em Stock", icon: IconPaintBucket }] : []),
      ],
    },
    ...(f.horas?.available || f.kmViaturas?.available
      ? [
          {
            id: "equipa",
            label: "Equipa e Frota",
            short: "Equipa",
            sub: "Horas dos colaboradores e carrinhas",
            icon: IconTeam,
            pages: [
              ...(f.horas?.available ? [{ to: "/controlo-horas", label: "Controlo de Horas", icon: IconClock }] : []),
              ...(f.kmViaturas?.available ? [{ to: "/km-carrinhas", label: "Km das Carrinhas", icon: IconVan }] : []),
            ],
          },
        ]
      : []),
    ...(f.orcamentos?.available
      ? [{ id: "orcam", label: "Orçamentação", short: "Orçam.", sub: "Orçamentos a clientes", icon: IconFileText, pages: [{ to: "/orcamentos", label: "Orçamentos", icon: IconFileText }] }]
      : []),
    ...(f.objetivos?.available || f.relatorios?.available
      ? [
          {
            id: "gestao",
            label: "Gestão",
            short: "Gestão",
            sub: "Objetivos e relatórios",
            icon: IconChart,
            pages: [
              ...(f.objetivos?.available ? [{ to: "/objetivos", label: "Objetivos", icon: IconTarget }] : []),
              ...(f.relatorios?.available ? [{ to: "/relatorios", label: "Relatório de Produção", icon: IconChart }] : []),
            ],
          },
        ]
      : []),
    ...(f.financeiro?.available
      ? [{ id: "finan", label: "Financeiro", short: "Finan.", sub: "Cheques, pagamentos e calendário", icon: IconWallet, pages: [{ to: "/financeiro", label: "Cheques passados", icon: IconWallet }] }]
      : []),
  ];
  const configArea: D2Area | null =
    canConfig || canUsers
      ? {
          id: "config",
          label: "Configuração",
          short: "Config.",
          sub: "Produtos, etapas, utilizadores e avisos",
          icon: IconGear,
          pages: [
            ...(canConfig
              ? [
                  { to: "/products", label: "Produtos", icon: IconBox },
                  { to: "/stages", label: "Etapas", icon: IconLayers },
                  { to: "/production-lines", label: "Linhas de Produção", icon: IconRoute },
                  { to: "/suppliers", label: "Fornecedores", icon: IconTruck },
                ]
              : []),
            ...(canUsers
              ? [
                  { to: "/users", label: "Utilizadores e Permissões", icon: IconUsers, group: "Administração" },
                  { to: "/acessos", label: "Acessos", icon: IconKey, group: "Administração" },
                  { to: "/avisos-telegram", label: "Avisos Telegram", icon: IconSend, group: "Administração" },
                  { to: "/emails-automaticos", label: "Avisos Semanais", icon: IconSend, group: "Administração" },
                ]
              : []),
          ],
        }
      : null;
  const all = configArea ? [...areas, configArea] : areas;

  const path = location.pathname;
  const matches = (p: D2Page) => (p.end || p.to === "/" ? path === p.to : path === p.to || path.startsWith(p.to + "/"));
  const areaOfPath = all.find((a) => a.pages.some((p) => !p.onClick && matches(p)))?.id ?? (path.startsWith("/service-orders") ? "producao" : null);
  const [areaId, setAreaId] = useState<string>(areaOfPath ?? "producao");
  useEffect(() => {
    if (areaOfPath) setAreaId(areaOfPath);
  }, [areaOfPath]);
  const area = all.find((a) => a.id === areaId) ?? all[0];

  function toggleFav(to: string) {
    setFavs((prev) => {
      const next = prev.includes(to) ? prev.filter((x) => x !== to) : [...prev, to];
      try {
        localStorage.setItem(FAV_KEY, JSON.stringify(next));
      } catch {
        /* sem armazenamento */
      }
      return next;
    });
  }
  const pageList = all.flatMap((a) => a.pages.filter((p) => !p.onClick).map((p) => ({ ...p, area: a.label })));
  const favPages = favs.map((to) => pageList.find((p) => p.to === to)).filter((p): p is (typeof pageList)[number] => !!p);

  // Pesquisa: páginas e Ordens de Serviço (nº, cliente).
  const nq = norm(q.trim());
  const pageHits = nq ? pageList.filter((p) => norm(p.label).includes(nq) || norm(p.area).includes(nq)).slice(0, 6) : [];
  const osHits = nq.length >= 2 ? orders.filter((o) => norm(o.externalId).includes(nq) || norm(o.client?.name ?? "").includes(nq)).slice(0, 6) : [];
  const hits = [
    ...pageHits.map((p) => ({ key: "p" + p.to, to: p.to, label: p.label, sub: p.area })),
    ...osHits.map((o) => ({ key: "o" + o.id, to: `/service-orders/${o.id}`, label: `OS ${o.externalId}`, sub: o.client?.name ?? "" })),
  ];
  function go(to: string) {
    setQ("");
    searchRef.current?.blur();
    navigate(to);
    onClose();
  }

  let lastGroup: string | undefined;
  return (
    <div className="sd2-wrap">
      <div className="sd2-rail">
        <div className="sd2-logo">
          <img src={logoMark} alt="Minho Ferragens" />
        </div>
        {f.inicio?.available && (
          <NavLink to="/" end className="sd2-ri" title="Início">
            <IconHome />
            <span>Início</span>
          </NavLink>
        )}
        {areas.map((a) => (
          <button key={a.id} type="button" className={`sd2-ri${a.id === area.id ? " on" : ""}`} onClick={() => setAreaId(a.id)} title={a.label} aria-pressed={a.id === area.id}>
            <a.icon />
            <span>{a.short}</span>
            {a.dot && <i className="sd2-dot" />}
          </button>
        ))}
        {f.chat?.available && (
          <NavLink to="/chat" className="sd2-ri" title="Chat">
            <IconChat />
            <span>Chat</span>
            {chatUnread > 0 && <i className="sd2-dot" />}
          </NavLink>
        )}
        <div style={{ flex: 1 }} />
        {configArea && (
          <button type="button" className={`sd2-ri${area.id === "config" ? " on" : ""}`} onClick={() => setAreaId("config")} title="Configuração">
            <IconGear />
            <span>Config.</span>
          </button>
        )}
        <div className="sd2-avatar" title={userName}>
          {initials(userName)}
        </div>
        <button type="button" className="sd2-logout" onClick={onLogout} title="Terminar sessão" aria-label="Terminar sessão">
          <IconLogout />
        </button>
      </div>

      <div className="sd2-pane">
        <div className="sd2-search">
          <IconSearch />
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setFocus(true)}
            onBlur={() => setTimeout(() => setFocus(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hits[0]) go(hits[0].to);
              if (e.key === "Escape") {
                setQ("");
                searchRef.current?.blur();
              }
            }}
            placeholder="Procurar página ou OS…"
            aria-label="Procurar página ou Ordem de Serviço"
          />
          <kbd>Ctrl K</kbd>
          {focus && nq && (
            <div className="sd2-results">
              {hits.length === 0 && <div className="sd2-empty">Nada encontrado.</div>}
              {hits.map((h) => (
                <button key={h.key} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => go(h.to)}>
                  <strong>{h.label}</strong>
                  <span>{h.sub}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {favPages.length > 0 ? (
          <div className="sd2-favs">
            {favPages.map((p) => (
              <NavLink key={p.to} to={p.to} end={p.end}>
                ★ {p.label}
              </NavLink>
            ))}
          </div>
        ) : null}
        <div className="sd2-title">{area.label}</div>
        <div className="sd2-sub">{area.sub}</div>


        <nav className="sd2-list">
          {area.pages.map((p) => {
            const head = p.group && p.group !== lastGroup ? p.group : null;
            lastGroup = p.group;
            const isFav = favs.includes(p.to);
            return (
              <Fragment key={p.key ?? p.to}>
                {head && <div className="sd2-group">{head}</div>}
                <div className="sd2-item">
                  <NavLink
                    to={p.to}
                    end={p.end}
                    onClick={p.onClick}
                    className={({ isActive }) => (isActive && !p.onClick ? "active" : "")}
                  >
                    <p.icon />
                    <span className="sd2-label">{p.label}</span>
                    {p.count != null && <span className={`sd2-count${p.warn ? " warn" : ""}`}>{p.count}</span>}
                  </NavLink>
                  {!p.onClick && (
                    <button
                      type="button"
                      className={`sd2-star${isFav ? " on" : ""}`}
                      onClick={() => toggleFav(p.to)}
                      title={isFav ? "Tirar dos atalhos" : "Pôr nos atalhos"}
                      aria-label={isFav ? `Tirar ${p.label} dos atalhos` : `Pôr ${p.label} nos atalhos`}
                    >
                      ★
                    </button>
                  )}
                </div>
              </Fragment>
            );
          })}
        </nav>

        {favPages.length === 0 && (
          <div className="sd2-tip">
            <b>Dica:</b> carrega em ★ ao lado de uma página para a pôr nos atalhos.
          </div>
        )}
      </div>
    </div>
  );
}
