import { FormEvent, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api/client";
import { useFeature } from "../contexts/FeaturesContext";
import { FeatureTestBanner } from "../components/FeatureTestBanner";
import {
  ColaboradoresPanel,
  Kpi,
  PeriodPicker,
  formatDay,
  fmtHours,
  initialPeriod,
  periodRange,
  todayIso,
  useColaboradores,
} from "../components/EquipaFrota";

// ============================================================================
// Controlo de Horas dos colaboradores (pedido do utilizador de 2026-10-20).
// Cada registo é um dia de um colaborador: entrada, saída e pausa (ou uma
// ausência: falta, férias, baixa, feriado). O resumo soma as horas do
// período e as horas extra acima do horário diário de cada colaborador.
// Em teste: só o administrador até ser aprovado.
// ============================================================================

const FEATURE_KEY = "horas";

type Tipo = "TRABALHO" | "FALTA" | "FERIAS" | "BAIXA" | "FERIADO";

const TIPO_LABEL: Record<Tipo, string> = {
  TRABALHO: "Trabalho",
  FALTA: "Falta",
  FERIAS: "Férias",
  BAIXA: "Baixa",
  FERIADO: "Feriado",
};

const TIPO_COLOR: Record<Tipo, string> = {
  TRABALHO: "#1d4ed8",
  FALTA: "#b42318",
  FERIAS: "#047857",
  BAIXA: "#b54708",
  FERIADO: "#5b6380",
};

interface TimeEntry {
  id: string;
  colaboradorId: string;
  colaborador: { id: string; name: string; dailyHours: number };
  date: string;
  tipo: Tipo;
  startTime: string | null;
  endTime: string | null;
  breakMinutes: number;
  notes: string | null;
}

function minutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Horas trabalhadas num registo (passa da meia-noite se a saída for antes da entrada). */
export function workedHours(e: { tipo: string; startTime: string | null; endTime: string | null; breakMinutes: number }) {
  if (e.tipo !== "TRABALHO" || !e.startTime || !e.endTime) return 0;
  let diff = minutes(e.endTime) - minutes(e.startTime);
  if (diff < 0) diff += 24 * 60;
  return Math.max(0, diff - e.breakMinutes) / 60;
}

const emptyForm = (colaboradorId = "") => ({
  colaboradorId,
  date: todayIso(),
  tipo: "TRABALHO" as Tipo,
  startTime: "08:00",
  endTime: "17:00",
  breakMinutes: "60",
  notes: "",
});

type Tab = "registos" | "resumo" | "colaboradores";

export function HorasPage() {
  const feature = useFeature(FEATURE_KEY);
  const colabs = useColaboradores();
  const [tab, setTab] = useState<Tab>("registos");
  const [period, setPeriod] = useState(initialPeriod);
  const [filterColab, setFilterColab] = useState("");
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const range = periodRange(period);
  const active = colabs.list.filter((c) => c.active);

  async function load() {
    setLoading(true);
    try {
      setEntries(await api.get<TimeEntry[]>(`/horas?from=${range.from}&to=${range.to}`));
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (feature.available) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, feature.available]);

  const shown = filterColab ? entries.filter((e) => e.colaboradorId === filterColab) : entries;

  const summary = useMemo(() => {
    const map = new Map<string, { id: string; name: string; dias: number; horas: number; extra: number; falta: number; ferias: number; baixa: number; feriado: number }>();
    for (const c of colabs.list) {
      map.set(c.id, { id: c.id, name: c.name, dias: 0, horas: 0, extra: 0, falta: 0, ferias: 0, baixa: 0, feriado: 0 });
    }
    // Agrupa por colaborador e dia (um dia pode ter mais do que um registo).
    const perDay = new Map<string, number>();
    for (const e of entries) {
      const row = map.get(e.colaboradorId) ?? { id: e.colaboradorId, name: e.colaborador.name, dias: 0, horas: 0, extra: 0, falta: 0, ferias: 0, baixa: 0, feriado: 0 };
      map.set(e.colaboradorId, row);
      if (e.tipo === "TRABALHO") {
        const key = `${e.colaboradorId}|${e.date.slice(0, 10)}`;
        perDay.set(key, (perDay.get(key) ?? 0) + workedHours(e));
      } else if (e.tipo === "FALTA") row.falta++;
      else if (e.tipo === "FERIAS") row.ferias++;
      else if (e.tipo === "BAIXA") row.baixa++;
      else if (e.tipo === "FERIADO") row.feriado++;
    }
    for (const [key, h] of perDay) {
      const id = key.split("|")[0];
      const row = map.get(id)!;
      const daily = colabs.list.find((c) => c.id === id)?.dailyHours ?? 8;
      row.dias++;
      row.horas += h;
      row.extra += Math.max(0, h - daily);
    }
    return [...map.values()].filter((r) => r.dias || r.falta || r.ferias || r.baixa || r.feriado).sort((a, b) => a.name.localeCompare(b.name));
  }, [entries, colabs.list]);

  const totals = summary.reduce(
    (t, r) => ({ horas: t.horas + r.horas, extra: t.extra + r.extra, ausencias: t.ausencias + r.falta + r.baixa }),
    { horas: 0, extra: 0, ausencias: 0 }
  );

  if (feature.loading) return <div className="muted">A carregar...</div>;
  if (!feature.available) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const work = form.tipo === "TRABALHO";
    if (!form.colaboradorId) return setError("Escolhe o colaborador.");
    if (work && (!form.startTime || !form.endTime)) return setError("Indica a hora de entrada e de saída.");
    setBusy(true);
    try {
      const body = {
        colaboradorId: form.colaboradorId,
        date: form.date,
        tipo: form.tipo,
        startTime: work ? form.startTime : null,
        endTime: work ? form.endTime : null,
        breakMinutes: work ? Number(form.breakMinutes) || 0 : 0,
        notes: form.notes || null,
      };
      if (editingId) await api.put(`/horas/${editingId}`, body);
      else await api.post("/horas", body);
      setEditingId(null);
      // Mantém o colaborador e avança um dia, para lançar a semana depressa.
      const next = new Date(`${form.date}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      setForm({ ...form, date: editingId ? form.date : next.toISOString().slice(0, 10), notes: "" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao gravar.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(e: TimeEntry) {
    if (!window.confirm(`Apagar o registo de ${e.colaborador.name} de ${formatDay(e.date)}?`)) return;
    await api.delete(`/horas/${e.id}`);
    await load();
  }

  function edit(e: TimeEntry) {
    setEditingId(e.id);
    setForm({
      colaboradorId: e.colaboradorId,
      date: e.date.slice(0, 10),
      tipo: e.tipo,
      startTime: e.startTime ?? "08:00",
      endTime: e.endTime ?? "17:00",
      breakMinutes: String(e.breakMinutes),
      notes: e.notes ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const preview = workedHours({ ...form, breakMinutes: Number(form.breakMinutes) || 0 });

  return (
    <div>
      <div className="page-header">
        <h2>Controlo de Horas</h2>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      <FeatureTestBanner featureKey={FEATURE_KEY} label="o Controlo de Horas" />

      <div className="ef-kpis">
        <Kpi label="Horas trabalhadas" value={fmtHours(totals.horas)} sub={range.label} />
        <Kpi label="Horas extra" value={fmtHours(totals.extra)} sub="acima do horário diário" />
        <Kpi label="Colaboradores com registos" value={String(summary.length)} sub={`de ${active.length} ativos`} />
        <Kpi label="Faltas e baixas" value={String(totals.ausencias)} sub="dias no período" />
      </div>

      <div className="tabs" role="tablist">
        {(
          [
            ["registos", "Registos"],
            ["resumo", "Resumo por colaborador"],
            ["colaboradores", "Colaboradores"],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      {tab === "registos" && (
        <div className="ef-two">
          <form className="card ef-form" onSubmit={submit}>
            <h3>{editingId ? "Editar registo" : "Lançar horas"}</h3>
            {active.length === 0 && !colabs.loading && (
              <p className="muted" style={{ fontSize: 13 }}>
                Primeiro adiciona os colaboradores no separador <button type="button" className="ef-link" onClick={() => setTab("colaboradores")}>Colaboradores</button>.
              </p>
            )}
            <div className="field">
              <label htmlFor="h-colab">Colaborador</label>
              <select id="h-colab" value={form.colaboradorId} onChange={(e) => setForm({ ...form, colaboradorId: e.target.value })} required>
                <option value="">Escolher…</option>
                {active.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="ef-row">
              <div className="field">
                <label htmlFor="h-date">Dia</label>
                <input id="h-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
              </div>
              <div className="field">
                <label htmlFor="h-tipo">Tipo</label>
                <select id="h-tipo" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as Tipo })}>
                  {(Object.keys(TIPO_LABEL) as Tipo[]).map((t) => (
                    <option key={t} value={t}>
                      {TIPO_LABEL[t]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {form.tipo === "TRABALHO" && (
              <div className="ef-row ef-row-3">
                <div className="field">
                  <label htmlFor="h-start">Entrada</label>
                  <input id="h-start" type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} required />
                </div>
                <div className="field">
                  <label htmlFor="h-end">Saída</label>
                  <input id="h-end" type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} required />
                </div>
                <div className="field">
                  <label htmlFor="h-break">Pausa (min)</label>
                  <input id="h-break" type="number" min="0" step="5" value={form.breakMinutes} onChange={(e) => setForm({ ...form, breakMinutes: e.target.value })} />
                </div>
              </div>
            )}
            <div className="field">
              <label htmlFor="h-notes">Observações</label>
              <input id="h-notes" type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            {form.tipo === "TRABALHO" && (
              <p className="ef-preview">
                Total do dia: <strong>{fmtHours(preview)}</strong>
              </p>
            )}
            {error && <p className="error-text">{error}</p>}
            <div className="ef-form-actions">
              <button className="btn" type="submit" disabled={busy}>
                {editingId ? "Guardar alterações" : "Lançar"}
              </button>
              {editingId && (
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setForm(emptyForm(form.colaboradorId));
                  }}
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>

          <div className="card ef-table-card">
            <div className="ef-table-head">
              <h3>Registos · {range.label}</h3>
              <select aria-label="Filtrar por colaborador" value={filterColab} onChange={(e) => setFilterColab(e.target.value)}>
                <option value="">Todos os colaboradores</option>
                {colabs.list.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="ef-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Dia</th>
                    <th>Colaborador</th>
                    <th>Tipo</th>
                    <th>Horário</th>
                    <th className="num">Pausa</th>
                    <th className="num">Horas</th>
                    <th aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={7} className="muted">A carregar...</td>
                    </tr>
                  )}
                  {!loading && shown.length === 0 && (
                    <tr>
                      <td colSpan={7} className="muted">Sem registos neste período.</td>
                    </tr>
                  )}
                  {!loading &&
                    shown.map((e) => (
                      <tr key={e.id}>
                        <td className="ef-nowrap">{formatDay(e.date)}</td>
                        <td>
                          {e.colaborador.name}
                          {e.notes && <div className="muted" style={{ fontSize: 12 }}>{e.notes}</div>}
                        </td>
                        <td>
                          <span className="ef-tag" style={{ color: TIPO_COLOR[e.tipo], borderColor: TIPO_COLOR[e.tipo] }}>
                            {TIPO_LABEL[e.tipo]}
                          </span>
                        </td>
                        <td className="ef-nowrap">{e.startTime ? `${e.startTime} – ${e.endTime}` : "—"}</td>
                        <td className="num">{e.tipo === "TRABALHO" ? `${e.breakMinutes} min` : "—"}</td>
                        <td className="num">
                          <strong>{e.tipo === "TRABALHO" ? fmtHours(workedHours(e)) : "—"}</strong>
                        </td>
                        <td className="ef-row-actions">
                          <button type="button" className="btn secondary" onClick={() => edit(e)}>
                            Editar
                          </button>
                          <button type="button" className="btn secondary" onClick={() => remove(e)} aria-label="Apagar registo">
                            Apagar
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === "resumo" && (
        <div className="card ef-table-card">
          <div className="ef-table-head">
            <h3>Resumo por colaborador · {range.label}</h3>
          </div>
          <div className="ef-scroll">
            <table>
              <thead>
                <tr>
                  <th>Colaborador</th>
                  <th className="num">Dias trabalhados</th>
                  <th className="num">Horas</th>
                  <th className="num">Média/dia</th>
                  <th className="num">Horas extra</th>
                  <th className="num">Faltas</th>
                  <th className="num">Férias</th>
                  <th className="num">Baixa</th>
                  <th className="num">Feriados</th>
                </tr>
              </thead>
              <tbody>
                {summary.length === 0 && (
                  <tr>
                    <td colSpan={9} className="muted">Sem registos neste período.</td>
                  </tr>
                )}
                {summary.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.name}</strong>
                    </td>
                    <td className="num">{r.dias}</td>
                    <td className="num">
                      <strong>{fmtHours(r.horas)}</strong>
                    </td>
                    <td className="num">{r.dias ? fmtHours(r.horas / r.dias) : "—"}</td>
                    <td className="num" style={r.extra > 0 ? { color: "#b54708", fontWeight: 600 } : undefined}>
                      {fmtHours(r.extra)}
                    </td>
                    <td className="num">{r.falta || "—"}</td>
                    <td className="num">{r.ferias || "—"}</td>
                    <td className="num">{r.baixa || "—"}</td>
                    <td className="num">{r.feriado || "—"}</td>
                  </tr>
                ))}
              </tbody>
              {summary.length > 1 && (
                <tfoot>
                  <tr>
                    <th>Total</th>
                    <th className="num">{summary.reduce((s, r) => s + r.dias, 0)}</th>
                    <th className="num">{fmtHours(totals.horas)}</th>
                    <th />
                    <th className="num">{fmtHours(totals.extra)}</th>
                    <th className="num">{summary.reduce((s, r) => s + r.falta, 0)}</th>
                    <th className="num">{summary.reduce((s, r) => s + r.ferias, 0)}</th>
                    <th className="num">{summary.reduce((s, r) => s + r.baixa, 0)}</th>
                    <th className="num">{summary.reduce((s, r) => s + r.feriado, 0)}</th>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {tab === "colaboradores" && <ColaboradoresPanel colaboradores={colabs.list} onChanged={colabs.reload} />}
    </div>
  );
}
