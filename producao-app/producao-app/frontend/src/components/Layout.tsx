import { NavLink, Outlet } from "react-router-dom";
import { canManageConfig, canManageUsers, useAuth } from "../contexts/AuthContext";

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>Gestão de Produção</h1>

        <NavLink to="/" end>
          Ordens de Serviço
        </NavLink>
        <NavLink to="/reports">Listagens Imprimíveis</NavLink>

        {canManageConfig(user?.role) && (
          <>
            <div className="section-label">Configuração</div>
            <NavLink to="/products">Produtos</NavLink>
            <NavLink to="/stages">Etapas</NavLink>
            <NavLink to="/production-lines">Linhas de Produção</NavLink>
            <NavLink to="/suppliers">Fornecedores</NavLink>
          </>
        )}

        {canManageUsers(user?.role) && (
          <>
            <div className="section-label">Administração</div>
            <NavLink to="/users">Utilizadores e Permissões</NavLink>
          </>
        )}

        <div className="user-box">
          <div>{user?.name}</div>
          <div className="muted">{user?.role}</div>
          <button onClick={logout}>Terminar sessão</button>
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
