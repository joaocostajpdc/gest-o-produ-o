import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { Client } from "../types";
import { useFeature } from "../contexts/FeaturesContext";

// ---------------------------------------------------------------------------
// Área Comercial — Clientes
// Filtros por zona, comercial, estado e pesquisa livre.
// Requer feature "clientes".
// ---------------------------------------------------------------------------

type Meta = { zonas: string[]; comerciais: string[]; statuses: string[] };
type Analytics = {
  porCliente: { clientId: string | null; name: string; zone: string | null; comercial: string | null; totalOS: number }[];
  porZona: { zona: string; total: number }[];
  porComercial: { comercial: string; total: number }[];
};

type View = "lista" | "analytics";

function Badge({ children, color }: { children: React.ReactNode; color?: string; }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 7px",
        borderRadius: 10,
        fontSize: 12,
        fontWeight: 500,
        background: color ?? "var(--color-muted, #e5e7eb)",
        color: "var(--color-fg, inherit)",
        marginLeft: 4,
      }}
    >
      {children}
    </span>
  );
}

function statusColor(status: string | null | undefined) {
  if (!status) return undefined;
  if (status.toLowerCase().includes("ativ")) return "#dcfce7";
  if (status.toLowerCase().includes("inativ") || status.toLowerCase().includes("suspen")) return "#fee2e2";
  return undefined;
}

function WhatsAppIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: "#25d366" }}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

