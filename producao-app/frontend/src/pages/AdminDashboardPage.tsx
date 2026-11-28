import { useEffect, useState } from "react";
import { api } from "../api/client";

// ============================================================================
// Dashboard de Apoio à Gestão — só para o ADMINISTRADOR (2026-11-26).
// Mostra KPIs de OS, vendas mensais, top clientes e estado das funcionalidades.
// ============================================================================

type AdminStats = {
  kpis: {
    totalOS: number;
    osEmCurso: number;
    osSuspensas: number;
    osMes: number;
    utilizadoresAtivos: number;
    totalClientes: number;
    totalImportacoes: number;
    faturacaoAno: number;
    encomendasAno: number;
  };
  osStatus: Record<string, number>;
  vendasMensais: { mes: string; kind: string; num_docs: number; total: number }[];
  topClientes: { cliente: string; num_docs: number; total: number }[];
  importacoesRecentes: {
    id: string;
    filename: string | null;
    kind: string;
    count: number;
    totalNet: number | null;
    createdAt: string;
  }[];
  featuresStatus: { key: string; released: boolean; releasedAt: string | null }[];
};

function fmt(val: number) {
  return val.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-PT");
}

function fmtMes(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-PT", { month: "short", year: "numeric" });
}

type KpiCardProps = { label: string; value: string | number; sub?: string; color?: string };
function KpiCard({ label, value, sub, color }: KpiCardProps) {
  return (
    <div className="card" style={{ minWidth: 140, flex: "1 1 140px" }}>
      <div style={{ fontSize: 11, color: "var(--text-muted, #888)", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color ?? "inherit", margin: "6px 0 2px" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--text-muted, #888)" }}>{sub}</div>}
    </div>
  );
}

// Barra simples proporcional
function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ background: "#eee", borderRadius: 4, height: 8, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, background: color, height: "100%", borderRadius: 4, transition: "width .4s" }} />
    </div>
  );
}

