import { SVGProps, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { canManageConfig, canManageUsers, useAuth } from "../contexts/AuthContext";
import { useFeature } from "../contexts/FeaturesContext";
import { api } from "../api/client";
import { FeatureTestBanner } from "./FeatureTestBanner";
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

// Ícones da "Equipa e Frota" (relógio e carrinha).
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

export function Layout() {
  const { user, logout } = useAuth();
  // Pó em Stock: enquanto não for aprovado pelo administrador, só aparece
  // no menu dos administradores, com a marca "Teste" (ver FeaturesContext).
  const powderStock = useFeature("powderStock");
  const glassOrders = useFeature("glassOrders");
  const cutPlans = useFeature("cutPlans");
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
    return <Outlet />;
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
          {chat.available && (
            <NavLink to="/chat">
              <IconChat /> Chat
              {chatUnread > 0 && <span className="badge" style={{ marginLeft: "auto", background: "#dc2626", fontSize: 10.5, padding: "1px 7px" }}>{chatUnread}</span>}
              {!chat.released && <TestBadge />}
            </NavLink>
          )}
          <div className="section-label" style={{ marginTop: 4 }}>Produção</div>
          <NavLink to={inicio.available ? "/ordens-servico" : "/"} end>
            <IconClipboard /> Ordens de Serviço
          </NavLink>
          <NavLink to="/scan">
            <IconScan /> Ler Código
          </NavLink>
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

          <div className="section-label">Compras</div>
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

          {(horas.available || kmViaturas.available) && (
            <>
              <div className="section-label">Equipa e Frota</div>
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
            </>
          )}

          {orcamentos.available && (
            <>
              <div className="section-label">Orçamentação</div>
              <NavLink to="/orcamentos">
                <IconFileText /> Orçamentos
              </NavLink>
            </>
          )}

          {relatorios.available && (
            <>
              <div className="section-label">Gestão</div>
              <NavLink to="/relatorios">
                <IconChart /> Relatório de Produção
              </NavLink>
            </>
          )}

          {financeiro.available && (
            <>
              <div className="section-label">Financeiro</div>
              <NavLink to="/financeiro">
                <IconWallet /> Cheques passados
              </NavLink>
            </>
          )}

          {canManageConfig(user?.role) && (
            <>
              <div className="section-label">Configuração</div>
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
            </>
          )}

          {canManageUsers(user?.role) && (
            <>
              <div className="section-label">Administração</div>
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
            </>
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
          <div className={`app-shell${menuHover.available ? " sb-hover" : ""}${isHome ? " tabs-home" : ""}`}>
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
    <div className={`app-shell${menuHover.available ? " sb-hover" : ""}`}>
      {sidebarParts}
      <main className="main-content">
        {menuHoverBanner}
        <Outlet />
      </main>
    </div>
  );
}
