import { DragEvent, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api } from "../api/client";
import { useFeature } from "../contexts/FeaturesContext";
import { useTabTitle } from "../contexts/TabsContext";
import { FeatureTestBanner } from "../components/FeatureTestBanner";

// ============================================================================
// Planeamento semanal (pedido do utilizador de 2026-10-29: "prepara uma parte
// para planeamento semanal"). Ele escolheu planear tudo — OS por dia,
// colaboradores, entregas e lacagens, carrinhas/voltas — e "todos veem, o
// administrador edita".
//
//  - Semana de segunda a sábado (domingo aparece se tiver alguma coisa).
//  - À esquerda (administrador), as OS abertas para arrastar para um dia.
//  - Em cada dia, além do que é marcado, aparecem sozinhos os prazos das OS
//    e as voltas da lacagem previstas.
//  - Por baixo, a mesma semana vista por colaborador e por carrinha.
// Em teste: "planeamento".
// ============================================================================

type Kind = "OS" | "ENTREGA" | "ENVIO_LACAGEM" | "RECOLHA_LACAGEM" | "OUTRO";

const KIND: Record<Kind, { label: string; color: string; soft: string }> = {
  OS: { label: "Produção", color: "#1d4ed8", soft: "#e8eeff" },
  ENTREGA: { label: "Entrega", color: "#15803d", soft: "#e6f6ec" },
  ENVIO_LACAGEM: { label: "Enviar p/ lacar", color: "#c2410c", soft: "#fdeee5" },
  RECOLHA_LACAGEM: { label: "Recolher lacagem", color: "#7c3aed", soft: "#f1eafe" },
  OUTRO: { label: "Outro", color: "#475467", soft: "#eef0f3" },
};
const KIND_ORDER: Kind[] = ["OS", "ENTREGA", "ENVIO_LACAGEM", "RECOLHA_LACAGEM", "OUTRO"];

interface OpenOrder {
  id: string;
  externalId: string;
  status: string;
  client: string;
  product: string;
  category: string | null;
  finish: string | null;
  stage: string | null;
  stageSupplier: string | null;
  stageSupplierId: string | null;
  deadlineAt: string | null;
  expectedReturnAt: string | null;
  priority: string | null;
  priorityLabel: string | null;
  priorityColor: string | null;
}

interface PlanItem {
  id: string;
  date: string;
  kind: Kind;
  title: string | null;
  serviceOrderId: string | null;
  supplierId: string | null;
  colaboradorIds: string[];
  vehicleId: string | null;
  driverId: string | null;
  period: string | null;
  notes: string | null;
  done: boolean;
  position: number;
  serviceOrder: {
    id: string;
    externalId: string;
    client: string;
    product: string;
    stage: string | null;
    finish: string | null;
    status: string;
    priorityColor: string | null;
    deadlineAt: string | null;
  } | null;
}

interface WeekData {
  weekStart: string;
  canEdit: boolean;
  items: PlanItem[];
  openOrders: OpenOrder[];
  colaboradores: { id: string; name: string; funcao: string | null }[];
  vehicles: { id: string; plate: string; name: string | null; defaultDriverId: string | null }[];
  suppliers: { id: string; name: string }[];
}

type Draft = {
  id?: string;
  date: string;
  kind: Kind;
  title: string;
  serviceOrderId: string;
  supplierId: string;
  colaboradorIds: string[];
  vehicleId: string;
  driverId: string;
  period: string;
  notes: string;
  done: boolean;
};

const DAY_NAMES = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

function isoToday() {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
}
function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("pt-PT", { day: "numeric", month: "short", timeZone: "UTC" }).replace(".", "");
/** Dia (AAAA-MM-DD, hora de Lisboa) de um instante ISO. */
function localDay(isoInstant: string) {
  return new Date(isoInstant).toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });
}

const emptyDraft = (date: string, kind: Kind = "OS"): Draft => ({
  date,
  kind,
  title: "",
  serviceOrderId: "",
  supplierId: "",
  colaboradorIds: [],
  vehicleId: "",
  driverId: "",
  period: "",
  notes: "",
  done: false,
});