export function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<AdminStats>("/admin/stats")
      .then(setStats)
      .catch((e) => setError(e instanceof Error ? e.message : "Erro a carregar dados."));
  }, []);

  if (error) return <div className="page-header"><h2>Dashboard</h2><p className="error-text">{error}</p></div>;
  if (!stats) return <div className="page-header"><h2>Dashboard</h2><p>A carregar…</p></div>;

  const { kpis, osStatus, vendasMensais, topClientes, importacoesRecentes, featuresStatus } = stats;

  // Agrupar vendas mensais por mês
  const meses = [...new Set(vendasMensais.map((v) => v.mes))].sort();
  const ultimos6 = meses.slice(-6);
  const encMes = (mes: string) => vendasMensais.find((v) => v.mes === mes && v.kind === "ENCOMENDAS")?.total ?? 0;
  const fatMes = (mes: string) => vendasMensais.find((v) => v.mes === mes && v.kind === "FATURACAO")?.total ?? 0;
  const maxMes = Math.max(...ultimos6.map((m) => Math.max(encMes(m), fatMes(m))), 1);

  const topTotal = topClientes[0]?.total ?? 1;

  const statusLabel: Record<string, string> = {
    NAO_INICIADA: "Por iniciar",
    EM_PRODUCAO: "Em produção",
    SUSPENSA: "Suspensa",
    CONCLUIDA: "Concluída",
    CANCELADA: "Cancelada",
  };
  const statusColor: Record<string, string> = {
    NAO_INICIADA: "#f59e0b",
    EM_PRODUCAO: "#3b82f6",
    SUSPENSA: "#ef4444",
    CONCLUIDA: "#10b981",
    CANCELADA: "#6b7280",
  };

  const featuresLancadas = featuresStatus.filter((f) => f.released).length;

  return (
    <div>
      <div className="page-header">
        <h2>Dashboard de Gestão</h2>
        <p style={{ color: "var(--text-muted, #888)", fontSize: 13 }}>Dados em tempo real · só visível ao administrador</p>
      </div>

      {/* KPIs principais */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <KpiCard label="Encomendas este ano" value={fmt(kpis.encomendasAno)} />
        <KpiCard label="Faturação este ano" value={fmt(kpis.faturacaoAno)} />
        <KpiCard label="OS em curso" value={kpis.osEmCurso} sub={`${kpis.osMes} criadas este mês`} color="#3b82f6" />
        <KpiCard label="OS suspensas" value={kpis.osSuspensas} color={kpis.osSuspensas > 0 ? "#ef4444" : undefined} />
        <KpiCard label="Clientes" value={kpis.totalClientes} />
        <KpiCard label="Utilizadores ativos" value={kpis.utilizadoresAtivos} />
        <KpiCard label="Importações" value={kpis.totalImportacoes} sub="ficheiros carregados" />
        <KpiCard label="Funções ativas" value={featuresLancadas} sub={`de ${featuresStatus.length} disponíveis`} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* Vendas mensais — últimos 6 meses */}
        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h4 style={{ marginBottom: 16 }}>Vendas mensais — últimos 6 meses</h4>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "4px 8px", color: "#888", fontWeight: 600 }}>Mês</th>
                  <th style={{ textAlign: "right", padding: "4px 8px", color: "#888", fontWeight: 600 }}>Encomendas</th>
                  <th style={{ width: 120 }}></th>
                  <th style={{ textAlign: "right", padding: "4px 8px", color: "#888", fontWeight: 600 }}>Faturação</th>
                  <th style={{ width: 120 }}></th>
                </tr>
              </thead>
              <tbody>
                {ultimos6.map((mes) => (
                  <tr key={mes} style={{ borderTop: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "8px 8px", fontWeight: 500 }}>{fmtMes(mes)}</td>
                    <td style={{ textAlign: "right", padding: "8px 8px", fontFamily: "monospace" }}>{fmt(encMes(mes))}</td>
                    <td style={{ padding: "8px 8px" }}><Bar value={encMes(mes)} max={maxMes} color="#3b82f6" /></td>
                    <td style={{ textAlign: "right", padding: "8px 8px", fontFamily: "monospace" }}>{fmt(fatMes(mes))}</td>
                    <td style={{ padding: "8px 8px" }}><Bar value={fatMes(mes)} max={maxMes} color="#10b981" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: "#888", display: "flex", gap: 20 }}>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#3b82f6", borderRadius: 2, marginRight: 4 }}></span>Encomendas</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#10b981", borderRadius: 2, marginRight: 4 }}></span>Faturação</span>
          </div>
        </div>

        {/* Top 10 clientes */}
        <div className="card">
          <h4 style={{ marginBottom: 16 }}>Top clientes — encomendas (12 meses)</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {topClientes.map((c, i) => (
              <div key={c.cliente}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3 }}>
                  <span style={{ fontWeight: 500 }}>
                    <span style={{ color: "#aaa", marginRight: 6, fontWeight: 400 }}>#{i + 1}</span>
                    {c.cliente.length > 35 ? c.cliente.slice(0, 35) + "…" : c.cliente}
                  </span>
                  <span style={{ fontFamily: "monospace", color: "#3b82f6", fontWeight: 600 }}>{fmt(c.total)}</span>
                </div>
                <Bar value={c.total} max={topTotal} color="#3b82f6" />
                <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{c.num_docs} encomendas</div>
              </div>
            ))}
          </div>
        </div>

        {/* Estado das OS + importações recentes */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* OS por estado */}
          <div className="card">
            <h4 style={{ marginBottom: 14 }}>Estado das ordens de serviço</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {Object.entries(osStatus)
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => (
                  <div key={status} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        display: "inline-block",
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: statusColor[status] ?? "#aaa",
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ flex: 1, fontSize: 13 }}>{statusLabel[status] ?? status}</span>
                    <span style={{ fontWeight: 700, fontSize: 15, minWidth: 30, textAlign: "right" }}>{count}</span>
                  </div>
                ))}
            </div>
          </div>

          {/* Importações recentes */}
          <div className="card">
            <h4 style={{ marginBottom: 12 }}>Importações recentes</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {importacoesRecentes.slice(0, 6).map((imp) => (
                <div key={imp.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, borderBottom: "1px solid #f5f5f5", paddingBottom: 5 }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{imp.filename ? imp.filename.slice(0, 30) : "(sem nome)"}</div>
                    <div style={{ color: "#aaa" }}>
                      {imp.kind === "ENCOMENDAS" ? "Encomendas" : "Faturação"} · {imp.count} docs · {fmtDate(imp.createdAt)}
                    </div>
                  </div>
                  {imp.totalNet != null && (
                    <div style={{ fontFamily: "monospace", color: "#10b981", alignSelf: "center", fontWeight: 600, fontSize: 12 }}>
                      {fmt(imp.totalNet)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>

      {/* Funcionalidades */}
      <div className="card" style={{ marginTop: 16 }}>
        <h4 style={{ marginBottom: 14 }}>Funcionalidades lançadas</h4>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {featuresStatus.map((f) => (
            <span
              key={f.key}
              style={{
                padding: "4px 10px",
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 500,
                background: f.released ? "#dcfce7" : "#f3f4f6",
                color: f.released ? "#166534" : "#6b7280",
                border: f.released ? "1px solid #bbf7d0" : "1px solid #e5e7eb",
              }}
              title={f.releasedAt ? `Lançado em ${fmtDate(f.releasedAt)}` : "Não lançado"}
            >
              {f.released ? "✓ " : ""}{f.key}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
