import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { ApiError } from "../api/client";
import logoMark from "../assets/logo-mark.png";

// Se a app redirecionou para aqui automaticamente por o token ter expirado
// (ver handleUnauthorized em api/client.ts), mostra um aviso claro em vez de
// deixar a pessoa sem perceber porque é que "de repente" foi para o login.
function wasSessionExpired(): boolean {
  return new URLSearchParams(window.location.search).get("sessao_expirada") === "1";
}

export function LoginPage() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sessionExpired] = useState(wasSessionExpired);

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

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <img src={logoMark} alt="Minho Ferragens" className="login-logo" />
        <h1>Gestão de Produção</h1>
        <p className="muted">Inicia sessão para aceder à aplicação.</p>

        {sessionExpired && (
          <p className="error-text">A sua sessão expirou. Inicie sessão novamente.</p>
        )}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Palavra-passe</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && <p className="error-text">{error}</p>}

        <button className="btn" type="submit" disabled={submitting} style={{ width: "100%" }}>
          {submitting ? "A entrar..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
