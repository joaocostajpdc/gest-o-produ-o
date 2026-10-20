import { FormEvent, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api/client";
import { useFeature } from "../contexts/FeaturesContext";
import { FeatureTestBanner } from "../components/FeatureTestBanner";
import {
  ColaboradoresPanel,
  Kpi,
  PeriodPicker,
  fmtNumber,
  formatDay,
  initialPeriod,
  periodRange,
  todayIso,
  useColaboradores,
} from "../components/EquipaFrota";

// ============================================================================
// Km das Carrinhas (pedido do utilizador de 2026-10-20): "quero resumos por
// carrinha e por condutor — por norma cada condutor tem a sua carrinha, mas às
// vezes trocamos e quero as duas análises". Cada registo guarda a carrinha e
// quem conduziu; o resumo por carrinha mostra quem a conduziu e o resumo por
// condutor mostra que carrinhas usou, assinalando quando não foi a sua.
// Em teste: só o administrador até ser aprovado.
// ============================================================================

const FEATURE_KEY = "kmViaturas";

interface Vehicle {
  id: string;
  plate: string;
  name: string | null;
  defaultDriverId: string | null;
  defaultDriver: { id: string; name: string } | null;
  initialKm: number;
  currentKm: number;
  active: boolean;
  notes: string | null;
}

interface Trip {
  id: string;
  vehicleId: string;
  vehicle: { id: string; plate: string; name: string | null; defaultDriverId: string | null };
  driverId: string | null;
  driver: { id: string; name: string } | null;
  date: string;
  kmStart: number;
  kmEnd: number;
  destination: string | null;
  notes: string | null;
}

const km = (t: Trip) => t.kmEnd - t.kmStart;
const vLabel = (v: { plate: string; name: string | null }) => (v.name ? `${v.plate} · ${v.name}` : v.plate);

const emptyTrip = () => ({ vehicleId: "", driverId: "", date: todayIso(), kmStart: "", kmEnd: "", destination: "", notes: "" });
const emptyVehicle = { plate: "", name: "", defaultDriverId: "", initialKm: "0", notes: "" };

type Tab = "registos" | "carrinha" | "condutor" | "carrinhas" | "condutores";

export function KmPage() {
  const feature = useFeature(FEATURE_KEY);
  const colabs = useColaboradores();
  const [tab, setTab] = useState<Tab>("registos");
  const [period, setPeriod] = useState(initialPeriod);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyTrip());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [vForm, setVForm] = useState(emptyVehicle);
  const [vEditingId, setVEditingId] = useState<string | null>(null);
  const [filterVehicle, setFilterVehicle] = useState("");
  const [filterDriver, setFilterDriver] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [vError, setVError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const range = periodRange(period);
  const drivers = colabs.list.filter((c) => c.active);
  const activeVehicles = vehicles.filter((v) => v.active);

  const loadVehicles = () => api.get<Vehicle[]>("/viaturas").then(setVehicles).catch(() => setVehicles([]));
  async function loadTrips() {
    setLoading(true);
    try {
      setTrips(await api.get<Trip[]>(`/viaturas/viagens?from=${range.from}&to=${range.to}`));
    } catch {
      setTrips([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (feature.available) loadVehicles();
  }, [feature.available]);

  useEffect(() => {
    if (feature.available) loadTrips();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, feature.available]);

  // ---- Resumo por carrinha: km totais e quem a conduziu --------------------
  const byVehicle = useMemo(() => {
    const map = new Map<string, { id: string; label: string; habitual: string | null; habitualId: string | null; total: number; n: number; drivers: Map<string, { name: string; km: number; n: number }> }>();
    for (const t of trips) {
      const v = vehicles.find((x) => x.id === t.vehicleId);
      let row = map.get(t.vehicleId);
      if (!row) {
        row = { id: t.vehicleId, label: vLabel(t.vehicle), habitual: v?.defaultDriver?.name ?? null, habitualId: t.vehicle.defaultDriverId, total: 0, n: 0, drivers: new Map() };
        map.set(t.vehicleId, row);
      }
      row.total += km(t);
      row.n++;
      const dk = t.driverId ?? "—";
      const d = row.drivers.get(dk) ?? { name: t.driver?.name ?? "Sem condutor", km: 0, n: 0 };
      d.km += km(t);
      d.n++;
      row.drivers.set(dk, d);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [trips, vehicles]);

  // ---- Resumo por condutor: km totais e que carrinhas usou -----------------
  const byDriver = useMemo(() => {
    const map = new Map<string, { id: string; name: string; total: number; n: number; propria: number; outras: number; vehicles: Map<string, { label: string; km: number; n: number; own: boolean }> }>();
    for (const t of trips) {
      const dk = t.driverId ?? "—";
      let row = map.get(dk);
      if (!row) {
        row = { id: dk, name: t.driver?.name ?? "Sem condutor", total: 0, n: 0, propria: 0, outras: 0, vehicles: new Map() };
        map.set(dk, row);
      }
      const own = !!t.driverId && t.vehicle.defaultDriverId === t.driverId;
      row.total += km(t);
      row.n++;
      if (own) row.propria += km(t);
      else row.outras += km(t);
      const v = row.vehicles.get(t.vehicleId) ?? { label: vLabel(t.vehicle), km: 0, n: 0, own };
      v.km += km(t);
      v.n++;
      row.vehicles.set(t.vehicleId, v);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [trips]);

  const totalKm = trips.reduce((s, t) => s + km(t), 0);
  const trocas = trips.filter((t) => t.driverId && t.vehicle.defaultDriverId && t.vehicle.defaultDriverId !== t.driverId);
  const kmTrocas = trocas.reduce((s, t) => s + km(t), 0);

  if (feature.loading) return <div className="muted">A carregar...</div>;
  if (!feature.available) return <Navigate to="/" replace />;

  function pickVehicle(vehicleId: string) {
    const v = vehicles.find((x) => x.id === vehicleId);
    setForm((f) => ({
      ...f,
      vehicleId,
      // Por norma conduz o condutor habitual; os km iniciais continuam dos últimos registados.
      driverId: editingId ? f.driverId : v?.defaultDriverId ?? f.driverId,
      kmStart: editingId ? f.kmStart : v ? String(v.currentKm) : f.kmStart,
    }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const kmStart = Number(form.kmStart);
    const kmEnd = Number(form.kmEnd);
    if (!form.vehicleId) return setError("Escolhe a carrinha.");
    if (form.kmStart === "" || form.kmEnd === "" || Number.isNaN(kmStart) || Number.isNaN(kmEnd)) return setError("Indica os km iniciais e finais.");
    if (kmEnd < kmStart) return setError("Os km finais não podem ser menores que os iniciais.");
    if (kmEnd - kmStart > 5000) return setError("Mais de 5000 km num registo — confirma os valores.");
    setBusy(true);
    try {
      const body = {
        vehicleId: form.vehicleId,
        driverId: form.driverId || null,
        date: form.date,
        kmStart,
        kmEnd,
        destination: form.destination || null,
        notes: form.notes || null,
      };
      if (editingId) await api.put(`/viaturas/viagens/${editingId}`, body);
      else await api.post("/viaturas/viagens", body);
      setEditingId(null);
      // Fica pronto para o registo seguinte da mesma carrinha.
      setForm({ ...emptyTrip(), vehicleId: form.vehicleId, driverId: form.driverId, date: form.date, kmStart: String(kmEnd) });
      await Promise.all([loadTrips(), loadVehicles()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao gravar.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: Trip) {
    if (!window.confirm(`Apagar o registo de ${t.vehicle.plate} de ${formatDay(t.date)} (${fmtNumber(km(t))} km)?`)) return;
    await api.delete(`/viaturas/viagens/${t.id}`);
    await Promise.all([loadTrips(), loadVehicles()]);
  }

  function edit(t: Trip) {
    setEditingId(t.id);
    setForm({
      vehicleId: t.vehicleId,
      driverId: t.driverId ?? "",
      date: t.date.slice(0, 10),
      kmStart: String(t.kmStart),
      kmEnd: String(t.kmEnd),
      destination: t.destination ?? "",
      notes: t.notes ?? "",
    });
    setTab("registos");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitVehicle(e: FormEvent) {
    e.preventDefault();
    setVError(null);
    setBusy(true);
    try {
      const body = {
        plate: vForm.plate,
        name: vForm.name || null,
        defaultDriverId: vForm.defaultDriverId || null,
        initialKm: Number(vForm.initialKm) || 0,
        notes: vForm.notes || null,
      };
      if (vEditingId) await api.put(`/viaturas/${vEditingId}`, body);
      else await api.post("/viaturas", body);
      setVForm(emptyVehicle);
      setVEditingId(null);
      await loadVehicles();
    } catch (err) {
      setVError(err instanceof Error ? err.message : "Erro ao gravar.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleVehicle(v: Vehicle) {
    await api.put(`/viaturas/${v.id}`, { active: !v.active });
    await loadVehicles();
  }

  const shown = trips.filter((t) => (!filterVehicle || t.vehicleId === filterVehicle) && (!filterDriver || (t.driverId ?? "—") === filterDriver));
  const formKm = Number(form.kmEnd) - Number(form.kmStart);
  const selectedVehicle = vehicles.find((v) => v.id === form.vehicleId);
  const notOwn = !!form.driverId && !!selectedVehicle?.defaultDriverId && selectedVehicle.defaultDriverId !== form.driverId;

  return (
    <div>
      <div className="page-header">
        <h2>Km das Carrinhas</h2>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      <FeatureTestBanner featureKey={FEATURE_KEY} label="os Km das Carrinhas" />

      <div className="ef-kpis">
        <Kpi label="Km percorridos" value={`${fmtNumber(totalKm)} km`} sub={range.label} />
        <Kpi label="Carrinhas com registos" value={String(byVehicle.length)} sub={`de ${activeVehicles.length} ativas`} />
        <Kpi label="Condutores" value={String(byDriver.filter((d) => d.id !== "—").length)} sub="com registos no período" />
        <Kpi
          label="Em carrinha de outro"
          value={`${fmtNumber(kmTrocas)} km`}
          sub={trocas.length ? `${trocas.length} ${trocas.length === 1 ? "registo" : "registos"} com troca` : "sem trocas"}
        />
      </div>

      <div className="tabs" role="tablist">
        {(
          [
            ["registos", "Registos"],
            ["carrinha", "Por carrinha"],
            ["condutor", "Por condutor"],
            ["carrinhas", "Carrinhas"],
            ["condutores", "Condutores"],
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
            <h3>{editingId ? "Editar registo" : "Lançar km"}</h3>
            {activeVehicles.length === 0 && (
              <p className="muted" style={{ fontSize: 13 }}>
                Primeiro adiciona as carrinhas no separador{" "}
                <button type="button" className="ef-link" onClick={() => setTab("carrinhas")}>
                  Carrinhas
                </button>
                .
              </p>
            )}
            <div className="ef-row">
              <div className="field">
                <label htmlFor="k-date">Dia</label>
                <input id="k-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
              </div>
              <div className="field">
                <label htmlFor="k-vehicle">Carrinha</label>
                <select id="k-vehicle" value={form.vehicleId} onChange={(e) => pickVehicle(e.target.value)} required>
                  <option value="">Escolher…</option>
                  {activeVehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {vLabel(v)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="k-driver">Condutor</label>
              <select id="k-driver" value={form.driverId} onChange={(e) => setForm({ ...form, driverId: e.target.value })}>
                <option value="">Sem condutor indicado</option>
                {drivers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {selectedVehicle?.defaultDriverId === c.id ? " (habitual)" : ""}
                  </option>
                ))}
              </select>
              {notOwn && <p className="ef-hint">Não é o condutor habitual desta carrinha — fica registado como troca.</p>}
            </div>
            <div className="ef-row">
              <div className="field">
                <label htmlFor="k-start">Km iniciais</label>
                <input id="k-start" type="number" min="0" inputMode="numeric" value={form.kmStart} onChange={(e) => setForm({ ...form, kmStart: e.target.value })} required />
              </div>
              <div className="field">
                <label htmlFor="k-end">Km finais</label>
                <input id="k-end" type="number" min="0" inputMode="numeric" value={form.kmEnd} onChange={(e) => setForm({ ...form, kmEnd: e.target.value })} required />
              </div>
            </div>
            <div className="field">
              <label htmlFor="k-dest">Destino / serviço</label>
              <input id="k-dest" type="text" placeholder="ex.: Obra Viana, entregas Braga" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="k-notes">Observações</label>
              <input id="k-notes" type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            {form.kmStart !== "" && form.kmEnd !== "" && formKm >= 0 && (
              <p className="ef-preview">
                Percorridos: <strong>{fmtNumber(formKm)} km</strong>
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
                    setForm(emptyTrip());
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
              <div className="ef-filters">
                <select aria-label="Filtrar por carrinha" value={filterVehicle} onChange={(e) => setFilterVehicle(e.target.value)}>
                  <option value="">Todas as carrinhas</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.plate}
                    </option>
                  ))}
                </select>
                <select aria-label="Filtrar por condutor" value={filterDriver} onChange={(e) => setFilterDriver(e.target.value)}>
                  <option value="">Todos os condutores</option>
                  {colabs.list.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="ef-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Dia</th>
                    <th>Carrinha</th>
                    <th>Condutor</th>
                    <th>Destino</th>
                    <th className="num">Km inicial</th>
                    <th className="num">Km final</th>
                    <th className="num">Km</th>
                    <th aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={8} className="muted">A carregar...</td>
                    </tr>
                  )}
                  {!loading && shown.length === 0 && (
                    <tr>
                      <td colSpan={8} className="muted">Sem registos neste período.</td>
                    </tr>
                  )}
                  {!loading &&
                    shown.map((t) => {
                      const troca = !!t.driverId && !!t.vehicle.defaultDriverId && t.vehicle.defaultDriverId !== t.driverId;
                      return (
                        <tr key={t.id}>
                          <td className="ef-nowrap">{formatDay(t.date)}</td>
                          <td className="ef-nowrap">
                            <strong>{t.vehicle.plate}</strong>
                          </td>
                          <td>
                            {t.driver?.name ?? <span className="muted">—</span>}
                            {troca && <span className="ef-tag ef-tag-swap">Troca</span>}
                          </td>
                          <td>
                            {t.destination || <span className="muted">—</span>}
                            {t.notes && <div className="muted" style={{ fontSize: 12 }}>{t.notes}</div>}
                          </td>
                          <td className="num">{fmtNumber(t.kmStart)}</td>
                          <td className="num">{fmtNumber(t.kmEnd)}</td>
                          <td className="num">
                            <strong>{fmtNumber(km(t))}</strong>
                          </td>
                          <td className="ef-row-actions">
                            <button type="button" className="btn secondary" onClick={() => edit(t)}>
                              Editar
                            </button>
                            <button type="button" className="btn secondary" onClick={() => remove(t)}>
                              Apagar
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === "carrinha" && (
        <div className="ef-cards">
          {byVehicle.length === 0 && <div className="card muted">Sem registos neste período.</div>}
          {byVehicle.map((v) => (
            <section key={v.id} className="card ef-sum-card">
              <header className="ef-sum-head">
                <div>
                  <h3>{v.label}</h3>
                  <p className="muted">Condutor habitual: {v.habitual ?? "não definido"}</p>
                </div>
                <div className="ef-sum-total">
                  <strong>{fmtNumber(v.total)} km</strong>
                  <span>
                    {v.n} {v.n === 1 ? "registo" : "registos"}
                  </span>
                </div>
              </header>
              <table>
                <thead>
                  <tr>
                    <th>Conduzida por</th>
                    <th className="num">Registos</th>
                    <th className="num">Km</th>
                    <th className="num">% da carrinha</th>
                  </tr>
                </thead>
                <tbody>
                  {[...v.drivers.entries()]
                    .sort((a, b) => b[1].km - a[1].km)
                    .map(([id, d]) => (
                      <tr key={id}>
                        <td>
                          {d.name}
                          {id === v.habitualId ? (
                            <span className="ef-tag ef-tag-own">Habitual</span>
                          ) : id !== "—" && v.habitualId ? (
                            <span className="ef-tag ef-tag-swap">Troca</span>
                          ) : null}
                        </td>
                        <td className="num">{d.n}</td>
                        <td className="num">{fmtNumber(d.km)}</td>
                        <td className="num">
                          <span className="ef-bar">
                            <span style={{ width: `${v.total ? (d.km / v.total) * 100 : 0}%` }} />
                          </span>
                          {v.total ? fmtNumber((d.km / v.total) * 100) : 0}%
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}

      {tab === "condutor" && (
        <div className="ef-cards">
          {byDriver.length === 0 && <div className="card muted">Sem registos neste período.</div>}
          {byDriver.map((d) => (
            <section key={d.id} className="card ef-sum-card">
              <header className="ef-sum-head">
                <div>
                  <h3>{d.name}</h3>
                  <p className="muted">
                    Na sua carrinha: {fmtNumber(d.propria)} km · Noutras: {fmtNumber(d.outras)} km
                  </p>
                </div>
                <div className="ef-sum-total">
                  <strong>{fmtNumber(d.total)} km</strong>
                  <span>
                    {d.n} {d.n === 1 ? "registo" : "registos"}
                  </span>
                </div>
              </header>
              <table>
                <thead>
                  <tr>
                    <th>Carrinha</th>
                    <th className="num">Registos</th>
                    <th className="num">Km</th>
                    <th className="num">% do condutor</th>
                  </tr>
                </thead>
                <tbody>
                  {[...d.vehicles.entries()]
                    .sort((a, b) => b[1].km - a[1].km)
                    .map(([id, v]) => (
                      <tr key={id}>
                        <td>
                          {v.label}
                          {d.id !== "—" && (v.own ? <span className="ef-tag ef-tag-own">A sua</span> : <span className="ef-tag ef-tag-swap">De outro</span>)}
                        </td>
                        <td className="num">{v.n}</td>
                        <td className="num">{fmtNumber(v.km)}</td>
                        <td className="num">
                          <span className="ef-bar">
                            <span style={{ width: `${d.total ? (v.km / d.total) * 100 : 0}%` }} />
                          </span>
                          {d.total ? fmtNumber((v.km / d.total) * 100) : 0}%
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}

      {tab === "carrinhas" && (
        <div className="ef-two">
          <form className="card ef-form" onSubmit={submitVehicle}>
            <h3>{vEditingId ? "Editar carrinha" : "Nova carrinha"}</h3>
            <div className="ef-row">
              <div className="field">
                <label htmlFor="v-plate">Matrícula</label>
                <input id="v-plate" type="text" placeholder="AA-00-AA" value={vForm.plate} onChange={(e) => setVForm({ ...vForm, plate: e.target.value })} required />
              </div>
              <div className="field">
                <label htmlFor="v-km">{vEditingId ? "Km iniciais" : "Km atuais"}</label>
                <input id="v-km" type="number" min="0" value={vForm.initialKm} onChange={(e) => setVForm({ ...vForm, initialKm: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="v-name">Descrição</label>
              <input id="v-name" type="text" placeholder="ex.: Renault Master branca" value={vForm.name} onChange={(e) => setVForm({ ...vForm, name: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="v-driver">Condutor habitual</label>
              <select id="v-driver" value={vForm.defaultDriverId} onChange={(e) => setVForm({ ...vForm, defaultDriverId: e.target.value })}>
                <option value="">Nenhum</option>
                {drivers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="v-notes">Notas</label>
              <input id="v-notes" type="text" placeholder="ex.: inspeção em março" value={vForm.notes} onChange={(e) => setVForm({ ...vForm, notes: e.target.value })} />
            </div>
            {vError && <p className="error-text">{vError}</p>}
            <div className="ef-form-actions">
              <button className="btn" type="submit" disabled={busy}>
                {vEditingId ? "Guardar" : "Adicionar"}
              </button>
              {vEditingId && (
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => {
                    setVEditingId(null);
                    setVForm(emptyVehicle);
                  }}
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>

          <div className="card ef-table-card">
            <div className="ef-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Matrícula</th>
                    <th>Descrição</th>
                    <th>Condutor habitual</th>
                    <th className="num">Km atuais</th>
                    <th aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {vehicles.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted">Ainda não há carrinhas. Adiciona a primeira ao lado.</td>
                    </tr>
                  )}
                  {vehicles.map((v) => (
                    <tr key={v.id} style={v.active ? undefined : { opacity: 0.55 }}>
                      <td className="ef-nowrap">
                        <strong>{v.plate}</strong>
                      </td>
                      <td>
                        {v.name || "—"}
                        {v.notes && <div className="muted" style={{ fontSize: 12 }}>{v.notes}</div>}
                      </td>
                      <td>{v.defaultDriver?.name ?? "—"}</td>
                      <td className="num">{fmtNumber(v.currentKm)}</td>
                      <td className="ef-row-actions">
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => {
                            setVEditingId(v.id);
                            setVForm({ plate: v.plate, name: v.name ?? "", defaultDriverId: v.defaultDriverId ?? "", initialKm: String(v.initialKm), notes: v.notes ?? "" });
                          }}
                        >
                          Editar
                        </button>
                        <button type="button" className="btn secondary" onClick={() => toggleVehicle(v)}>
                          {v.active ? "Desativar" : "Ativar"}
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

      {tab === "condutores" && <ColaboradoresPanel colaboradores={colabs.list} onChanged={colabs.reload} showHours={false} />}
    </div>
  );
}
