import { useEffect, useState, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useFeature } from "../contexts/FeaturesContext";
import { api } from "../api/client";

// ============================================================================
// HomepageCentral v3 — dashboard de widgets personalizável por utilizador.
// Cada utilizador escolhe quais os widgets que quer ver e ordena-os via
// drag & drop. Configuração guardada em localStorage (chave por user ID).
// 2026-11-19: versão inicial com 5 widgets disponíveis.
// ============================================================================

// ── Ícones ───────────────────────────────────────────────────────────────────

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
  producao:   <svg width={34} height={34} {...sv}><path d="M3 21V10l5 3V10l5 3V10l5 3V4h3v17z"/><path d="M7 17h2M12 17h2"/></svg>,
  admin:      <svg width={34} height={34} {...sv}><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>,
  financeiro: <svg width={34} height={34} {...sv}><rect x="2.5" y="6" width="19" height="13" rx="2"/><path d="M2.5 10h19M6.5 15h4"/></svg>,
  comercial:  <svg width={34} height={34} {...sv}><path d="M6 7h12l-1 13H7z"/><path d="M9 7a3 3 0 0 1 6 0"/><path d="M9 11h6"/></svg>,
  objetivos:  <svg width={34} height={34} {...sv}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/></svg>,
  targetSm:   <svg width={18} height={18} {...sv} viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/></svg>,
  osSm:       <svg width={18} height={18} {...sv} viewBox="0 0 24 24"><rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/></svg>,
  plan:       <svg width={18} height={18} {...sv} viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>,
  shortcuts:  <svg width={18} height={18} {...sv} viewBox="0 0 24 24"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13,2 13,9 20,9"/></svg>,
  material:   <svg width={18} height={18} {...sv} viewBox="0 0 24 24"><path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>,
  arrow:      <svg width={14} height={14} {...sv} viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>,
  clock:      <svg width={14} height={14} {...sv} viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>,
  alert:      <svg width={14} height={14} {...sv} viewBox="0 0 24 24"><path d="M10.3 3.6 2 20h20L13.7 3.6a2 2 0 0 0-3.4 0z"/><path d="M12 10v4M12 17h.01"/></svg>,
  check:      <svg width={14} height={14} {...sv} viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>,
  drag:       <svg width={16} height={16} {...sv} viewBox="0 0 24 24"><circle cx="9" cy="7" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="7" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="17" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="1.3" fill="currentColor" stroke="none"/></svg>,
  plus:       <svg width={15} height={15} {...sv} viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>,
  close:      <svg width={14} height={14} {...sv} viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>,
  settings:   <svg width={16} height={16} {...sv} viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
};

// ── Tipos de dados ────────────────────────────────────────────────────────────

