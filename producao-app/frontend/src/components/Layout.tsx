import { NavLink, Outlet } from "react-router-dom";
import { canManageConfig, canManageUsers, useAuth } from "../contexts/AuthContext";
import logoMark from "../assets/logo-mark.png";
import {
  IconBox,
  IconClipboard,
  IconLayers,
  IconLogout,
  IconPrinter,
  IconRoute,
  IconTruck,
  IconUsers,
} from "./icons";

function initials(name?: string) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-logo">
            <img src={logoMark} alt="Minho Ferragens" />
          </div>
          <div className="sidebar-brand-text">
            <div className="sidebar-brand-name">Minho Ferragens</div>
            <div className="sidebar-brand-sub">Gestão de Produção</div>
          </div>
        </div>

        <nav>
          <NavLink to="/" end>
            <IconClipboard /> Ordens de Serviço
          </NavLink>
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
