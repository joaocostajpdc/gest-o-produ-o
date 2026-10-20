import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";

// ============================================================================
// Peças partilhadas pelo Controlo de Horas e pelos Km das Carrinhas (pedido
// do utilizador de 2026-10-20): tipos, período (mês/ano) e a gestão dos
// colaboradores, que são também os condutores.
// ============================================================================

export interface Colaborador {
  id: string;
  name: string;
  funcao: string | null;
  dailyHours: number;
  active: boolean;
  notes: string | null;
}

export const pad = (n: number) => String(n).padStart(2, "0");

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("pt-PT", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });
}

export const fmtNumber = (n: number, digits = 0) =>
  n.toLocaleString("pt-PT", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** "7,5 h" → mostrado como "7h30". */
export function fmtHours(h: number) {
  const sign = h < 0 ? "-" : "";
  const total = Math.round(Math.abs(h) * 60);
  return `${sign}${Math.floor(total / 60)}h${pad(total % 60)}`;
}

// ---------------------------------------------------------------------------
// Período: mês ou ano inteiro
// ---------------------------------------------------------------------------
export interface Period {
  mode: "mes" | "ano";
  month: string; // "2026-10"
  year: string; // "2026"
}

export function initialPeriod(): Period {
  const d = new Date();
  return { mode: "mes", month: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, year: String(d.getFullYear()) };
}

export function periodRange(p: Period): { from: string; to: string; label: string } {
  if (p.mode === "ano") return { from: `${p.year}-01-01`, to: `${p.year}-12-31`, label: `Ano de ${p.year}` };
  const [y, m] = p.month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("pt-PT", { month: "long", year: "numeric", timeZone: "UTC" });
  return { from: `${p.month}-01`, to: `${p.month}-${pad(last)}`, label };
}

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const years = Array.from({ length: 4 }, (_, i) => String(new Date().getFullYear() - i));
  return (
    <div className="ef-period">
      <div className="ef-seg" role="group" aria-label="Período">
        <button type="button" className={value.mode === "mes" ? "active" : ""} aria-pressed={value.mode === "mes"} onClick={() => onChange({ ...value, mode: "mes" })}>
          Mês
        </button>
        <button type="button" className={value.mode === "ano" ? "active" : ""} aria-pressed={value.mode === "ano"} onClick={() => onChange({ ...value, mode: "ano" })}>
          Ano
        </button>
      </div>
      {value.mode === "mes" ? (
        <input
          type="month"
          aria-label="Mês"
          value={value.month}
          onChange={(e) => e.target.value && onChange({ ...value, month: e.target.value })}
        />
      ) : (
        <select aria-label="Ano" value={value.year} onChange={(e) => onChange({ ...value, year: e.target.value })}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function useColaboradores() {
  const [list, setList] = useState<Colaborador[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = () =>
    api
      .get<Colaborador[]>("/colaboradores")
      .then(setList)
      .catch(() => setList([]))
      .finally(() => setLoading(false));
  useEffect(() => {
    reload();
  }, []);
  return { list, loading, reload };
}

export function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="ef-kpi">
      <span className="ef-kpi-label">{label}</span>
      <span className="ef-kpi-value">{value}</span>
      {sub && <span className="ef-kpi-sub">{sub}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Colaboradores (também são os condutores)
// ---------------------------------------------------------------------------
const emptyColab = { name: "", funcao: "", dailyHours: "8", notes: "" };

export function ColaboradoresPanel({
  colaboradores,
  onChanged,
  showHours = true,
}: {
  colaboradores: Colaborador[];
  onChanged: () => void;
  showHours?: boolean;
}) {
  const [form, setForm] = useState(emptyColab);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = {
        name: form.name,
        funcao: form.funcao || null,
        dailyHours: Number(String(form.dailyHours).replace(",", ".")) || 8,
        notes: form.notes || null,
      };
      if (editingId) await api.put(`/colaboradores/${editingId}`, body);
      else await api.post("/colaboradores", body);
      setForm(emptyColab);
      setEditingId(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao gravar.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(c: Colaborador) {
    await api.put(`/colaboradores/${c.id}`, { active: !c.active });
    onChanged();
  }

  return (
    <div className="ef-two">
      <form className="card ef-form" onSubmit={submit}>
        <h3>{editingId ? "Editar colaborador" : "Novo colaborador"}</h3>
        <div className="field">
          <label htmlFor="c-name">Nome</label>
          <input id="c-name" type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div className="field">
          <label htmlFor="c-funcao">Função</label>
          <input id="c-funcao" type="text" placeholder="ex.: Serralheiro, Motorista" value={form.funcao} onChange={(e) => setForm({ ...form, funcao: e.target.value })} />
        </div>
        {showHours && (
          <div className="field">
            <label htmlFor="c-hours">Horário diário (horas)</label>
            <input id="c-hours" type="number" step="0.5" min="0" max="24" value={form.dailyHours} onChange={(e) => setForm({ ...form, dailyHours: e.target.value })} />
          </div>
        )}
        <div className="field">
          <label htmlFor="c-notes">Notas</label>
          <input id="c-notes" type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="ef-form-actions">
          <button className="btn" type="submit" disabled={busy}>
            {editingId ? "Guardar" : "Adicionar"}
          </button>
          {editingId && (
            <button
              className="btn secondary"
              type="button"
              onClick={() => {
                setEditingId(null);
                setForm(emptyColab);
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
                <th>Nome</th>
                <th>Função</th>
                {showHours && <th className="num">Horário</th>}
                <th>Estado</th>
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {colaboradores.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Ainda não há colaboradores. Adiciona o primeiro ao lado.
                  </td>
                </tr>
              )}
              {colaboradores.map((c) => (
                <tr key={c.id} style={c.active ? undefined : { opacity: 0.55 }}>
                  <td>
                    <strong>{c.name}</strong>
                    {c.notes && <div className="muted" style={{ fontSize: 12 }}>{c.notes}</div>}
                  </td>
                  <td>{c.funcao || "—"}</td>
                  {showHours && <td className="num">{fmtHours(c.dailyHours)}</td>}
                  <td>{c.active ? "Ativo" : "Inativo"}</td>
                  <td className="ef-row-actions">
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => {
                        setEditingId(c.id);
                        setForm({ name: c.name, funcao: c.funcao ?? "", dailyHours: String(c.dailyHours), notes: c.notes ?? "" });
                      }}
                    >
                      Editar
                    </button>
                    <button type="button" className="btn secondary" onClick={() => toggleActive(c)}>
                      {c.active ? "Desativar" : "Ativar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
