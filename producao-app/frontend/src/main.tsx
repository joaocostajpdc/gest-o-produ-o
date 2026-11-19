import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./contexts/AuthContext";
import "./styles/global.css";

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
