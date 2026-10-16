import { SVGProps, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { canManageConfig, canManageUsers, useAuth } from "../contexts/AuthContext";
import { useFeature } from "../contexts/FeaturesContext";
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
  // Em telemóvel/tablet o menu lateral fica escondido por omissão (vira uma
  // gaveta deslizante aberta pela barra superior); em ecrã de computador o
  // CSS ignora esta flag e o menu está sempre visível.
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Fecha a gaveta sempre que se navega para outra página.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <header className="mobile-topbar">
        <button
          className="mobile-menu-btn"
          onClick={() => setMenuOpen(true)}
          aria-label="Abrir menu"
        >
          <IconMenu />
        </button>
        <img src={logoMark} alt="Minho Ferragens" className="mobile-topbar-logo" />
        <span className="mobile-topbar-title">Gestão de Produção</span>
      </header>

      {menuOpen && <div className="sidebar-overlay" onClick={() => setMenuOpen(false)} />}

      <aside className={`sidebar${menuOpen ? " open" : ""}`}>
        <div className="sidebar-brand">
          <div className="sidebar-logo">
            <img src={logoMark} alt="Minho Ferragens" />
          </div>
          <div className="sidebar-brand-text">
            <div className="sidebar-brand-name">Minho Ferragens</div>
            <div className="sidebar-brand-sub">Gestão de Produção</div>
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
          <NavLink to="/" end>
            <IconClipboard /> Ordens de Serviço
          </NavLink>
          <NavLink to="/scan">
            <IconScan /> Ler Código
          </NavLink>
          <NavLink to="/material-lacagem">
            <IconDroplet /> Material em Lacagem
          </NavLink>
          <NavLink to="/material-a-pedir">
            <IconShoppingCart /> Material a Pedir
          </NavLink>
          {powderStock.available && (
            <NavLink to="/po-em-stock">
              <IconPaintBucket /> Pó em Stock
              {!powderStock.released && <TestBadge />}
            </NavLink>
          )}
          {glassOrders.available && (
            <NavLink to="/pedidos-vidros">
              <IconGlass /> Pedidos de Vidros
              {!glassOrders.released && <TestBadge />}
            </NavLink>
          )}
          {cutPlans.available && (
            <NavLink to="/otimizacao-corte">
              <IconCut /> Otimização de Corte
              {!cutPlans.released && <TestBadge />}
            </NavLink>
          )}
          <NavLink to="/reports">
            <IconPrinter /> Listagens Imprimíveis
          </NavLink>

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
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