export function ClientesPage() {
  const clientes = useFeature("clientes");

  const [view, setView] = useState<View>("lista");
  const [clients, setClients] = useState<Client[]>([]);
  const [meta, setMeta] = useState<Meta>({ zonas: [], comerciais: [], statuses: [] });
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [q, setQ] = useState("");
  const [zona, setZona] = useState("");
  const [comercialFiltro, setComercialFiltro] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("");

  // Detalhe
  const [selected, setSelected] = useState<Client | null>(null);

  async function loadMeta() {
    try {
      const m = await api.get<Meta>("/clients/comercial/meta");
      setMeta(m);
    } catch {
      /* silencioso */
    }
  }

  async function loadClients() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (zona) params.set("zona", zona);
      if (comercialFiltro) params.set("comercial", comercialFiltro);
      if (statusFiltro) params.set("status", statusFiltro);
      const data = await api.get<Client[]>(`/clients/comercial?${params}`);
      setClients(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar clientes.");
    } finally {
      setLoading(false);
    }
  }

  async function loadAnalytics() {
    if (analytics) return;
    try {
      const data = await api.get<Analytics>("/clients/comercial/analytics");
      setAnalytics(data);
    } catch {
      /* silencioso */
    }
  }

  useEffect(() => {
    if (clientes.available) {
      loadMeta();
      loadClients();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientes.available]);

  // Pesquisa com debounce simples
  useEffect(() => {
    if (!clientes.available) return;
    const t = setTimeout(() => loadClients(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, zona, comercialFiltro, statusFiltro]);

  useEffect(() => {
    if (view === "analytics") loadAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const filtered = useMemo(() => clients, [clients]);

  if (!clientes.available && !clientes.loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--color-muted)" }}>
        Acesso à área comercial não disponível.
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h2>Clientes</h2>
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          <button
            className={`btn ${view === "lista" ? "btn-primary" : ""}`}
            onClick={() => setView("lista")}
          >
            Listagem
          </button>
          <button
            className={`btn ${view === "analytics" ? "btn-primary" : ""}`}
            onClick={() => setView("analytics")}
          >
            Analytics
          </button>
        </div>
      </div>

      {view === "lista" && (
        <>
          {/* Filtros */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="form-grid" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr" }}>
              <div className="form-group">
                <label>Pesquisa</label>
                <input
                  type="text"
                  placeholder="Nome, NIF, email, telefone…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Zona</label>
                <select value={zona} onChange={(e) => setZona(e.target.value)}>
                  <option value="">Todas</option>
                  {meta.zonas.map((z) => (
                    <option key={z} value={z}>{z}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Comercial</label>
                <select value={comercialFiltro} onChange={(e) => setComercialFiltro(e.target.value)}>
                  <option value="">Todos</option>
                  {meta.comerciais.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Estado</label>
                <select value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value)}>
                  <option value="">Todos</option>
                  {meta.statuses.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <div className="card">
            <div style={{ marginBottom: 8, fontSize: 13, color: "var(--color-muted)" }}>
              {loading ? "A carregar…" : `${filtered.length} cliente${filtered.length !== 1 ? "s" : ""}`}
            </div>

            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>NIF</th>
                    <th>Zona</th>
                    <th>Comercial</th>
                    <th>Contacto</th>
                    <th>Estado</th>
                    <th>OS</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr
                      key={c.id}
                      style={{ cursor: "pointer" }}
                      onClick={() => setSelected(c === selected ? null : c)}
                    >
                      <td>
                        <span style={{ fontWeight: 500 }}>{c.name}</span>
                        {c.whatsappactive && (
                          <span style={{ marginLeft: 6 }} title="WhatsApp ativo">
                            <WhatsAppIcon />
                          </span>
                        )}
                      </td>
                      <td style={{ color: "var(--color-muted)", fontSize: 13 }}>{c.taxNumber ?? "—"}</td>
                      <td>{c.zone ?? "—"}</td>
                      <td>{c.comercial ?? "—"}</td>
                      <td style={{ fontSize: 13 }}>
                        {c.phone && <div>{c.phone}</div>}
                        {c.mobile && <div>{c.mobile}</div>}
                        {!c.phone && !c.mobile && "—"}
                      </td>
                      <td>
                        {c.status ? (
                          <Badge color={statusColor(c.status)}>{c.status}</Badge>
                        ) : "—"}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {c._count?.serviceOrders != null ? (
                          <Badge>{c._count.serviceOrders}</Badge>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                  {!loading && filtered.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: "center", color: "var(--color-muted)", padding: "24px 0" }}>
                        Nenhum cliente encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Painel de detalhe */}
          {selected && (
            <div className="card" style={{ marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>{selected.name}</h3>
                <button className="btn" onClick={() => setSelected(null)}>Fechar</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "8px 24px" }}>
                <Detail label="NIF" value={selected.taxNumber} />
                <Detail label="Email" value={selected.email} />
                <Detail label="Telefone" value={selected.phone} />
                <Detail label="Telemóvel" value={selected.mobile} />
                <Detail label="Zona" value={selected.zone} />
                <Detail label="Comercial" value={selected.comercial} />
                <Detail label="Estado" value={selected.status} />
                <Detail label="Newsletter" value={selected.newsletter} />
                {selected.creditlimit != null && (
                  <Detail label="Plafond" value={`${Number(selected.creditlimit).toLocaleString("pt-PT")} €`} />
                )}
                <Detail label="WhatsApp" value={selected.whatsappactive ? "Sim" : "Não"} />
                <Detail label="OS totais" value={selected._count?.serviceOrders?.toString()} />
              </div>
            </div>
          )}
        </>
      )}

      {view === "analytics" && (
        <AnalyticsView analytics={analytics} />
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--color-muted)", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 14 }}>{value ?? "—"}</div>
    </div>
  );
}

function AnalyticsView({ analytics }: { analytics: Analytics | null }) {
  if (!analytics) return <div className="card" style={{ padding: 32, textAlign: "center" }}>A carregar analytics…</div>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
      {/* Top clientes por OS */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Top Clientes (por OS)</h3>
        <table className="table" style={{ fontSize: 13 }}>
          <thead>
            <tr><th>Cliente</th><th>Zona</th><th>OS</th></tr>
          </thead>
          <tbody>
            {analytics.porCliente.slice(0, 15).map((r, i) => (
              <tr key={i}>
                <td>{r.name}</td>
                <td style={{ color: "var(--color-muted)" }}>{r.zone ?? "—"}</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{r.totalOS}</td>
              </tr>
            ))}
            {analytics.porCliente.length === 0 && (
              <tr><td colSpan={3} style={{ color: "var(--color-muted)", textAlign: "center" }}>Sem dados</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Por zona */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>OS por Zona</h3>
        <table className="table" style={{ fontSize: 13 }}>
          <thead><tr><th>Zona</th><th style={{ textAlign: "right" }}>OS</th></tr></thead>
          <tbody>
            {analytics.porZona.map((r, i) => (
              <tr key={i}>
                <td>{r.zona}</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{r.total}</td>
              </tr>
            ))}
            {analytics.porZona.length === 0 && (
              <tr><td colSpan={2} style={{ color: "var(--color-muted)", textAlign: "center" }}>Sem dados</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Por comercial */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>OS por Comercial</h3>
        <table className="table" style={{ fontSize: 13 }}>
          <thead><tr><th>Comercial</th><th style={{ textAlign: "right" }}>OS</th></tr></thead>
          <tbody>
            {analytics.porComercial.map((r, i) => (
              <tr key={i}>
                <td>{r.comercial}</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{r.total}</td>
              </tr>
            ))}
            {analytics.porComercial.length === 0 && (
              <tr><td colSpan={2} style={{ color: "var(--color-muted)", textAlign: "center" }}>Sem dados</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