interface ObjSummary {
  faturacao:  { actual: number; target: number | null; expectedByNow: number | null };
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

interface PlanItem {
  id: string;
  date: string;
  kind: string;
  title: string | null;
  done: boolean;
  serviceOrder: { externalId: string; client: string; stage: string | null } | null;
}

interface WeekData {
  weekStart: string;
  items: PlanItem[];
}

interface MaterialRequest {
  id: string;
  description: string;
  quantity?: string | null;
  supplier?: { id: string; name: string } | null;
  status: string;
  createdAt: string;
  orderedAt?: string | null;
  receivedAt?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

function mondayOf(d: Date) {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy.toISOString().slice(0, 10);
}

// ── Registo de widgets ────────────────────────────────────────────────────────

type WidgetId = "os" | "objetivos" | "planeamento" | "atalhos" | "material";

interface WidgetMeta {
  id: WidgetId;
  label: string;
  icon: React.ReactNode;
  color: string;
  defaultOn: boolean;
  requiresFeature?: string;
}

const WIDGET_REGISTRY: WidgetMeta[] = [
  { id: "os",          label: "OS Pendentes",                 icon: icons.osSm,      color: "#1d4ed8", defaultOn: true  },
  { id: "objetivos",   label: "Objetivos do Mês",             icon: icons.targetSm,  color: "#16309e", defaultOn: true,  requiresFeature: "objetivos" },
  { id: "planeamento", label: "Planeamento Semanal",          icon: icons.plan,      color: "#0f766e", defaultOn: true  },
  { id: "atalhos",     label: "Atalhos Rápidos",              icon: icons.shortcuts, color: "#b45309", defaultOn: true  },
  { id: "material",    label: "Material em atraso",           icon: icons.material,  color: "#dc2626", defaultOn: true  },
];

const DEFAULT_ORDER: WidgetId[] = ["os", "objetivos", "planeamento", "atalhos", "material"];

function loadConfig(userId: string, availableFeatures: Set<string>): WidgetId[] {
  try {
    const raw = localStorage.getItem(`hc-widgets-${userId}`);
    if (raw) {
      const parsed: WidgetId[] = JSON.parse(raw);
      // Filtra widgets cujas features estão disponíveis
      return parsed.filter((id) => {
        const meta = WIDGET_REGISTRY.find((w) => w.id === id);
        if (!meta) return false;
        if (meta.requiresFeature && !availableFeatures.has(meta.requiresFeature)) return false;
        return true;
      });
    }
  } catch { /* ignore */ }
  // Default: todos os widgets disponíveis na ordem padrão
  return DEFAULT_ORDER.filter((id) => {
    const meta = WIDGET_REGISTRY.find((w) => w.id === id);
    if (!meta) return false;
    if (meta.requiresFeature && !availableFeatures.has(meta.requiresFeature)) return false;
    return true;
  });
}

function saveConfig(userId: string, order: WidgetId[]) {
  try {
    localStorage.setItem(`hc-widgets-${userId}`, JSON.stringify(order));
  } catch { /* ignore */ }
}

// ── Widgets ───────────────────────────────────────────────────────────────────

function WidgetOS() {
  const [list, setList] = useState<OSItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<OSItem[]>("/service-orders?status=NAO_INICIADA,EM_PRODUCAO")
      .then((r) => setList((r ?? []).slice(0, 8)))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="hw-body">
      {loading ? <p className="hw-load">A carregar…</p>
      : list.length === 0 ? <p className="hw-empty">Sem ordens de serviço pendentes.</p>
      : (
        <ul className="hw-os-list">
          {list.map((os) => {
            const days = daysLeft(os.deadlineAt);
            const urgent = os.priority === "CRITICA" || os.priority === "ALTA" || (days != null && days <= 2);
            return (
              <li key={os.id}>
                <Link to={`/ordens-servico/${os.id}`} className={`hw-os-row${urgent ? " hw-os-row--urgent" : ""}`}>
                  <span className="hw-os-code">{os.externalId}</span>
                  <span className="hw-os-client">{os.client?.name ?? "—"}</span>
                  <span className="hw-os-right">
                    {os.priorityLabel && (
                      <span className="hw-os-badge" style={{ background: (os.priorityColor ?? "#6b7280") + "22", color: os.priorityColor ?? "#6b7280" }}>
                        {urgent ? icons.alert : icons.clock}
                        {os.priorityLabel}
                      </span>
                    )}
                    {days != null && (
                      <span className={`hw-os-days${days <= 0 ? " hw-os-days--late" : days <= 2 ? " hw-os-days--warn" : ""}`}>
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
    </div>
  );
}

function WidgetObjetivos() {
  const [obj, setObj] = useState<ObjSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const now = new Date();

  useEffect(() => {
    api.get<ObjSummary>(`/objetivos/resumo?periodType=MES&year=${now.getFullYear()}&period=${now.getMonth() + 1}`)
      .then((r) => setObj(r))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fatPct = obj ? pct(obj.faturacao.actual, obj.faturacao.target) : null;
  const encPct = obj ? pct(obj.encomendas.actual, obj.encomendas.target) : null;

  return (
    <div className="hw-body">
      {loading ? <p className="hw-load">A carregar…</p>
      : !obj ? <p className="hw-empty">Sem dados para este mês.</p>
      : (
        <div className="hw-obj-rows">
          {[
            { label: "Faturação",  data: obj.faturacao,  p: fatPct, c: "#1d4ed8" },
            { label: "Encomendas", data: obj.encomendas, p: encPct, c: "#0f766e" },
          ].map(({ label, data, p, c }) => (
            <div key={label} className="hw-obj-row">
              <div className="hw-obj-labels">
                <span className="hw-obj-name">{label}</span>
                <span className="hw-obj-vals">
                  <strong>{fmt(data.actual)}</strong>
                  {data.target && <span className="hw-obj-of"> / {fmt(data.target)}</span>}
                </span>
              </div>
              {data.target && (
                <div className="hw-bar-wrap">
                  <div className="hw-bar" style={{ "--p": `${Math.min(p ?? 0, 100)}%`, "--c": p != null && p >= 100 ? "#16a34a" : c } as React.CSSProperties} />
                  {data.expectedByNow != null && (
                    <div className="hw-bar-pace" style={{ left: `${Math.min(Math.round((data.expectedByNow / data.target) * 100), 100)}%` }} title="Ritmo esperado" />
                  )}
                </div>
              )}
              {p != null && <span className={`hw-pct${p >= 100 ? " hw-pct--ok" : ""}`}>{p}%</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WidgetPlaneamento() {
  const [data, setData] = useState<WeekData | null>(null);
  const [loading, setLoading] = useState(true);
  const now = new Date();
  const start = mondayOf(now);

  useEffect(() => {
    api.get<WeekData>(`/planeamento/week?start=${start}`)
      .then((r) => setData(r))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const today = now.toISOString().slice(0, 10);
  const todayItems = data?.items.filter((i) => i.date === today) ?? [];
  const pending    = todayItems.filter((i) => !i.done);
  const done       = todayItems.filter((i) => i.done);

  return (
    <div className="hw-body">
      {loading ? <p className="hw-load">A carregar…</p>
      : (
        <>
          <p className="hw-plan-summary">
            Hoje: <strong>{pending.length} por fazer</strong>{done.length > 0 ? `, ${done.length} concluídos` : ""}
          </p>
          {pending.length === 0 && done.length === 0 ? (
            <p className="hw-empty">Nada planeado para hoje.</p>
          ) : (
            <ul className="hw-plan-list">
              {[...pending, ...done].slice(0, 6).map((item) => (
                <li key={item.id} className={`hw-plan-item${item.done ? " hw-plan-item--done" : ""}`}>
                  <span className="hw-plan-check">{item.done ? icons.check : <span className="hw-plan-dot"/>}</span>
                  <span className="hw-plan-title">
                    {item.serviceOrder
                      ? <><strong>{item.serviceOrder.externalId}</strong> · {item.serviceOrder.client}</>
                      : item.title ?? item.kind}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

const ATALHOS = [
  { label: "Ordens de Serviço", to: "/ordens-servico",  color: "#1d4ed8" },
  { label: "Orçamentos",        to: "/orcamentos",       color: "#b45309" },
  { label: "Planeamento",       to: "/planeamento",      color: "#0f766e" },
  { label: "Materiais",         to: "/pedidos-material", color: "#7c3aed" },
  { label: "Horas",             to: "/controlo-horas",   color: "#be185d" },
  { label: "Clientes",          to: "/clientes",         color: "#0369a1" },
];

function WidgetAtalhos() {
  return (
    <div className="hw-body">
      <div className="hw-atalhos">
        {ATALHOS.map((a) => (
          <Link key={a.to} to={a.to} className="hw-atalho" style={{ "--ac": a.color } as React.CSSProperties}>
            {a.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function WidgetMaterial() {
  const [list, setList] = useState<MaterialRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<MaterialRequest[]>("/material-requests")
      .then((r) => {
        // Materiais pedidos há mais de 7 dias e ainda não recebidos
        const cutoff = Date.now() - 7 * 86400000;
        const overdue = (r ?? [])
          .filter((m) => m.status !== "RECEBIDO" && new Date(m.createdAt).getTime() < cutoff)
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
          .slice(0, 6);
        setList(overdue);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="hw-body">
      {loading ? <p className="hw-load">A carregar…</p>
      : list.length === 0 ? <p className="hw-empty">Sem materiais em atraso.</p>
      : (
        <ul className="hw-mat-list">
          {list.map((m) => {
            const daysOld = Math.floor((Date.now() - new Date(m.createdAt).getTime()) / 86400000);
            return (
              <li key={m.id} className="hw-mat-row">
                <span className="hw-mat-desc">{m.description}</span>
                <span className="hw-mat-right">
                  {m.supplier && <span className="hw-mat-sup">{m.supplier.name}</span>}
                  <span className="hw-mat-age hw-mat-age--late">{daysOld}d</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Widget wrapper com drag & drop ────────────────────────────────────────────

interface WidgetProps {
  id: WidgetId;
  meta: WidgetMeta;
  customizing: boolean;
  onRemove: (id: WidgetId) => void;
  onDragStart: (id: WidgetId) => void;
  onDragOver: (id: WidgetId) => void;
  onDrop: () => void;
  isDragOver: boolean;
  linkTo: string;
}

const WIDGET_LINKS: Record<WidgetId, string> = {
  os:          "/ordens-servico",
  objetivos:   "/objetivos",
  planeamento: "/planeamento",
  atalhos:     "",
  material:    "/pedidos-material",
};

const WIDGET_TITLES: Record<WidgetId, string> = {
  os:          "Ordens de Serviço pendentes",
  objetivos:   "", // dinâmico
  planeamento: "Planeamento — hoje",
  atalhos:     "Atalhos Rápidos",
  material:    "Material em atraso",
};

function Widget({ id, meta, customizing, onRemove, onDragStart, onDragOver, onDrop, isDragOver }: WidgetProps) {
  const now = new Date();
  const title = id === "objetivos"
    ? `Objetivos — ${now.toLocaleString("pt-PT", { month: "long" })}`
    : WIDGET_TITLES[id];
  const link = WIDGET_LINKS[id];

  return (
    <section
      className={`hw${isDragOver ? " hw--drop-target" : ""}${customizing ? " hw--customizing" : ""}`}
      aria-labelledby={`hw-title-${id}`}
      draggable={customizing}
      onDragStart={() => onDragStart(id)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(id); }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
    >
      <div className="hw-head">
        {customizing && <span className="hw-drag-handle" title="Arrastar">{icons.drag}</span>}
        <span className="hw-head-ico" style={{ color: meta.color }}>{meta.icon}</span>
        <h2 id={`hw-title-${id}`}>{title}</h2>
        {link && !customizing && (
          <Link to={link} className="hw-head-link">Ver tudo {icons.arrow}</Link>
        )}
        {customizing && (
          <button className="hw-remove-btn" onClick={() => onRemove(id)} title="Remover widget" aria-label={`Remover ${meta.label}`}>
            {icons.close}
          </button>
        )}
      </div>
      {id === "os"          && <WidgetOS />}
      {id === "objetivos"   && <WidgetObjetivos />}
      {id === "planeamento" && <WidgetPlaneamento />}
      {id === "atalhos"     && <WidgetAtalhos />}
      {id === "material"    && <WidgetMaterial />}
    </section>
  );
}

// ── Painel de personalização ──────────────────────────────────────────────────

interface CustomizePanelProps {
  activeIds: WidgetId[];
  availableFeatures: Set<string>;
  onAdd: (id: WidgetId) => void;
  onClose: () => void;
}

function CustomizePanel({ activeIds, availableFeatures, onAdd, onClose }: CustomizePanelProps) {
  const available = WIDGET_REGISTRY.filter((w) => {
    if (w.requiresFeature && !availableFeatures.has(w.requiresFeature)) return false;
    return !activeIds.includes(w.id);
  });

  return (
    <div className="hc-customize-panel">
      <div className="hc-customize-header">
        <h3>Adicionar widget</h3>
        <button className="hc-customize-close" onClick={onClose} aria-label="Fechar">{icons.close}</button>
      </div>
      {available.length === 0 ? (
        <p className="hc-customize-empty">Todos os widgets estão ativos.</p>
      ) : (
        <ul className="hc-customize-list">
          {available.map((w) => (
            <li key={w.id}>
              <button className="hc-customize-item" onClick={() => onAdd(w.id)}>
                <span className="hc-customize-ico" style={{ color: w.color }}>{w.icon}</span>
                <span className="hc-customize-label">{w.label}</span>
                <span className="hc-customize-add">{icons.plus}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

interface Dept { key: string; label: string; to: string; icon: React.ReactNode; color: string; soft: string; dashed?: boolean }

export function HomepageCentral() {
  const { user } = useAuth();
  const objetivos = useFeature("objetivos");

  const firstName = user?.name?.split(" ")[0];

  const availableFeatures = new Set<string>(objetivos.available ? ["objetivos"] : []);

  const [widgetOrder, setWidgetOrder] = useState<WidgetId[]>(() =>
    loadConfig(user?.id ?? "anon", availableFeatures)
  );
  const [customizing, setCustomizing] = useState(false);
  const [showAddPanel, setShowAddPanel] = useState(false);

  // Drag state
  const dragId = useRef<WidgetId | null>(null);
  const [dragOverId, setDragOverId] = useState<WidgetId | null>(null);

  const persistOrder = useCallback((order: WidgetId[]) => {
    setWidgetOrder(order);
    saveConfig(user?.id ?? "anon", order);
  }, [user?.id]);

  const handleDragStart = (id: WidgetId) => { dragId.current = id; };
  const handleDragOver  = (id: WidgetId) => { setDragOverId(id); };
  const handleDrop      = () => {
    if (!dragId.current || dragId.current === dragOverId) { setDragOverId(null); return; }
    const from = widgetOrder.indexOf(dragId.current);
    const to   = dragOverId ? widgetOrder.indexOf(dragOverId) : widgetOrder.length - 1;
    if (from < 0 || to < 0) return;
    const next = [...widgetOrder];
    next.splice(from, 1);
    next.splice(to, 0, dragId.current);
    persistOrder(next);
    dragId.current = null;
    setDragOverId(null);
  };

  const handleRemove = (id: WidgetId) => persistOrder(widgetOrder.filter((w) => w !== id));
  const handleAdd    = (id: WidgetId) => { persistOrder([...widgetOrder, id]); };

  const depts: Dept[] = [
    { key: "producao",       label: "Produção",      to: "/ordens-servico", icon: icons.producao,  color: "#1d4ed8", soft: "#e8eeff" },
    { key: "administrativo", label: "Administrativo", to: "/controlo-horas", icon: icons.admin,     color: "#be185d", soft: "#fce7f3" },
    { key: "financeiro",     label: "Financeiro",     to: "/financeiro",     icon: icons.financeiro, color: "#0f766e", soft: "#ccfbf1" },
    { key: "comercial",      label: "Comercial",      to: "/orcamentos",     icon: icons.comercial,  color: "#b45309", soft: "#fef3c7" },
    ...(objetivos.available ? [{ key: "objetivos", label: "Objetivos", to: "/objetivos", icon: icons.objetivos, color: "#16309e", soft: "#eef1ff", dashed: true }] : []),
  ];

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

      {/* ── Barra de widgets ── */}
      <div className="hc-toolbar">
        <span className="hc-toolbar-title">Os meus widgets</span>
        <div className="hc-toolbar-actions">
          {customizing && (
            <button className="hc-btn hc-btn--add" onClick={() => setShowAddPanel((v) => !v)}>
              {icons.plus} Adicionar
            </button>
          )}
          <button
            className={`hc-btn${customizing ? " hc-btn--active" : ""}`}
            onClick={() => { setCustomizing((v) => !v); setShowAddPanel(false); }}
          >
            {icons.settings}
            {customizing ? "Concluir" : "Personalizar"}
          </button>
        </div>
      </div>

      {/* ── Painel de adicionar ── */}
      {showAddPanel && (
        <CustomizePanel
          activeIds={widgetOrder}
          availableFeatures={availableFeatures}
          onAdd={(id) => { handleAdd(id); setShowAddPanel(false); }}
          onClose={() => setShowAddPanel(false)}
        />
      )}

      {/* ── Instrução de drag ── */}
      {customizing && (
        <p className="hc-drag-hint">Arrasta os painéis para os reordenar. Clica em × para remover.</p>
      )}

      {/* ── Grelha de widgets ── */}
      {widgetOrder.length === 0 ? (
        <div className="hc-widgets-empty">
          <p>Não tens nenhum widget ativo.</p>
          <button className="hc-btn hc-btn--add" onClick={() => { setCustomizing(true); setShowAddPanel(true); }}>
            {icons.plus} Adicionar widget
          </button>
        </div>
      ) : (
        <div className="hc-grid">
          {widgetOrder.map((id) => {
            const meta = WIDGET_REGISTRY.find((w) => w.id === id)!;
            return (
              <Widget
                key={id}
                id={id}
                meta={meta}
                customizing={customizing}
                onRemove={handleRemove}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                isDragOver={dragOverId === id}
                linkTo={WIDGET_LINKS[id]}
              />
            );
          })}
        </div>
      )}

      <style>{`
        /* ── Layout base ── */
        .hc { display:flex; flex-direction:column; gap:24px; padding:40px 32px 64px; max-width:1200px; margin:0 auto; box-sizing:border-box; }

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

        /* ── Toolbar ── */
        .hc-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; }
        .hc-toolbar-title { font-size:.82rem; font-weight:600; color:var(--fg-muted,#6b7280); text-transform:uppercase; letter-spacing:.05em; }
        .hc-toolbar-actions { display:flex; align-items:center; gap:8px; }
        .hc-btn {
          display:inline-flex; align-items:center; gap:6px; padding:7px 14px;
          font-size:.82rem; font-weight:600; border-radius:8px; cursor:pointer;
          border:1.5px solid var(--border,#d1d5db); background:var(--surface,#fff);
          color:var(--fg,#111827); transition:background .1s, border-color .1s;
        }
        .hc-btn:hover { background:var(--surface-hover,#f9fafb); border-color:#9ca3af; }
        .hc-btn--active { background:var(--fg,#111827); color:var(--surface,#fff); border-color:var(--fg,#111827); }
        .hc-btn--active:hover { background:color-mix(in srgb,var(--fg,#111827) 85%,transparent); }
        .hc-btn--add { border-color:#1d4ed8; color:#1d4ed8; }
        .hc-btn--add:hover { background:#eff6ff; }

        /* ── Hint drag ── */
        .hc-drag-hint { margin:0; font-size:.82rem; color:var(--fg-muted,#9ca3af); text-align:center; }

        /* ── Painel de personalização ── */
        .hc-customize-panel { background:var(--surface,#fff); border:1.5px solid var(--border,#e5e7eb); border-radius:12px; padding:16px 20px; }
        .hc-customize-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
        .hc-customize-header h3 { margin:0; font-size:.9rem; font-weight:600; color:var(--fg,#111827); }
        .hc-customize-close { background:none; border:none; cursor:pointer; color:var(--fg-muted,#6b7280); display:flex; padding:2px; border-radius:4px; }
        .hc-customize-close:hover { color:var(--fg,#111827); }
        .hc-customize-empty { margin:0; font-size:.85rem; color:var(--fg-muted,#9ca3af); }
        .hc-customize-list { list-style:none; margin:0; padding:0; display:flex; flex-wrap:wrap; gap:8px; }
        .hc-customize-item {
          display:inline-flex; align-items:center; gap:8px; padding:8px 14px;
          background:var(--surface-hover,#f9fafb); border:1.5px solid var(--border,#e5e7eb);
          border-radius:10px; cursor:pointer; font-size:.85rem; color:var(--fg,#111827);
          transition:border-color .1s, background .1s;
        }
        .hc-customize-item:hover { border-color:#1d4ed8; background:#eff6ff; }
        .hc-customize-ico { display:flex; }
        .hc-customize-add { color:#1d4ed8; display:flex; margin-left:4px; }

        /* ── Grelha de widgets ── */
        .hc-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:18px; align-items:start; }
        .hc-widgets-empty { display:flex; flex-direction:column; align-items:center; gap:14px; padding:48px; border:2px dashed var(--border,#e5e7eb); border-radius:14px; }
        .hc-widgets-empty p { margin:0; color:var(--fg-muted,#9ca3af); font-size:.9rem; }

        /* ── Widget ── */
        .hw {
          background:var(--surface,#fff); border:1.5px solid var(--border,#e5e7eb);
          border-radius:14px; padding:18px 20px 20px; display:flex; flex-direction:column; gap:12px;
          transition:border-color .15s, box-shadow .15s;
        }
        .hw--drop-target { border-color:#1d4ed8; box-shadow:0 0 0 2px #1d4ed822; }
        .hw--customizing { cursor:grab; border-style:dashed; }
        .hw--customizing:active { cursor:grabbing; }

        /* ── Widget head ── */
        .hw-head { display:flex; align-items:center; gap:8px; }
        .hw-drag-handle { display:flex; color:var(--fg-muted,#9ca3af); cursor:grab; flex-shrink:0; }
        .hw-head-ico { display:flex; flex-shrink:0; }
        .hw-head h2 { margin:0; font-size:.93rem; font-weight:600; color:var(--fg,#111827); flex:1; }
        .hw-head-link { font-size:.8rem; color:var(--fg-muted,#6b7280); text-decoration:none; display:flex; align-items:center; gap:4px; white-space:nowrap; flex-shrink:0; }
        .hw-head-link:hover { color:var(--fg,#111827); }
        .hw-remove-btn {
          background:none; border:none; cursor:pointer; display:flex; padding:3px;
          color:var(--fg-muted,#9ca3af); border-radius:5px; flex-shrink:0;
        }
        .hw-remove-btn:hover { background:#fee2e2; color:#dc2626; }

        /* ── Widget body ── */
        .hw-body { display:flex; flex-direction:column; gap:8px; }
        .hw-load, .hw-empty { margin:0; font-size:.85rem; color:var(--fg-muted,#9ca3af); }

        /* ── OS widget ── */
        .hw-os-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:3px; }
        .hw-os-row {
          display:grid; grid-template-columns:auto 1fr auto;
          align-items:center; gap:10px; padding:7px 9px; border-radius:8px;
          text-decoration:none; background:transparent; transition:background .1s;
        }
        .hw-os-row:hover { background:var(--surface-hover,#f9fafb); }
        .hw-os-row--urgent { background:color-mix(in srgb,#ef4444 6%,transparent); }
        .hw-os-row--urgent:hover { background:color-mix(in srgb,#ef4444 10%,transparent); }
        .hw-os-code   { font-size:.79rem; font-weight:700; color:var(--fg,#111827); font-variant-numeric:tabular-nums; white-space:nowrap; }
        .hw-os-client { font-size:.82rem; color:var(--fg-muted,#6b7280); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .hw-os-right  { display:flex; align-items:center; gap:5px; }
        .hw-os-badge  { display:flex; align-items:center; gap:3px; font-size:.7rem; font-weight:600; padding:2px 6px; border-radius:999px; }
        .hw-os-days   { font-size:.74rem; font-variant-numeric:tabular-nums; color:var(--fg-muted,#6b7280); white-space:nowrap; }
        .hw-os-days--warn { color:#b45309; font-weight:600; }
        .hw-os-days--late { color:#dc2626; font-weight:700; }

        /* ── Objetivos widget ── */
        .hw-obj-rows { display:flex; flex-direction:column; gap:14px; }
        .hw-obj-row  { display:flex; flex-direction:column; gap:5px; }
        .hw-obj-labels { display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
        .hw-obj-name { font-size:.82rem; color:var(--fg-muted,#6b7280); }
        .hw-obj-vals strong { font-size:.9rem; color:var(--fg,#111827); }
        .hw-obj-of { font-size:.8rem; color:var(--fg-muted,#6b7280); }
        .hw-bar-wrap { position:relative; height:6px; background:var(--border,#e5e7eb); border-radius:4px; overflow:visible; }
        .hw-bar { position:absolute; inset:0; width:var(--p,0%); background:var(--c,#1d4ed8); border-radius:4px; transition:width .4s; }
        .hw-bar-pace { position:absolute; top:-3px; width:2px; height:12px; background:#f59e0b; border-radius:2px; transform:translateX(-50%); }
        .hw-pct { font-size:.78rem; font-weight:600; color:var(--fg-muted,#6b7280); text-align:right; }
        .hw-pct--ok { color:#16a34a; }

        /* ── Planeamento widget ── */
        .hw-plan-summary { margin:0; font-size:.82rem; color:var(--fg-muted,#6b7280); }
        .hw-plan-summary strong { color:var(--fg,#111827); }
        .hw-plan-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:5px; }
        .hw-plan-item { display:flex; align-items:center; gap:8px; }
        .hw-plan-item--done .hw-plan-title { color:var(--fg-muted,#9ca3af); text-decoration:line-through; }
        .hw-plan-check { display:flex; color:#16a34a; flex-shrink:0; }
        .hw-plan-dot { display:block; width:8px; height:8px; border-radius:50%; background:var(--border,#d1d5db); margin:3px; }
        .hw-plan-title { font-size:.84rem; color:var(--fg,#111827); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

        /* ── Atalhos widget ── */
        .hw-atalhos { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
        .hw-atalho {
          display:flex; align-items:center; justify-content:center; text-align:center;
          padding:11px 8px; border-radius:10px; font-size:.8rem; font-weight:600;
          text-decoration:none; color:var(--ac); background:color-mix(in srgb,var(--ac) 10%,transparent);
          transition:background .1s, transform .1s;
        }
        .hw-atalho:hover { background:color-mix(in srgb,var(--ac) 20%,transparent); transform:translateY(-1px); }

        /* ── Material widget ── */
        .hw-mat-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:5px; }
        .hw-mat-row { display:flex; align-items:center; gap:10px; padding:5px 0; }
        .hw-mat-desc { font-size:.84rem; color:var(--fg,#111827); flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .hw-mat-right { display:flex; align-items:center; gap:6px; flex-shrink:0; }
        .hw-mat-sup { font-size:.75rem; color:var(--fg-muted,#6b7280); }
        .hw-mat-age { font-size:.74rem; font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap; }
        .hw-mat-age--late { color:#dc2626; }

        /* ── Dark mode ── */
        @media (prefers-color-scheme:dark) {
          .hc-head h1 { color:#f9fafb; }
          .hc-head p  { color:#9ca3af; }
          .hc-dept { background:color-mix(in srgb,var(--dc) 10%,#1e1e2e); }
          .hc-dept-label { color:color-mix(in srgb,var(--dc) 80%,#fff); }
          .hc-dept-icon  { color:color-mix(in srgb,var(--dc) 80%,#fff); background:color-mix(in srgb,var(--dc) 18%,transparent); }
          .hc-toolbar-title { color:#6b7280; }
          .hc-btn { background:#1e1e2e; border-color:#2d2d3f; color:#f9fafb; }
          .hc-btn:hover { background:#2a2a3e; }
          .hc-btn--active { background:#f9fafb; color:#111827; }
          .hc-customize-panel { background:#1e1e2e; border-color:#2d2d3f; }
          .hc-customize-header h3 { color:#f9fafb; }
          .hc-customize-item { background:#2a2a3e; border-color:#2d2d3f; color:#f9fafb; }
          .hc-customize-item:hover { border-color:#3b82f6; background:#1e3a5f; }
          .hw { background:#1e1e2e; border-color:#2d2d3f; }
          .hw--drop-target { border-color:#3b82f6; }
          .hw-head h2 { color:#f9fafb; }
          .hw-os-code { color:#f9fafb; }
          .hw-os-client { color:#9ca3af; }
          .hw-os-row:hover { background:#2a2a3e; }
          .hw-bar-wrap { background:#2d2d3f; }
          .hw-obj-vals strong { color:#f9fafb; }
          .hw-plan-title { color:#f9fafb; }
          .hw-plan-summary strong { color:#f9fafb; }
          .hw-mat-desc { color:#f9fafb; }
        }

        /* ── Responsivo ── */
        @media (max-width:700px) {
          .hc { padding:24px 16px 48px; gap:18px; }
          .hc-depts { grid-template-columns:repeat(2,1fr); }
          .hc-grid { grid-template-columns:1fr; }
          .hw-atalhos { grid-template-columns:repeat(2,1fr); }
        }
      `}</style>
    </div>
  );
}
