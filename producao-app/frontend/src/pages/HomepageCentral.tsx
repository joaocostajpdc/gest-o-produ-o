import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useFeature } from "../contexts/FeaturesContext";
import { api } from "../api/client";

// ============================================================================
// HomepageCentral v2 — homepage simplificada com painéis de negócio.
// Layout: saudação → grelha de departamentos → painéis (Objetivos + OS).
// Visível apenas para utilizadores com a feature "homepageCentral" ativa.
// 2026-11-19: adicionados painéis de objetivos do mês e OS urgentes.
// ============================================================================

// ── Ícones ──────────────────────────────────────────────────────────────────

const sv = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.65,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const icons = {
  producao:    <svg width={34} height={34} {...sv}><path d="M3 21V10l5 3V10l5 3V10l5 3V4h3v17z"/><path d="M7 17h2M12 17h2"/></svg>,
  admin:       <svg width={34} height={34} {...sv}><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>,
  financeiro:  <svg width={34} height={34} {...sv}><rect x="2.5" y="6" width="19" height="13" rx="2"/><path d="M2.5 10h19M6.5 15h4"/></svg>,
  comercial:   <svg width={34} height={34} {...sv}><path d="M6 7h12l-1 13H7z"/><path d="M9 7a3 3 0 0 1 6 0"/><path d="M9 11h6"/></svg>,
  objetivos:   <svg width={34} height={34} {...sv}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/></svg>,
  target:      <svg width={18} height={18} {...sv}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/></svg>,
  os:          <svg width={18} height={18} {...sv}><rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/></svg>,
  arrow:       <svg width={14} height={14} {...sv}><path d="M5 12h14M13 6l6 6-6 6"/></svg>,
  clock:       <svg width={14} height={14} {...sv}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>,
  alert:       <svg width={14} height={14} {...sv}><path d="M10.3 3.6 2 20h20L13.7 3.6a2 2 0 0 0-3.4 0z"/><path d="M12 10v4M12 17h.01"/></svg>,
};

// ── Tipos ────────────────────────────────────────────────────────────────────

interface ObjSummary {
  faturacao: { actual: number; target: number | null; expectedByNow: number | null };
  encomendas: { actual: number; target: number | null; expectedByNow: number | null };
}

