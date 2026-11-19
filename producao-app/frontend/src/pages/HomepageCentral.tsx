import { useAuth } from "../contexts/AuthContext";
import { useFeature } from "../contexts/FeaturesContext";

// ============================================================================
// HomepageCentral — ecrã inicial simplificado por departamentos.
// Pedido de 2026-11-19: layout com 5 áreas (Produção, Administrativo,
// Financeiro, Comercial, Objetivos), simples e centrado.
// Visível apenas para utilizadores com a feature "homepageCentral" ativa.
// ============================================================================

const S = {
  width: 36,
  height: 36,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const deptIcons = {
  producao: (
    <svg {...S}>
      <path d="M3 21V10l5 3V10l5 3V10l5 3V4h3v17z" />
      <path d="M7 17h2M12 17h2M17 17h1" />
    </svg>
  ),
  administrativo: (
    <svg {...S}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h8M8 11h8M8 15h5" />
    </svg>
  ),
  financeiro: (
    <svg {...S}>
      <rect x="2.5" y="6" width="19" height="13" rx="2" />
      <path d="M2.5 10h19M6.5 15h4" />
    </svg>
  ),
  comercial: (
    <svg {...S}>
      <path d="M6 7h12l-1 13H7z" />
      <path d="M9 7a3 3 0 0 1 6 0" />
      <path d="M9 11h6" />
    </svg>
  ),
  objetivos: (
    <svg {...S}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.4" />
    </svg>
  ),
};

interface Dept {
  key: string;
  label: string;
  to: string;
  icon: React.ReactNode;
  color: string;
  soft: string;
  accentBorder?: boolean;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 13) return "Bom dia";
  if (h < 20) return "Boa tarde";
  return "Boa noite";
}

export function HomepageCentral() {
  const { user } = useAuth();
  const objetivos = useFeature("objetivos");

  const firstName = user?.name?.split(" ")[0];

  const depts: Dept[] = [
    {
      key: "producao",
      label: "Produção",
      to: "/ordens-servico",
      icon: deptIcons.producao,
      color: "#1d4ed8",
      soft: "#e8eeff",
    },
    {
      key: "administrativo",
      label: "Administrativo",
      to: "/controlo-horas",
      icon: deptIcons.administrativo,
      color: "#be185d",
      soft: "#fce7f3",
    },
    {
      key: "financeiro",
      label: "Financeiro",
      to: "/financeiro",
      icon: deptIcons.financeiro,
      color: "#0f766e",
      soft: "#ccfbf1",
    },
    {
      key: "comercial",
      label: "Comercial",
      to: "/orcamentos",
      icon: deptIcons.comercial,
      color: "#b45309",
      soft: "#fef3c7",
    },
    ...(objetivos.available
      ? [
          {
            key: "objetivos",
            label: "Objetivos",
            to: "/objetivos",
            icon: deptIcons.objetivos,
            color: "#16309e",
            soft: "#eef1ff",
            accentBorder: true,
          } as Dept,
        ]
      : []),
  ];

  return (
    <div className="hc-wrap">
      <header className="hc-header">
        <h1>
          {greeting()}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="hc-sub">Escolhe o departamento em que vais trabalhar.</p>
      </header>

      <div className="hc-grid">
        {depts.map((d) => (
          <a
            key={d.key}
            href={d.to}
            className={`hc-card${d.accentBorder ? " hc-card--obj" : ""}`}
            style={
              {
                "--dc": d.color,
                "--ds": d.soft,
              } as React.CSSProperties
            }
            onClick={(e) => {
              // usar navegação do React Router sem recarregar a página
              e.preventDefault();
              window.history.pushState({}, "", d.to);
              window.dispatchEvent(new PopStateEvent("popstate"));
            }}
          >
            <span className="hc-icon">{d.icon}</span>
            <span className="hc-label">{d.label}</span>
          </a>
        ))}
      </div>

      <style>{`
        .hc-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 100%;
          padding: 48px 24px 64px;
          gap: 40px;
          box-sizing: border-box;
        }
        .hc-header {
          text-align: center;
        }
        .hc-header h1 {
          font-size: 1.75rem;
          font-weight: 700;
          margin: 0 0 8px;
          color: var(--fg, #111827);
        }
        .hc-sub {
          margin: 0;
          font-size: 0.95rem;
          color: var(--fg-muted, #6b7280);
        }
        .hc-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 16px;
          width: 100%;
          max-width: 760px;
        }
        .hc-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 28px 16px;
          border-radius: 14px;
          background: var(--ds);
          border: 2px solid transparent;
          text-decoration: none;
          transition: transform 0.12s, box-shadow 0.12s, border-color 0.12s;
          cursor: pointer;
        }
        .hc-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 8px 24px rgba(0,0,0,0.10);
          border-color: var(--dc);
        }
        .hc-card--obj {
          border: 2px dashed var(--dc);
        }
        .hc-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 56px;
          height: 56px;
          border-radius: 14px;
          background: color-mix(in srgb, var(--dc) 12%, transparent);
          color: var(--dc);
        }
        .hc-label {
          font-size: 0.9rem;
          font-weight: 600;
          color: var(--dc);
          text-align: center;
          line-height: 1.2;
        }
        @media (prefers-color-scheme: dark) {
          .hc-card {
            background: color-mix(in srgb, var(--dc) 10%, #1e1e2e);
          }
          .hc-header h1 {
            color: #f9fafb;
          }
          .hc-sub {
            color: #9ca3af;
          }
          .hc-label {
            color: color-mix(in srgb, var(--dc) 80%, #fff);
          }
          .hc-icon {
            background: color-mix(in srgb, var(--dc) 18%, transparent);
            color: color-mix(in srgb, var(--dc) 80%, #fff);
          }
        }
        @media (max-width: 480px) {
          .hc-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
      `}</style>
    </div>
  );
}
