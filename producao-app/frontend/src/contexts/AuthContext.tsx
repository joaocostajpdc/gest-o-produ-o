import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { api, getToken, setToken } from "../api/client";
import { AuthUser } from "../types";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get<{ user: AuthUser }>("/auth/me")
      .then((res) => setUser(res.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const res = await api.post<{ token: string; user: AuthUser }>("/auth/login", { email, password });
    setToken(res.token);
    setUser(res.user);
  }

  function logout() {
    setToken(null);
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>.");
  return ctx;
}

// Réplica leve, no frontend, das permissões relevantes para mostrar/ocultar
// ações na interface. A aplicação continua a validar tudo no backend; esta
// função serve apenas para não mostrar ações que o utilizador não pode
// executar.
const ROLE_CAN_MANAGE_CONFIG = ["ADMINISTRADOR", "SUPERVISOR"];
const ROLE_CAN_CHANGE_FLOW = ["ADMINISTRADOR", "SUPERVISOR"];
const ROLE_CAN_MANAGE_USERS = ["ADMINISTRADOR"];

export function canManageConfig(role?: string | null) {
  return !!role && ROLE_CAN_MANAGE_CONFIG.includes(role);
}
export function canChangeFlow(role?: string | null) {
  return !!role && ROLE_CAN_CHANGE_FLOW.includes(role);
}
export function canManageUsers(role?: string | null) {
  return !!role && ROLE_CAN_MANAGE_USERS.includes(role);
}
