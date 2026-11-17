import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api/client";
import { useFeature } from "../contexts/FeaturesContext";
import { FeatureTestBanner } from "../components/FeatureTestBanner";
import { useAuth } from "../contexts/AuthContext";

// ============================================================================
// Documentos (catálogos, tabelas de preço) por departamento — pedido do
// utilizador de 2026-11-17. Qualquer utilizador pode ver, fazer download e
// carregar novos ficheiros. 4 departamentos.
// ============================================================================

const FEATURE_KEY = "documentos";

const DEPARTAMENTOS = [
  { id: "comercial",        label: "Comercial" },
  { id: "producao",         label: "Produção" },
  { id: "compras",          label: "Compras / Fornecedores" },
  { id: "administrativo",   label: "Administrativo / Financeiro" },
] as const;

type DeptId = (typeof DEPARTAMENTOS)[number]["id"];

interface Documento {
  id: string;
  departamento: DeptId;
  nome: string;
  mimeType: string;
  tamanho: number;
  uploadedBy: string;
  uploadedAt: string;
}

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function mimeIcon(mime: string) {
  if (mime === "application/pdf") return "📄";
  if (mime.startsWith("image/")) return "🖼️";
  if (mime.includes("spreadsheet") || mime.includes("excel")) return "📊";
  if (mime.includes("word") || mime.includes("document")) return "📝";
  return "📎";
}

export function DocumentosPage() {
  const feature = useFeature(FEATURE_KEY);
  const { user } = useAuth();
  const [activeDept, setActiveDept] = useState<DeptId>("comercial");
  const [docs, setDocs] = useState<Documento[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!feature.available) return <Navigate to="/" replace />;

  async function loadDocs(dept: DeptId) {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Documento[]>(`/documentos?dept=${dept}`);
      setDocs(data);
    } catch {
      setError("Erro ao carregar documentos.");
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => { loadDocs(activeDept); }, [activeDept]);

  function handleTabChange(dept: DeptId) {
    setActiveDept(dept);
    setUploadErr(null);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadErr(null);
    setUploading(true);

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // remove "data:...;base64," prefix
          resolve(result.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      await api.post("/documentos", {
        departamento: activeDept,
        nome: file.name,
        mimeType: file.type || "application/octet-stream",
        base64,
      });

      await loadDocs(activeDept);
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? "Erro ao carregar ficheiro.";
      setUploadErr(msg);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleDownload(doc: Documento) {
    const a = document.createElement("a");
    a.href = `/api/documentos/${doc.id}/download`;
    a.download = doc.nome;
    a.click();
  }

  async function handleDelete(doc: Documento) {
    if (!confirm(`Apagar "${doc.nome}"?`)) return;
    try {
      await api.delete(`/documentos/${doc.id}`);
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    } catch {
      alert("Erro ao apagar documento.");
    }
  }

  const isAdmin = user?.role === "ADMINISTRADOR";

  return (
    <div className="page-content">
      {!feature.released && <FeatureTestBanner featureKey={FEATURE_KEY} label="a secção de Documentos" />}

      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Documentos</h1>
        <p style={{ margin: "4px 0 0", color: "var(--text-secondary, #6b7280)", fontSize: 14 }}>
          Catálogos, tabelas de preço e outros documentos por departamento.
        </p>
      </div>

      {/* Abas dos departamentos */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border, #e5e7eb)", marginBottom: 20 }}>
        {DEPARTAMENTOS.map((d) => (
          <button
            key={d.id}
            onClick={() => handleTabChange(d.id)}
            style={{
              padding: "8px 16px",
              border: "none",
              borderBottom: activeDept === d.id ? "2px solid var(--primary, #2563eb)" : "2px solid transparent",
              background: "none",
              cursor: "pointer",
              fontWeight: activeDept === d.id ? 600 : 400,
              color: activeDept === d.id ? "var(--primary, #2563eb)" : "var(--text-secondary, #6b7280)",
              fontSize: 14,
              marginBottom: -1,
              whiteSpace: "nowrap",
            }}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* Botão carregar ficheiro */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 16px",
            background: "var(--primary, #2563eb)",
            color: "#fff",
            borderRadius: 6,
            cursor: uploading ? "not-allowed" : "pointer",
            fontSize: 14,
            fontWeight: 500,
            opacity: uploading ? 0.7 : 1,
          }}
        >
          {uploading ? "A carregar…" : "⬆️ Carregar ficheiro"}
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.docx,.doc"
            style={{ display: "none" }}
            onChange={handleUpload}
            disabled={uploading}
          />
        </label>
        {uploadErr && (
          <span style={{ color: "#dc2626", fontSize: 13 }}>{uploadErr}</span>
        )}
      </div>

      {/* Lista de documentos */}
      {loading ? (
        <p style={{ color: "var(--text-secondary, #6b7280)", fontSize: 14 }}>A carregar…</p>
      ) : error ? (
        <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>
      ) : docs.length === 0 ? (
        <div style={{
          textAlign: "center",
          padding: "48px 24px",
          color: "var(--text-secondary, #9ca3af)",
          border: "2px dashed var(--border, #e5e7eb)",
          borderRadius: 10,
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
          <div style={{ fontSize: 15 }}>Ainda não há documentos neste departamento.</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Clica em "Carregar ficheiro" para adicionar o primeiro.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {docs.map((doc) => (
            <div
              key={doc.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 16px",
                background: "var(--card-bg, #fff)",
                border: "1px solid var(--border, #e5e7eb)",
                borderRadius: 8,
              }}
            >
              <span style={{ fontSize: 22, flexShrink: 0 }}>{mimeIcon(doc.mimeType)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {doc.nome}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary, #6b7280)", marginTop: 2 }}>
                  {fmtBytes(doc.tamanho)} · Carregado por {doc.uploadedBy} em {fmtDate(doc.uploadedAt)}
                </div>
              </div>
              <button
                onClick={() => handleDownload(doc)}
                title="Fazer download"
                style={{
                  padding: "5px 12px",
                  border: "1px solid var(--border, #e5e7eb)",
                  borderRadius: 6,
                  background: "none",
                  cursor: "pointer",
                  fontSize: 13,
                  color: "var(--primary, #2563eb)",
                  fontWeight: 500,
                  flexShrink: 0,
                }}
              >
                ⬇️ Download
              </button>
              {isAdmin && (
                <button
                  onClick={() => handleDelete(doc)}
                  title="Apagar documento"
                  style={{
                    padding: "5px 10px",
                    border: "1px solid #fca5a5",
                    borderRadius: 6,
                    background: "none",
                    cursor: "pointer",
                    fontSize: 13,
                    color: "#dc2626",
                    flexShrink: 0,
                  }}
                >
                  🗑️
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