export function PlaneamentoPage() {
  const feature = useFeature("planeamento");
  useTabTitle("Planeamento Semanal");
  const [weekStart, setWeekStart] = useState(() => {
    const t = isoToday();
    const dow = (new Date(`${t}T00:00:00Z`).getUTCDay() + 6) % 7;
    return addDays(t, -dow);
  });
  const [data, setData] = useState<WeekData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [search, setSearch] = useState("");
  const [sideFilter, setSideFilter] = useState<"todas" | "atrasadas" | "lacagem" | "naoplaneadas">("naoplaneadas");
  const [dragOver, setDragOver] = useState<string | null>(null);

  async function load(start = weekStart) {
    setError(null);
    try {
      const d = await api.get<WeekData>(`/planeamento/week?start=${start}`);
      setData(d);
      if (d.weekStart !== start) setWeekStart(d.weekStart);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar o planeamento.");
    }
  }
  useEffect(() => {
    if (feature.available) load(weekStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, feature.available]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const canEdit = !!data?.canEdit;
  const colabName = useMemo(() => new Map((data?.colaboradores ?? []).map((c) => [c.id, c.name])), [data]);
  const vehicleName = useMemo(
    () => new Map((data?.vehicles ?? []).map((v) => [v.id, v.name ? `${v.name} (${v.plate})` : v.plate])),
    [data]
  );
  const supplierName = useMemo(() => new Map((data?.suppliers ?? []).map((s) => [s.id, s.name])), [data]);
  const plannedOs = useMemo(() => {
    const m = new Map<string, string[]>();
    (data?.items ?? []).forEach((i) => {
      if (!i.serviceOrderId) return;
      m.set(i.serviceOrderId, [...(m.get(i.serviceOrderId) ?? []), i.date]);
    });
    return m;
  }, [data]);

  if (feature.loading) return <div className="muted">A carregar...</div>;
  if (!feature.available) return <Navigate to="/" replace />;

  const itemsOf = (day: string) => (data?.items ?? []).filter((i) => i.date === day);
  const showSunday = itemsOf(days[6]).length > 0;
  const visibleDays = showSunday ? days : days.slice(0, 6);
  const today = isoToday();

  const deadlinesOf = (day: string) => (data?.openOrders ?? []).filter((o) => o.deadlineAt && localDay(o.deadlineAt) === day);
  const returnsOf = (day: string) => (data?.openOrders ?? []).filter((o) => o.expectedReturnAt && localDay(o.expectedReturnAt) === day);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro.");
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------- arrastar
  function onDragStartItem(e: DragEvent, id: string) {
    e.dataTransfer.setData("text/plain", `item:${id}`);
    e.dataTransfer.effectAllowed = "move";
  }
  function onDragStartOs(e: DragEvent, id: string) {
    e.dataTransfer.setData("text/plain", `os:${id}`);
    e.dataTransfer.effectAllowed = "copy";
  }
  function onDrop(e: DragEvent, day: string) {
    e.preventDefault();
    setDragOver(null);
    if (!canEdit) return;
    const v = e.dataTransfer.getData("text/plain");
    if (v.startsWith("item:")) {
      const id = v.slice(5);
      const it = data?.items.find((x) => x.id === id);
      if (!it || it.date === day) return;
      run(() => api.post(`/planeamento/items/${id}/move`, { date: day }));
    } else if (v.startsWith("os:")) {
      const o = data?.openOrders.find((x) => x.id === v.slice(3));
      if (!o) return;
      // Em lacagem: o natural é ir buscá-la; senão, trabalhá-la.
      const kind: Kind = o.stage === "Lacagem" ? "RECOLHA_LACAGEM" : "OS";
      run(() =>
        api.post("/planeamento/items", {
          date: day,
          kind,
          serviceOrderId: o.id,
          supplierId: kind === "RECOLHA_LACAGEM" ? o.stageSupplierId : null,
          colaboradorIds: [],
        })
      );
    }
  }

  // ---------------------------------------------------------------- editor
  function openNew(day: string, kind: Kind = "OS") {
    setDraft(emptyDraft(day, kind));
  }
  function openEdit(i: PlanItem) {
    if (!canEdit) return;
    setDraft({
      id: i.id,
      date: i.date,
      kind: i.kind,
      title: i.title ?? "",
      serviceOrderId: i.serviceOrderId ?? "",
      supplierId: i.supplierId ?? "",
      colaboradorIds: i.colaboradorIds,
      vehicleId: i.vehicleId ?? "",
      driverId: i.driverId ?? "",
      period: i.period ?? "",
      notes: i.notes ?? "",
      done: i.done,
    });
  }
  async function saveDraft() {
    if (!draft) return;
    const body = {
      date: draft.date,
      kind: draft.kind,
      title: draft.title.trim() || null,
      serviceOrderId: draft.serviceOrderId || null,
      supplierId: draft.supplierId || null,
      colaboradorIds: draft.colaboradorIds,
      vehicleId: draft.vehicleId || null,
      driverId: draft.driverId || null,
      period: draft.period.trim() || null,
      notes: draft.notes.trim() || null,
      done: draft.done,
    };
    setBusy(true);
    setError(null);
    try {
      if (draft.id) await api.put(`/planeamento/items/${draft.id}`, body);
      else await api.post("/planeamento/items", body);
      setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao guardar.");
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------- lado
  const sideOrders = (data?.openOrders ?? []).filter((o) => {
    const q = search.trim().toLowerCase();
    if (q && ![o.externalId, o.client, o.product, o.finish ?? "", o.stage ?? ""].some((v) => v.toLowerCase().includes(q))) return false;
    if (sideFilter === "atrasadas") return o.priority === "PRAZO_ULTRAPASSADO" || o.priority === "URGENTE";
    if (sideFilter === "lacagem") return o.stage === "Lacagem";
    if (sideFilter === "naoplaneadas") return !plannedOs.has(o.id);
    return true;
  });

  const weekLabel = `${dayLabel(days[0])} a ${dayLabel(days[5])} ${days[5].slice(0, 4)}`;

  // Quem / que carrinha faz o quê em cada dia (resumos por baixo).
  const shortLabel = (i: PlanItem) =>
    `${KIND[i.kind].label}: ${i.serviceOrder ? `OS ${i.serviceOrder.externalId}` : i.title ?? ""}${i.period ? ` (${i.period})` : ""}`;
  const peopleRows = (data?.colaboradores ?? [])
    .map((c) => ({ c, perDay: visibleDays.map((d) => itemsOf(d).filter((i) => i.colaboradorIds.includes(c.id) || i.driverId === c.id)) }))
    .filter((r) => r.perDay.some((x) => x.length));
  const vanRows = (data?.vehicles ?? [])
    .map((v) => ({ v, perDay: visibleDays.map((d) => itemsOf(d).filter((i) => i.vehicleId === v.id)) }))
    .filter((r) => r.perDay.some((x) => x.length));

  return (
    <div className="plan-page">
      <div className="page-header no-print">
        <h2>Planeamento Semanal</h2>
      </div>
      <div className="no-print">
        <FeatureTestBanner featureKey="planeamento" label="o Planeamento Semanal" />
      </div>

      <div className="card plan-toolbar">
        <div className="plan-week-nav">
          <button className="btn secondary no-print" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Semana anterior">
            ‹
          </button>
          <div className="plan-week-label">
            <strong>Semana de {weekLabel}</strong>
          </div>
          <button className="btn secondary no-print" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Semana seguinte">
            ›
          </button>
          <button
            className="btn secondary no-print"
            onClick={() => {
              const t = isoToday();
              setWeekStart(addDays(t, -((new Date(`${t}T00:00:00Z`).getUTCDay() + 6) % 7)));
            }}
          >
            Esta semana
          </button>
        </div>
        <div className="plan-legend">
          {KIND_ORDER.map((k) => (
            <span key={k} className="plan-legend-item">
              <i style={{ background: KIND[k].color }} /> {KIND[k].label}
            </span>
          ))}
        </div>
        <div className="plan-actions no-print">
          {canEdit && (
            <button
              className="btn secondary"
              disabled={busy || !data?.items.length}
              onClick={() => {
                if (window.confirm("Copiar tudo o que está nesta semana para a semana seguinte?"))
                  run(async () => {
                    await api.post("/planeamento/copy-week", { from: weekStart });
                    setWeekStart(addDays(weekStart, 7));
                  });
              }}
            >
              Copiar para a semana seguinte
            </button>
          )}
          <button className="btn secondary" onClick={() => window.print()}>
            Imprimir
          </button>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}
      {!data ? (
        <p className="muted">A carregar...</p>
      ) : (
        <div className={`plan-layout${canEdit ? " with-side" : ""}`}>
          {canEdit && (
            <aside className="card plan-side no-print">
              <div className="plan-side-head">
                <strong>OS abertas</strong>
                <span className="muted">arrasta para um dia</span>
              </div>
              <input type="text" placeholder="Procurar OS, cliente, produto…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="plan-side-filters">
                {(
                  [
                    ["naoplaneadas", "Por planear"],
                    ["atrasadas", "Atrasadas/urgentes"],
                    ["lacagem", "Na lacagem"],
                    ["todas", "Todas"],
                  ] as const
                ).map(([k, l]) => (
                  <button key={k} className={`plan-chip${sideFilter === k ? " on" : ""}`} onClick={() => setSideFilter(k)}>
                    {l}
                  </button>
                ))}
              </div>
              <div className="plan-side-list">
                {sideOrders.map((o) => (
                  <div key={o.id} className="plan-os" draggable onDragStart={(e) => onDragStartOs(e, o.id)} title="Arrasta para um dia">
                    <div className="plan-os-top">
                      <strong>{o.externalId}</strong>
                      {o.priorityColor && <span className="plan-dot" style={{ background: o.priorityColor }} title={o.priorityLabel ?? ""} />}
                      {o.deadlineAt && <span className="muted">prazo {dayLabel(localDay(o.deadlineAt))}</span>}
                    </div>
                    <div className="plan-os-client">{o.client}</div>
                    <div className="muted plan-os-sub">
                      {o.product}
                      {o.finish ? ` · ${o.finish}` : ""}
                      {o.stage ? ` · ${o.stage}${o.stageSupplier ? ` (${o.stageSupplier})` : ""}` : " · não iniciada"}
                    </div>
                    {plannedOs.has(o.id) && (
                      <div className="plan-os-planned">
                        Marcada: {plannedOs.get(o.id)!.map((d) => DAY_NAMES[(new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7].slice(0, 3)).join(", ")}
                      </div>
                    )}
                  </div>
                ))}
                {sideOrders.length === 0 && <p className="muted" style={{ fontSize: 13 }}>Nenhuma OS.</p>}
              </div>
            </aside>
          )}

          <div className="plan-week" style={{ gridTemplateColumns: `repeat(${visibleDays.length}, minmax(138px, 1fr))` }}>
            {visibleDays.map((day, idx) => {
              const list = itemsOf(day);
              const dl = deadlinesOf(day);
              const rt = returnsOf(day);
              return (
                <div
                  key={day}
                  className={`plan-day${day === today ? " today" : ""}${dragOver === day ? " over" : ""}`}
                  onDragOver={(e) => {
                    if (!canEdit) return;
                    e.preventDefault();
                    setDragOver(day);
                  }}
                  onDragLeave={() => setDragOver((d) => (d === day ? null : d))}
                  onDrop={(e) => onDrop(e, day)}
                >
                  <div className="plan-day-head">
                    <span>{DAY_NAMES[idx]}</span>
                    <span className="muted">{dayLabel(day)}</span>
                  </div>

                  {(dl.length > 0 || rt.length > 0) && (
                    <div className="plan-markers">
                      {dl.length > 0 && (
                        <div>
                          <b>Prazo:</b>{" "}
                          {dl.map((o, k) => (
                            <span key={o.id}>
                              {k > 0 && ", "}
                              <Link to={`/service-orders/${o.id}`} title={`${o.client} — ${o.product}`}>
                                {o.externalId}
                              </Link>
                            </span>
                          ))}
                        </div>
                      )}
                      {rt.length > 0 && (
                        <div>
                          <b>Volta da lacagem:</b>{" "}
                          {rt.map((o, k) => (
                            <span key={o.id}>
                              {k > 0 && ", "}
                              <Link to={`/service-orders/${o.id}`} title={`${o.client} — ${o.stageSupplier ?? ""}`}>
                                {o.externalId}
                              </Link>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {list.map((i) => {
                    const k = KIND[i.kind];
                    return (
                      <div
                        key={i.id}
                        className={`plan-card${i.done ? " done" : ""}${canEdit ? " editable" : ""}`}
                        style={{ borderLeftColor: k.color, background: k.soft }}
                        draggable={canEdit}
                        onDragStart={(e) => onDragStartItem(e, i.id)}
                        onClick={() => openEdit(i)}
                      >
                        <div className="plan-card-top">
                          <span className="plan-kind" style={{ color: k.color }}>
                            {k.label}
                          </span>
                          {i.period && <span className="plan-period">{i.period}</span>}
                          {canEdit && (
                            <input
                              type="checkbox"
                              className="no-print"
                              title="Feito"
                              checked={i.done}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => run(() => api.post(`/planeamento/items/${i.id}/move`, { done: e.target.checked }))}
                            />
                          )}
                        </div>
                        {i.serviceOrder ? (
                          <>
                            <div className="plan-card-title">
                              <Link to={`/service-orders/${i.serviceOrder.id}`} onClick={(e) => e.stopPropagation()}>
                                OS {i.serviceOrder.externalId}
                              </Link>{" "}
                              — {i.serviceOrder.client}
                            </div>
                            <div className="plan-card-sub">
                              {i.serviceOrder.product}
                              {i.serviceOrder.finish ? ` · ${i.serviceOrder.finish}` : ""}
                              {i.serviceOrder.stage ? ` · ${i.serviceOrder.stage}` : ""}
                            </div>
                            {i.title && <div className="plan-card-sub">{i.title}</div>}
                          </>
                        ) : (
                          <div className="plan-card-title">{i.title}</div>
                        )}
                        {i.supplierId && (i.kind === "ENVIO_LACAGEM" || i.kind === "RECOLHA_LACAGEM") && (
                          <div className="plan-card-sub">Lacador: {supplierName.get(i.supplierId) ?? "—"}</div>
                        )}
                        {i.colaboradorIds.length > 0 && (
                          <div className="plan-people">
                            {i.colaboradorIds.map((id) => (
                              <span key={id} className="plan-person">
                                {colabName.get(id) ?? "?"}
                              </span>
                            ))}
                          </div>
                        )}
                        {(i.vehicleId || i.driverId) && (
                          <div className="plan-card-sub">
                            Carrinha: {i.vehicleId ? vehicleName.get(i.vehicleId) ?? "—" : "—"}
                            {i.driverId ? ` · ${colabName.get(i.driverId) ?? "?"}` : ""}
                          </div>
                        )}
                        {i.notes && <div className="plan-card-notes">{i.notes}</div>}
                      </div>
                    );
                  })}
                  {list.length === 0 && dl.length === 0 && rt.length === 0 && <div className="plan-empty">—</div>}

                  {canEdit && (
                    <button className="plan-add no-print" onClick={() => openNew(day)}>
                      + Adicionar
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data && (peopleRows.length > 0 || vanRows.length > 0) && (
        <div className="plan-summaries">
          {peopleRows.length > 0 && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Por colaborador</h3>
              <SummaryTable
                head={visibleDays.map((d, i) => `${DAY_NAMES[i].slice(0, 3)} ${dayLabel(d)}`)}
                rows={peopleRows.map((r) => ({ label: r.c.name, cells: r.perDay.map((l) => l.map(shortLabel)) }))}
              />
            </div>
          )}
          {vanRows.length > 0 && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Carrinhas</h3>
              <SummaryTable
                head={visibleDays.map((d, i) => `${DAY_NAMES[i].slice(0, 3)} ${dayLabel(d)}`)}
                rows={vanRows.map((r) => ({
                  label: r.v.name ? `${r.v.name} (${r.v.plate})` : r.v.plate,
                  cells: r.perDay.map((l) => l.map((i) => `${shortLabel(i)}${i.driverId ? ` — ${colabName.get(i.driverId) ?? ""}` : ""}`)),
                }))}
              />
            </div>
          )}
        </div>
      )}

      {draft && data && (
        <ItemEditor
          draft={draft}
          setDraft={setDraft}
          data={data}
          days={days}
          busy={busy}
          onSave={saveDraft}
          onDelete={
            draft.id
              ? () => {
                  if (!window.confirm("Apagar esta marcação?")) return;
                  const id = draft.id!;
                  setDraft(null);
                  run(() => api.delete(`/planeamento/items/${id}`));
                }
              : undefined
          }
          onAdded={(patch) => setData((d) => (d ? { ...d, ...patch(d) } : d))}
        />
      )}
    </div>
  );
}

function SummaryTable({ head, rows }: { head: string[]; rows: { label: string; cells: string[][] }[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="plan-summary">
        <thead>
          <tr>
            <th />
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th>{r.label}</th>
              {r.cells.map((c, i) => (
                <td key={i}>
                  {c.map((t, k) => (
                    <div key={k}>{t}</div>
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ItemEditor({
  draft,
  setDraft,
  data,
  days,
  busy,
  onSave,
  onDelete,
  onAdded,
}: {
  draft: Draft;
  setDraft: (d: Draft | null) => void;
  data: WeekData;
  days: string[];
  busy: boolean;
  onSave: () => void;
  onDelete?: () => void;
  onAdded: (patch: (d: WeekData) => Partial<WeekData>) => void;
}) {
  const [osQuery, setOsQuery] = useState("");
  const [newPerson, setNewPerson] = useState("");
  const [newVan, setNewVan] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<Draft>) => setDraft({ ...draft, ...p });
  const lacagem = draft.kind === "ENVIO_LACAGEM" || draft.kind === "RECOLHA_LACAGEM";
  const transporte = draft.kind === "ENTREGA" || lacagem;

  const selectedOs = data.openOrders.find((o) => o.id === draft.serviceOrderId);
  const osOptions = data.openOrders.filter((o) => {
    const q = osQuery.trim().toLowerCase();
    return !q || [o.externalId, o.client, o.product].some((v) => v.toLowerCase().includes(q));
  });

  async function addPerson() {
    if (!newPerson.trim()) return;
    try {
      const c = await api.post<{ id: string; name: string; funcao: string | null }>("/planeamento/colaboradores", { name: newPerson.trim() });
      onAdded((d) => ({ colaboradores: [...d.colaboradores, c].sort((a, b) => a.name.localeCompare(b.name, "pt-PT")) }));
      set({ colaboradorIds: [...draft.colaboradorIds, c.id] });
      setNewPerson("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro.");
    }
  }
  async function addVan() {
    if (!newVan.trim()) return;
    try {
      const v = await api.post<{ id: string; plate: string; name: string | null; defaultDriverId: string | null }>("/planeamento/viaturas", {
        plate: newVan.trim(),
      });
      onAdded((d) => ({ vehicles: [...d.vehicles, v] }));
      set({ vehicleId: v.id });
      setNewVan("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro.");
    }
  }

  return (
    <div className="plan-modal-backdrop no-print" onClick={() => setDraft(null)}>
      <div className="plan-modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{draft.id ? "Editar marcação" : "Nova marcação"}</h3>

        <div className="plan-kinds">
          {KIND_ORDER.map((k) => (
            <button
              key={k}
              type="button"
              className={`plan-chip${draft.kind === k ? " on" : ""}`}
              style={draft.kind === k ? { background: KIND[k].color, borderColor: KIND[k].color, color: "#fff" } : undefined}
              onClick={() => set({ kind: k })}
            >
              {KIND[k].label}
            </button>
          ))}
        </div>

        <div className="plan-form-grid">
          <label className="field">
            Dia
            <select value={draft.date} onChange={(e) => set({ date: e.target.value })}>
              {days.map((d, i) => (
                <option key={d} value={d}>
                  {DAY_NAMES[i]} {dayLabel(d)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Período / hora
            <input list="plan-periods" value={draft.period} onChange={(e) => set({ period: e.target.value })} placeholder="Manhã, Tarde, 09:30…" />
            <datalist id="plan-periods">
              <option value="Manhã" />
              <option value="Tarde" />
              <option value="Dia todo" />
            </datalist>
          </label>
        </div>

        {draft.kind !== "OUTRO" && (
          <div className="field">
            <span>Ordem de Serviço{draft.kind === "OS" ? "" : " (opcional)"}</span>
            {selectedOs ? (
              <div className="plan-selected-os">
                <strong>{selectedOs.externalId}</strong> — {selectedOs.client}
                <span className="muted"> · {selectedOs.product}{selectedOs.stage ? ` · ${selectedOs.stage}` : ""}</span>
                <button type="button" className="link-button" onClick={() => set({ serviceOrderId: "" })}>
                  trocar
                </button>
              </div>
            ) : (
              <>
                <input value={osQuery} onChange={(e) => setOsQuery(e.target.value)} placeholder="Procurar nº da OS, cliente ou produto…" />
                <div className="plan-os-pick">
                  {osOptions.slice(0, 40).map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() =>
                        set({
                          serviceOrderId: o.id,
                          supplierId: lacagem && !draft.supplierId ? o.stageSupplierId ?? "" : draft.supplierId,
                        })
                      }
                    >
                      <strong>{o.externalId}</strong> — {o.client} <span className="muted">· {o.product}</span>
                    </button>
                  ))}
                  {osOptions.length === 0 && <div className="muted" style={{ padding: 6 }}>Nenhuma OS aberta encontrada.</div>}
                </div>
              </>
            )}
          </div>
        )}

        <label className="field">
          {draft.kind === "OUTRO" ? "O que é para fazer" : "Descrição (opcional)"}
          <input value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder={draft.kind === "ENTREGA" ? "ex.: entregar em Ponte de Lima" : ""} />
        </label>

        {lacagem && (
          <label className="field">
            Lacador
            <select value={draft.supplierId} onChange={(e) => set({ supplierId: e.target.value })}>
              <option value="">—</option>
              {data.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="field">
          <span>Colaboradores</span>
          <div className="plan-people-pick">
            {data.colaboradores.map((c) => {
              const on = draft.colaboradorIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`plan-chip${on ? " on" : ""}`}
                  onClick={() => set({ colaboradorIds: on ? draft.colaboradorIds.filter((x) => x !== c.id) : [...draft.colaboradorIds, c.id] })}
                >
                  {c.name}
                </button>
              );
            })}
            <span className="plan-inline-add">
              <input value={newPerson} onChange={(e) => setNewPerson(e.target.value)} placeholder="novo colaborador" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPerson())} />
              <button type="button" className="btn secondary" onClick={addPerson} disabled={!newPerson.trim()}>
                +
              </button>
            </span>
          </div>
        </div>

        {(transporte || draft.vehicleId) && (
          <div className="plan-form-grid">
            <div className="field">
              <span>Carrinha</span>
              <select
                value={draft.vehicleId}
                onChange={(e) => {
                  const v = data.vehicles.find((x) => x.id === e.target.value);
                  set({ vehicleId: e.target.value, driverId: draft.driverId || v?.defaultDriverId || "" });
                }}
              >
                <option value="">—</option>
                {data.vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name ? `${v.name} (${v.plate})` : v.plate}
                  </option>
                ))}
              </select>
              <span className="plan-inline-add">
                <input value={newVan} onChange={(e) => setNewVan(e.target.value)} placeholder="nova (matrícula)" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addVan())} />
                <button type="button" className="btn secondary" onClick={addVan} disabled={!newVan.trim()}>
                  +
                </button>
              </span>
            </div>
            <label className="field">
              Condutor
              <select value={draft.driverId} onChange={(e) => set({ driverId: e.target.value })}>
                <option value="">—</option>
                {data.colaboradores.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {!transporte && !draft.vehicleId && (
          <button type="button" className="link-button" style={{ marginBottom: 10 }} onClick={() => set({ vehicleId: data.vehicles[0]?.id ?? "" })}>
            + carrinha / condutor
          </button>
        )}

        <label className="field">
          Notas
          <textarea rows={2} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
        </label>
        {draft.id && (
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <input type="checkbox" checked={draft.done} onChange={(e) => set({ done: e.target.checked })} /> Feito
          </label>
        )}

        {err && <p className="error-text">{err}</p>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={onSave} disabled={busy}>
            {busy ? "A guardar…" : "Guardar"}
          </button>
          <button className="btn secondary" onClick={() => setDraft(null)}>
            Cancelar
          </button>
          {onDelete && (
            <button className="btn danger" style={{ marginLeft: "auto" }} onClick={onDelete}>
              Apagar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