interface OSItem {
  id: string;
  externalId: string;
  client: { id: string; name: string; externalId: string };
  deadlineAt: string | null;
  priority: string | null;
  priorityLabel: string | null;
  priorityColor: string | null;
  status: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function greeting() {
  const h = new Date().getHours();
  return h < 13 ? "Bom dia" : h < 20 ? "Boa tarde" : "Boa noite";
}

function fmt(v: number) {
  return v.toLocaleString("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

function pct(actual: number, target: number | null) {
  if (!target) return null;
  return Math.min(Math.round((actual / target) * 100), 999);
}

function daysLeft(iso: string | null) {
  if (!iso) return null;
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  return diff;
}

const PRIORITY_RANK: Record<string, number> = { CRITICA: 0, ALTA: 1, MEDIA: 2, BAIXA: 3 };

// ── Departamentos ─────────────────────────────────────────────────────────────

interface Dept { key: string; label: string; to: string; icon: React.ReactNode; color: string; soft: string; dashed?: boolean }

// ── Componente principal ──────────────────────────────────────────────────────

export function HomepageCentral() {
  const { user } = useAuth();
  const objetivos = useFeature("objetivos");

  const firstName = user?.name?.split(" ")[0];
  const now = new Date();

  // Objetivos
  const [obj, setObj] = useState<ObjSummary | null>(null);
  const [objLoading, setObjLoading] = useState(true);

  // OS urgentes
  const [osList, setOsList] = useState<OSItem[]>([]);
  const [osLoading, setOsLoading] = useState(true);

  useEffect(() => {
    if (!objetivos.available) { setObjLoading(false); return; }
    api
      .get<{ faturacao: ObjSummary["faturacao"]; encomendas: ObjSummary["encomendas"] }>(
        `/objetivos/resumo?periodType=MES&year=${now.getFullYear()}&period=${now.getMonth() + 1}`
      )
      .then((r) => setObj(r))
      .catch(() => undefined)
      .finally(() => setObjLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objetivos.available]);

  useEffect(() => {
    api
      .get<OSItem[]>("/service-orders?status=NAO_INICIADA,EM_PRODUCAO")
      .then((r) => {
        // A API já devolve ordenado por prioridade. Limitamos a 8 para o painel.
        setOsList((r ?? []).slice(0, 8));
      })
      .catch(() => undefined)
      .finally(() => setOsLoading(false));
  }, []);

  const depts: Dept[] = [
    { key: "producao",      label: "Produção",       to: "/ordens-servico", icon: icons.producao,   color: "#1d4ed8", soft: "#e8eeff" },
    { key: "administrativo",label: "Administrativo",  to: "/controlo-horas", icon: icons.admin,      color: "#be185d", soft: "#fce7f3" },
    { key: "financeiro",    label: "Financeiro",      to: "/financeiro",     icon: icons.financeiro,  color: "#0f766e", soft: "#ccfbf1" },
    { key: "comercial",     label: "Comercial",       to: "/orcamentos",     icon: icons.comercial,   color: "#b45309", soft: "#fef3c7" },
    ...(objetivos.available ? [{ key: "objetivos", label: "Objetivos", to: "/objetivos", icon: icons.objetivos, color: "#16309e", soft: "#eef1ff", dashed: true }] : []),
  ];

  const fatPct  = obj ? pct(obj.faturacao.actual,  obj.faturacao.target)  : null;
  const encPct  = obj ? pct(obj.encomendas.actual, obj.encomendas.target) : null;

  return (
    <div className="hc">
      {/* ── Saudação ── */}
      <header className="hc-head">
        <h1>{greeting()}{firstName ? `, ${firstName}` : ""}</h1>
        <p>Escolhe a área em que vais trabalhar.</p>
      </header>

      {/* ── Departamentos ── */}
      <nav className="hc-depts" aria-label="Departamentos">
        {depts.map((d) => (
          <Link
            key={d.key}
            to={d.to}
            className={`hc-dept${d.dashed ? " hc-dept--dashed" : ""}`}
            style={{ "--dc": d.color, "--ds": d.soft } as React.CSSProperties}
          >
            <span className="hc-dept-icon">{d.icon}</span>
            <span className="hc-dept-label">{d.label}</span>
          </Link>
        ))}
      </nav>

      {/* ── Painéis ── */}
      <div className="hc-panels">

        {/* Objetivos do mês */}
        {objetivos.available && (
          <section className="hc-panel hc-panel--obj" aria-labelledby="hc-obj-title">
            <div className="hc-panel-head">
              <span className="hc-panel-ico" style={{ color: "#16309e" }}>{icons.target}</span>
              <h2 id="hc-obj-title">Objetivos — {now.toLocaleString("pt-PT", { month: "long" })}</h2>
              <Link to="/objetivos" className="hc-panel-link">Ver tudo {icons.arrow}</Link>
            </div>

            {objLoading ? (
              <p className="hc-loading">A carregar…</p>
            ) : obj ? (
              <div className="hc-obj-rows">
                {/* Faturação */}
                <div className="hc-obj-row">
                  <div className="hc-obj-labels">
                    <span className="hc-obj-name">Faturação</span>
                    <span className="hc-obj-vals">
                      <strong>{fmt(obj.faturacao.actual)}</strong>
                      {obj.faturacao.target && <span className="hc-obj-of"> / {fmt(obj.faturacao.target)}</span>}
                    </span>
                  </div>
                  {obj.faturacao.target && (
                    <div className="hc-bar-wrap">
                      <div className="hc-bar" style={{ "--p": `${Math.min(fatPct ?? 0, 100)}%`, "--c": fatPct != null && fatPct >= 100 ? "#16a34a" : "#1d4ed8" } as React.CSSProperties} />
                      {obj.faturacao.expectedByNow != null && (
                        <div className="hc-bar-pace" style={{ left: `${Math.min(Math.round((obj.faturacao.expectedByNow / obj.faturacao.target) * 100), 100)}%` }} title="Ritmo esperado" />
                      )}
                    </div>
                  )}
                  {fatPct != null && <span className={`hc-pct${fatPct >= 100 ? " hc-pct--ok" : ""}`}>{fatPct}%</span>}
                </div>

                {/* Encomendas */}
                <div className="hc-obj-row">
                  <div className="hc-obj-labels">
                    <span className="hc-obj-name">Encomendas</span>
                    <span className="hc-obj-vals">
                      <strong>{fmt(obj.encomendas.actual)}</strong>
                      {obj.encomendas.target && <span className="hc-obj-of"> / {fmt(obj.encomendas.target)}</span>}
                    </span>
                  </div>
                  {obj.encomendas.target && (
                    <div className="hc-bar-wrap">
                      <div className="hc-bar" style={{ "--p": `${Math.min(encPct ?? 0, 100)}%`, "--c": encPct != null && encPct >= 100 ? "#16a34a" : "#0f766e" } as React.CSSProperties} />
                      {obj.encomendas.expectedByNow != null && (
                        <div className="hc-bar-pace" style={{ left: `${Math.min(Math.round((obj.encomendas.expectedByNow / obj.encomendas.target) * 100), 100)}%` }} title="Ritmo esperado" />
                      )}
                    </div>
                  )}
                  {encPct != null && <span className={`hc-pct${encPct >= 100 ? " hc-pct--ok" : ""}`}>{encPct}%</span>}
                </div>
              </div>
            ) : (
              <p className="hc-empty">Sem dados de objetivos para este mês.</p>
            )}
          </section>
        )}

        {/* OS urgentes */}
        <section className="hc-panel hc-panel--os" aria-labelledby="hc-os-title">
          <div className="hc-panel-head">
            <span className="hc-panel-ico" style={{ color: "#1d4ed8" }}>{icons.os}</span>
            <h2 id="hc-os-title">Ordens de Serviço pendentes</h2>
            <Link to="/ordens-servico" className="hc-panel-link">Ver todas {icons.arrow}</Link>
          </div>

          {osLoading ? (
            <p className="hc-loading">A carregar…</p>
          ) : osList.length === 0 ? (
            <p className="hc-empty">Sem ordens de serviço pendentes.</p>
          ) : (
            <ul className="hc-os-list">
              {osList.map((os) => {
                const days = daysLeft(os.deadlineAt);
                const urgent = os.priority === "CRITICA" || os.priority === "ALTA" || (days != null && days <= 2);
                return (
                  <li key={os.id}>
                    <Link to={`/ordens-servico/${os.id}`} className={`hc-os-row${urgent ? " hc-os-row--urgent" : ""}`}>
                      <span className="hc-os-code">{os.externalId}</span>
                      <span className="hc-os-client">{os.client?.name ?? "—"}</span>
                      <span className="hc-os-right">
                        {os.priorityLabel && (
                          <span className="hc-os-badge" style={{ background: os.priorityColor ?? "#6b7280" + "22", color: os.priorityColor ?? "#6b7280" }}>
                            {urgent ? icons.alert : icons.clock}
                            {os.priorityLabel}
                          </span>
                        )}
                        {days != null && (
                          <span className={`hc-os-days${days <= 0 ? " hc-os-days--late" : days <= 2 ? " hc-os-days--warn" : ""}`}>
                            {days < 0 ? `${Math.abs(days)}d atraso` : days === 0 ? "Hoje" : `${days}d`}
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <style>{`
        /* ── Layout ── */
        .hc { display:flex; flex-direction:column; gap:28px; padding:40px 32px 64px; max-width:1100px; margin:0 auto; box-sizing:border-box; }

        /* ── Saudação ── */
        .hc-head { text-align:center; }
        .hc-head h1 { margin:0 0 6px; font-size:1.75rem; font-weight:700; color:var(--fg,#111827); }
        .hc-head p  { margin:0; font-size:.93rem; color:var(--fg-muted,#6b7280); }

        /* ── Departamentos ── */
        .hc-depts { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:14px; }
        .hc-dept {
          display:flex; flex-direction:column; align-items:center; gap:10px;
          padding:22px 12px 18px; border-radius:14px; text-decoration:none;
          background:var(--ds); border:2px solid transparent;
          transition:transform .12s, box-shadow .12s, border-color .12s;
        }
        .hc-dept:hover { transform:translateY(-3px); box-shadow:0 8px 20px rgba(0,0,0,.09); border-color:var(--dc); }
        .hc-dept--dashed { border:2px dashed var(--dc) !important; }
        .hc-dept-icon { display:flex; align-items:center; justify-content:center; width:52px; height:52px; border-radius:12px; background:color-mix(in srgb,var(--dc) 12%,transparent); color:var(--dc); }
        .hc-dept-label { font-size:.85rem; font-weight:600; color:var(--dc); text-align:center; }

        /* ── Painéis ── */
        .hc-panels { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
        .hc-panel { background:var(--surface,#fff); border:1.5px solid var(--border,#e5e7eb); border-radius:14px; padding:20px 22px 22px; display:flex; flex-direction:column; gap:14px; }
        .hc-panel-head { display:flex; align-items:center; gap:8px; }
        .hc-panel-ico { display:flex; }
        .hc-panel-head h2 { margin:0; font-size:.95rem; font-weight:600; color:var(--fg,#111827); flex:1; }
        .hc-panel-link { font-size:.8rem; color:var(--fg-muted,#6b7280); text-decoration:none; display:flex; align-items:center; gap:4px; white-space:nowrap; }
        .hc-panel-link:hover { color:var(--fg,#111827); }

        /* Objetivos */
        .hc-obj-rows { display:flex; flex-direction:column; gap:14px; }
        .hc-obj-row  { display:flex; flex-direction:column; gap:5px; }
        .hc-obj-labels { display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
        .hc-obj-name { font-size:.82rem; color:var(--fg-muted,#6b7280); }
        .hc-obj-vals strong { font-size:.9rem; color:var(--fg,#111827); }
        .hc-obj-of { font-size:.8rem; color:var(--fg-muted,#6b7280); }
        .hc-bar-wrap { position:relative; height:6px; background:var(--border,#e5e7eb); border-radius:4px; overflow:visible; }
        .hc-bar { position:absolute; inset:0; width:var(--p,0%); background:var(--c,#1d4ed8); border-radius:4px; transition:width .4s; }
        .hc-bar-pace { position:absolute; top:-3px; width:2px; height:12px; background:#f59e0b; border-radius:2px; transform:translateX(-50%); }
        .hc-pct { font-size:.78rem; font-weight:600; color:var(--fg-muted,#6b7280); text-align:right; }
        .hc-pct--ok { color:#16a34a; }

        /* OS */
        .hc-os-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:4px; }
        .hc-os-row {
          display:grid; grid-template-columns:auto 1fr auto;
          align-items:center; gap:10px; padding:8px 10px; border-radius:8px;
          text-decoration:none; background:transparent;
          transition:background .1s;
        }
        .hc-os-row:hover { background:var(--surface-hover,#f9fafb); }
        .hc-os-row--urgent { background:color-mix(in srgb,#ef4444 6%,transparent); }
        .hc-os-row--urgent:hover { background:color-mix(in srgb,#ef4444 10%,transparent); }
        .hc-os-code  { font-size:.8rem; font-weight:700; color:var(--fg,#111827); font-variant-numeric:tabular-nums; white-space:nowrap; }
        .hc-os-client{ font-size:.82rem; color:var(--fg-muted,#6b7280); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .hc-os-right { display:flex; align-items:center; gap:6px; }
        .hc-os-badge { display:flex; align-items:center; gap:3px; font-size:.72rem; font-weight:600; padding:2px 6px; border-radius:999px; }
        .hc-os-days  { font-size:.75rem; font-variant-numeric:tabular-nums; color:var(--fg-muted,#6b7280); white-space:nowrap; }
        .hc-os-days--warn { color:#b45309; font-weight:600; }
        .hc-os-days--late { color:#dc2626; font-weight:700; }

        .hc-loading { margin:0; font-size:.85rem; color:var(--fg-muted,#9ca3af); }
        .hc-empty   { margin:0; font-size:.85rem; color:var(--fg-muted,#9ca3af); }

        /* ── Dark mode ── */
        @media (prefers-color-scheme:dark) {
          .hc-head h1 { color:#f9fafb; }
          .hc-head p  { color:#9ca3af; }
          .hc-dept { background:color-mix(in srgb,var(--dc) 10%,#1e1e2e); }
          .hc-dept-label { color:color-mix(in srgb,var(--dc) 80%,#fff); }
          .hc-dept-icon  { color:color-mix(in srgb,var(--dc) 80%,#fff); background:color-mix(in srgb,var(--dc) 18%,transparent); }
          .hc-panel { background:#1e1e2e; border-color:#2d2d3f; }
          .hc-panel-head h2 { color:#f9fafb; }
          .hc-os-code  { color:#f9fafb; }
          .hc-os-client{ color:#9ca3af; }
          .hc-os-row:hover { background:#2a2a3e; }
          .hc-bar-wrap { background:#2d2d3f; }
          .hc-obj-vals strong { color:#f9fafb; }
        }

        /* ── Responsivo ── */
        @media (max-width:700px) {
          .hc { padding:24px 16px 48px; }
          .hc-panels { grid-template-columns:1fr; }
          .hc-depts  { grid-template-columns:repeat(2,1fr); }
        }
      `}</style>
    </div>
  );
}
