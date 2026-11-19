import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./contexts/AuthContext";
import "./styles/global.css";

// Captura erros JS não tratados e mostra-os no ecrã (diagnóstico)
window.addEventListener("error", (e) => {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = `<div style="position:fixed;inset:0;background:#0f1322;color:#fff;font-family:monospace;padding:32px;overflow-y:auto;z-index:9999">
    <div style="font-size:20px;font-weight:700;color:#f87171;margin-bottom:16px">❌ Erro JavaScript</div>
    <div style="color:#fca5a5;margin-bottom:12px">${e.message || "Erro desconhecido"}</div>
    <div style="color:#94a3b8;font-size:12px;margin-bottom:8px">Ficheiro: ${e.filename || "?"} linha ${e.lineno || "?"}:${e.colno || "?"}</div>
    <button onclick="window.location.reload()" style="margin-top:16px;padding:10px 20px;background:#2563eb;color:#fff;border:none;border-radius:8px;cursor:pointer">Recarregar</button>
  </div>`;
});

window.addEventListener("unhandledrejection", (e) => {
  console.error("🔴 Promise não tratada:", e.reason);
});

// ErrorBoundary temporário para diagnóstico — mostra o erro em vez de página em branco
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("🔴 ERRO REACT:", error.message, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: "fixed", inset: 0, background: "#0f1322", color: "#fff",
          fontFamily: "monospace", padding: 32, overflowY: "auto"
        }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#f87171", marginBottom: 16 }}>
            ❌ Erro na aplicação
          </div>
          <div style={{ color: "#fca5a5", marginBottom: 12 }}>{this.state.error.message}</div>
          <pre style={{ fontSize: 12, color: "#94a3b8", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 24, padding: "10px 20px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
          >
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
