import { FormEvent, useMemo, useState } from "react";
import { api } from "../api/client";
import { formatDay, todayIso } from "./EquipaFrota";

// ============================================================================
// Financeiro — Calendário, transferências programadas e pagamentos a fazer
// (pedido do utilizador de 2026-10-26: "põe-me um calendário para ser mais
// visual, e transferências programadas e pagamentos a fazer — nestes valores
// certo, ou por exemplo IVA ± 5000"). Em teste só para o administrador
// (feature "financeiroAgenda").
// ============================================================================

export interface ChequeLite {
  id: string;
  numero: string;
  banco: string;
  beneficiario: string;
  valor: number;
  dataCheque: string;
  estado: "POR_DESCONTAR" | "DESCONTADO" | "ANULADO";
}

export type TipoMov = "TRANSFERENCIA" | "PAGAMENTO";
export type EstadoMov = "POR_PAGAR" | "PAGO" | "ANULADO";

export interface Movimento {
  id: string;
  tipo: TipoMov;
  descricao: string;
  entidade: string | null;
  banco: string | null;
  valor: number;
  estimado: boolean;
  data: string;
  estado: EstadoMov;
  pagoEm: string | null;
  valorPago: number | null;
  grupoId: string | null;
  notas: string | null;
}

export const TIPO_LABEL: Record<TipoMov, string> = { TRANSFERENCIA: "Transferência", PAGAMENTO: "Pagamento" };
const ESTADO_LABEL: Record<EstadoMov, string> = { POR_PAGAR: "Por pagar", PAGO: "Pago", ANULADO: "Anulado" };

const eur = (n: number) => n.toLocaleString("pt-PT", { style: "currency", currency: "EUR" });
const eur0 = (n: number) => n.toLocaleString("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const d10 = (s: string) => s.slice(0, 10);
// Aceita "5000", "5 000", "5.000", "4.410,25" e "4410.25".
const parseValor = (s: string) => {
  let t = String(s).replace(/[\s€]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  return Number(t);
};
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  const s = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("pt-PT", { month: "long", year: "numeric", timeZone: "UTC" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const shiftMonth = (key: string, n: number) => {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

/** Valor que conta: o pago (se já foi pago) ou o previsto. */
const valorMov = (m: Movimento) => (m.estado === "PAGO" && m.valorPago !== null ? m.valorPago : m.valor);

// ---------------------------------------------------------------------------
// Aba "Transferências e pagamentos"
// ---------------------------------------------------------------------------

const emptyForm = () => ({
  tipo: "PAGAMENTO" as TipoMov,
  descricao: "",
  entidade: "",
  banco: "",
  valor: "",
  estimado: false,
  data: todayIso(),
  repetir: "1",
  estado: "POR_PAGAR" as EstadoMov,
  valorPago: "",
  notas: "",
});

type FiltroMov = "abertos" | "atraso" | "PAGO" | "todos";

export function PagamentosTab({
  movs,
  reload,
  bancos,
  entidades,
}: {
  movs: Movimento[];
  reload: () => Promise<void>;
  bancos: string[];
  entidades: string[];
}) {
  const hoje = todayIso();
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filtro, setFiltro] = useState<FiltroMov>("abertos");
  const [tipo, setTipo] = useState<"" | TipoMov>("");
  const [q, setQ] = useState("");
  const [adiar, setAdiar] = useState<{ id: string; data: string } | null>(null);
  const [pagar, setPagar] = useState<{ id: string; valor: string; data: string } | null>(null);

  const descricoes = useMemo(() => [...new Set(movs.map((m) => m.descricao))].sort((a, b) => a.localeCompare(b, "pt")), [movs]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const valor = parseValor(form.valor);
    if (!valor || valor <= 0) return setError("Indica o valor.");
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        tipo: form.tipo,
        descricao: form.descricao,
        entidade: form.entidade || null,
        banco: form.banco || null,
        valor,
        estimado: form.estimado,
        data: form.data,
        notas: form.notas || null,
      };
      if (editingId) {
        body.estado = form.estado;
        if (form.estado === "PAGO") body.valorPago = form.valorPago ? parseValor(form.valorPago) : valor;
        await api.put(`/financeiro/movimentos/${editingId}`, body);
      } else {
        body.repetirMeses = Number(form.repetir) || 1;
        await api.post("/financeiro/movimentos", body);
      }
      setEditingId(null);
      setForm({ ...emptyForm(), tipo: form.tipo, banco: form.banco });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao gravar.");
    } finally {
      setBusy(false);
    }
  }

  function edit(m: Movimento) {
    setEditingId(m.id);
    setForm({
      tipo: m.tipo,
      descricao: m.descricao,
      entidade: m.entidade ?? "",
      banco: m.banco ?? "",
      valor: String(m.valor).replace(".", ","),
      estimado: m.estimado,
      data: d10(m.data),
      repetir: "1",
      estado: m.estado,
      valorPago: m.valorPago !== null ? String(m.valorPago).replace(".", ",") : "",
      notas: m.notas ?? "",
    });
    setTimeout(() => {
      const el = document.getElementById("m-desc") as HTMLInputElement | null;
      el?.closest("form")?.scrollIntoView({ behavior: "smooth", block: "start" });
      el?.focus({ preventScroll: true });
    }, 50);
  }

  async function gravarPago(m: Movimento) {
    if (!pagar) return;
    const v = parseValor(pagar.valor);
    if (!v || v <= 0) return;
    await api.put(`/financeiro/movimentos/${m.id}`, { estado: "PAGO", valorPago: v, pagoEm: pagar.data || hoje });
    setPagar(null);
    await reload();
  }

  async function desfazer(m: Movimento) {
    await api.put(`/financeiro/movimentos/${m.id}`, { estado: "POR_PAGAR", pagoEm: null, valorPago: null });
    await reload();
  }

  async function gravarAdiamento(m: Movimento) {
    if (!adiar?.data) return;
    await api.put(`/financeiro/movimentos/${m.id}`, { data: adiar.data });
    setAdiar(null);
    await reload();
  }

  async function remove(m: Movimento) {
    let grupo = false;
    if (m.grupoId) {
      const seguintes = movs.filter((x) => x.grupoId === m.grupoId && d10(x.data) > d10(m.data) && x.estado === "POR_PAGAR").length;
      if (seguintes > 0) {
        grupo = window.confirm(
          `"${m.descricao}" repete-se todos os meses.\n\nOK = apagar este e os ${seguintes} seguintes por pagar.\nCancelar = escolher só este.`
        );
        if (!grupo && !window.confirm(`Apagar só "${m.descricao}" de ${formatDay(d10(m.data))}?`)) return;
      } else if (!window.confirm(`Apagar "${m.descricao}" de ${formatDay(d10(m.data))} (${eur(m.valor)})?`)) return;
    } else if (!window.confirm(`Apagar "${m.descricao}" de ${formatDay(d10(m.data))} (${eur(m.valor)})?`)) return;
    await api.delete(`/financeiro/movimentos/${m.id}${grupo ? "?grupo=1" : ""}`);
    await reload();
  }

  const abertos = movs.filter((m) => m.estado === "POR_PAGAR");
  const atraso = abertos.filter((m) => d10(m.data) < hoje);
  const shown = movs
    .filter((m) => {
      if (filtro === "abertos" && m.estado !== "POR_PAGAR") return false;
      if (filtro === "atraso" && !(m.estado === "POR_PAGAR" && d10(m.data) < hoje)) return false;
      if (filtro === "PAGO" && m.estado !== "PAGO") return false;
      if (tipo && m.tipo !== tipo) return false;
      if (q) {
        const t = [m.descricao, m.entidade, m.banco, m.notas].join(" ").toLowerCase();
        if (!t.includes(q.toLowerCase())) return false;
      }
      return true;
    })
    .sort((a, b) => (filtro === "PAGO" || filtro === "todos" ? d10(b.data).localeCompare(d10(a.data)) : d10(a.data).localeCompare(d10(b.data))));
  const total = shown.reduce((s, m) => s + valorMov(m), 0);
  const nEst = shown.filter((m) => m.estimado && m.estado !== "PAGO").length;

  const filtros: [FiltroMov, string, number][] = [
    ["abertos", "Por pagar", abertos.length],
    ["atraso", "Em atraso", atraso.length],
    ["PAGO", "Pagos", movs.filter((m) => m.estado === "PAGO").length],
    ["todos", "Todos", movs.length],
  ];

  return (
    <div className="ef-two">
      <form className="card ef-form" onSubmit={submit}>
        <h3>{editingId ? "Editar" : "Registar transferência ou pagamento"}</h3>
        <div className="fin-seg" role="radiogroup" aria-label="Tipo">
          {(["PAGAMENTO", "TRANSFERENCIA"] as TipoMov[]).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={form.tipo === t}
              className={form.tipo === t ? "on" : ""}
              onClick={() => setForm({ ...form, tipo: t })}
            >
              {t === "PAGAMENTO" ? "Pagamento a fazer" : "Transferência programada"}
            </button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="m-desc">O que é</label>
          <input
            id="m-desc"
            type="text"
            list="m-desc-list"
            placeholder={form.tipo === "PAGAMENTO" ? "ex.: IVA, Segurança Social, renda" : "ex.: ordenados, leasing, fornecedor"}
            value={form.descricao}
            onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            required
          />
          <datalist id="m-desc-list">
            {descricoes.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </div>
        <div className="field">
          <label htmlFor="m-ent">A quem (opcional)</label>
          <input id="m-ent" type="text" list="m-ent-list" placeholder="ex.: Finanças, fornecedor" value={form.entidade} onChange={(e) => setForm({ ...form, entidade: e.target.value })} />
          <datalist id="m-ent-list">
            {entidades.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </div>
        <div className="ef-row">
          <div className="field">
            <label htmlFor="m-valor">{form.estimado ? "Valor previsto (€)" : "Valor (€)"}</label>
            <input id="m-valor" type="text" inputMode="decimal" placeholder="0,00" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} required />
          </div>
          <div className="field">
            <label htmlFor="m-data">Data</label>
            <input id="m-data" type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} required />
          </div>
        </div>
        <label className="fin-check">
          <input type="checkbox" checked={form.estimado} onChange={(e) => setForm({ ...form, estimado: e.target.checked })} />
          <span>
            <strong>Valor estimado (±)</strong>
            <small>Para o que ainda não sabes ao certo, como o IVA. Quando pagares, pões o valor final.</small>
          </span>
        </label>
        <div className="ef-row">
          <div className="field">
            <label htmlFor="m-banco">Banco (opcional)</label>
            <input id="m-banco" type="text" list="m-banco-list" value={form.banco} onChange={(e) => setForm({ ...form, banco: e.target.value })} />
            <datalist id="m-banco-list">
              {bancos.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </div>
          {!editingId ? (
            <div className="field">
              <label htmlFor="m-rep">Repetir</label>
              <select id="m-rep" value={form.repetir} onChange={(e) => setForm({ ...form, repetir: e.target.value })}>
                <option value="1">Só uma vez</option>
                <option value="3">Todos os meses · 3 meses</option>
                <option value="6">Todos os meses · 6 meses</option>
                <option value="12">Todos os meses · 12 meses</option>
                <option value="24">Todos os meses · 24 meses</option>
              </select>
            </div>
          ) : (
            <div className="field">
              <label htmlFor="m-estado">Estado</label>
              <select id="m-estado" value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value as EstadoMov })}>
                {(Object.keys(ESTADO_LABEL) as EstadoMov[]).map((k) => (
                  <option key={k} value={k}>
                    {ESTADO_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        {editingId && form.estado === "PAGO" && (
          <div className="field">
            <label htmlFor="m-vpago">Valor pago (€)</label>
            <input id="m-vpago" type="text" inputMode="decimal" placeholder={form.valor} value={form.valorPago} onChange={(e) => setForm({ ...form, valorPago: e.target.value })} />
          </div>
        )}
        <div className="field">
          <label htmlFor="m-notas">Observações</label>
          <input id="m-notas" type="text" value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="ef-form-actions">
          <button className="btn" type="submit" disabled={busy}>
            {editingId ? "Guardar alterações" : "Registar"}
          </button>
          {editingId && (
            <button
              className="btn secondary"
              type="button"
              onClick={() => {
                setEditingId(null);
                setForm(emptyForm());
              }}
            >
              Cancelar
            </button>
          )}
        </div>
      </form>

      <div className="card ef-table-card">
        <div className="fin-filtros">
          {filtros.map(([k, l, n]) => (
            <button key={k} type="button" className={`fin-chip${filtro === k ? " on" : ""}${k === "atraso" && n ? " warn" : ""}`} onClick={() => setFiltro(k)}>
              {l} <span>{n}</span>
            </button>
          ))}
        </div>
        <div className="ef-table-head">
          <h3>
            {shown.length} · {eur(total)}
            {nEst > 0 && <span className="fin-est-note"> · {nEst} com valor estimado</span>}
          </h3>
          <div className="ef-filters">
            <input className="fin-search" type="search" placeholder="Pesquisar…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select aria-label="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value as "" | TipoMov)}>
              <option value="">Transferências e pagamentos</option>
              <option value="TRANSFERENCIA">Só transferências</option>
              <option value="PAGAMENTO">Só pagamentos</option>
            </select>
          </div>
        </div>
        <div className="ef-scroll">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>O quê</th>
                <th>Tipo</th>
                <th className="num">Valor</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    {movs.length ? "Nada com estes filtros." : "Ainda não há transferências nem pagamentos registados."}
                  </td>
                </tr>
              )}
              {shown.map((m) => {
                const d = d10(m.data);
                const late = m.estado === "POR_PAGAR" && d < hoje;
                const soon = m.estado === "POR_PAGAR" && !late && d <= addDays(hoje, 7);
                return (
                  <tr key={m.id} className={m.estado === "ANULADO" ? "fin-anulado" : ""}>
                    <td className="ef-nowrap">
                      <strong className={late ? "fin-late" : soon ? "fin-soon" : ""}>{formatDay(d)}</strong>
                      {m.grupoId && <div className="cell-sub">todos os meses</div>}
                    </td>
                    <td>
                      <strong>{m.descricao}</strong>
                      {(m.entidade || m.banco || m.notas) && <div className="cell-sub">{[m.entidade, m.banco, m.notas].filter(Boolean).join(" · ")}</div>}
                    </td>
                    <td>
                      <span className={`fin-tipo fin-tipo-${m.tipo.toLowerCase()}`}>{TIPO_LABEL[m.tipo]}</span>
                    </td>
                    <td className="num ef-nowrap">
                      <strong>
                        {m.estimado && m.estado !== "PAGO" ? "± " : ""}
                        {eur(valorMov(m))}
                      </strong>
                      {m.estado === "PAGO" && m.valorPago !== null && m.valorPago !== m.valor && <div className="cell-sub">previsto {eur(m.valor)}</div>}
                      {m.estimado && m.estado !== "PAGO" && <div className="cell-sub">estimado</div>}
                    </td>
                    <td className="ef-nowrap">
                      <span className={`fin-estado fin-mov-${m.estado.toLowerCase()}${late ? " late" : ""}`}>{late ? "Em atraso" : ESTADO_LABEL[m.estado]}</span>
                      {m.estado === "PAGO" && m.pagoEm && <div className="cell-sub">em {formatDay(d10(m.pagoEm))}</div>}
                    </td>
                    <td className="ef-row-actions">
                      {adiar?.id === m.id ? (
                        <>
                          <input
                            type="date"
                            aria-label="Nova data"
                            value={adiar.data}
                            autoFocus
                            onChange={(e) => setAdiar({ id: m.id, data: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") gravarAdiamento(m);
                              if (e.key === "Escape") setAdiar(null);
                            }}
                            style={{ width: "auto" }}
                          />
                          <button className="btn" type="button" onClick={() => gravarAdiamento(m)}>
                            Gravar
                          </button>
                          <button className="btn secondary" type="button" onClick={() => setAdiar(null)}>
                            Cancelar
                          </button>
                        </>
                      ) : pagar?.id === m.id ? (
                        <>
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label="Valor pago"
                            value={pagar.valor}
                            autoFocus
                            onChange={(e) => setPagar({ ...pagar, valor: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") gravarPago(m);
                              if (e.key === "Escape") setPagar(null);
                            }}
                            style={{ width: 110 }}
                          />
                          <input type="date" aria-label="Pago em" value={pagar.data} onChange={(e) => setPagar({ ...pagar, data: e.target.value })} style={{ width: "auto" }} />
                          <button className="btn" type="button" onClick={() => gravarPago(m)}>
                            Gravar
                          </button>
                          <button className="btn secondary" type="button" onClick={() => setPagar(null)}>
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          {m.estado === "POR_PAGAR" && (
                            <button className="btn secondary" type="button" onClick={() => setAdiar({ id: m.id, data: d })} title="Mudar a data">
                              Adiar
                            </button>
                          )}
                          {m.estado === "POR_PAGAR" && (
                            <button
                              className="btn"
                              type="button"
                              title={m.estimado ? "Pôr o valor final" : "Já foi pago"}
                              onClick={async () => {
                                if (m.estimado) setPagar({ id: m.id, valor: String(m.valor).replace(".", ","), data: hoje });
                                else {
                                  await api.put(`/financeiro/movimentos/${m.id}`, { estado: "PAGO", valorPago: m.valor, pagoEm: hoje });
                                  await reload();
                                }
                              }}
                            >
                              Pago
                            </button>
                          )}
                          {m.estado === "PAGO" && (
                            <button className="btn secondary" type="button" onClick={() => desfazer(m)}>
                              Desfazer
                            </button>
                          )}
                          <button className="btn secondary" type="button" onClick={() => edit(m)} title="Editar" aria-label="Editar">
                            ✎
                          </button>
                          <button className="btn secondary" type="button" onClick={() => remove(m)} title="Apagar" aria-label="Apagar">
                            ✕
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba "Calendário"
// ---------------------------------------------------------------------------

type Kind = "cheque" | "transferencia" | "pagamento";

interface Item {
  key: string;
  kind: Kind;
  data: string;
  titulo: string;
  sub: string;
  valor: number;
  estimado: boolean;
  feito: boolean;
  late: boolean;
  cheque?: ChequeLite;
  mov?: Movimento;
}

const KIND_LABEL: Record<Kind, string> = { cheque: "Cheque", transferencia: "Transferência", pagamento: "Pagamento" };
const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

export function CalendarioTab({
  cheques,
  movs,
  reload,
  agenda,
}: {
  cheques: ChequeLite[];
  movs: Movimento[];
  reload: () => Promise<void>;
  /** Mostrar transferências e pagamentos (feature em teste). */
  agenda: boolean;
}) {
  const hoje = todayIso();
  const [mes, setMes] = useState(hoje.slice(0, 7));
  const [dia, setDia] = useState<string | null>(hoje);
  const [ver, setVer] = useState<Record<Kind, boolean>>({ cheque: true, transferencia: true, pagamento: true });

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const c of cheques) {
      if (c.estado === "ANULADO") continue;
      const d = d10(c.dataCheque);
      const feito = c.estado === "DESCONTADO";
      out.push({
        key: `c${c.id}`,
        kind: "cheque",
        data: d,
        titulo: c.beneficiario,
        sub: `${c.banco} · nº ${c.numero}`,
        valor: c.valor,
        estimado: false,
        feito,
        late: !feito && d < hoje,
        cheque: c,
      });
    }
    if (agenda) {
      for (const m of movs) {
        if (m.estado === "ANULADO") continue;
        const d = d10(m.data);
        const feito = m.estado === "PAGO";
        out.push({
          key: `m${m.id}`,
          kind: m.tipo === "TRANSFERENCIA" ? "transferencia" : "pagamento",
          data: d,
          titulo: m.descricao,
          sub: [m.entidade, m.banco].filter(Boolean).join(" · "),
          valor: valorMov(m),
          estimado: m.estimado && !feito,
          feito,
          late: !feito && d < hoje,
          mov: m,
        });
      }
    }
    return out.filter((i) => ver[i.kind]).sort((a, b) => Number(a.feito) - Number(b.feito) || b.valor - a.valor);
  }, [cheques, movs, agenda, ver, hoje]);

  const byDay = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of items) m.set(i.data, [...(m.get(i.data) ?? []), i]);
    return m;
  }, [items]);

  // Grelha do mês: de segunda a domingo, a começar na segunda antes do dia 1.
  const days = useMemo(() => {
    const first = `${mes}-01`;
    const wd = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
    const start = addDays(first, -wd);
    const out: string[] = [];
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      if (i >= 35 && d.slice(0, 7) !== mes) break;
      out.push(d);
    }
    return out;
  }, [mes]);

  const doMes = items.filter((i) => i.data.slice(0, 7) === mes);
  const totais = (k: Kind) => {
    const l = doMes.filter((i) => i.kind === k);
    const aberto = l.filter((i) => !i.feito);
    return {
      n: l.length,
      aberto: aberto.reduce((s, i) => s + i.valor, 0),
      feito: l.filter((i) => i.feito).reduce((s, i) => s + i.valor, 0),
      est: aberto.filter((i) => i.estimado).length,
    };
  };
  const atraso = items.filter((i) => i.late);
  const totalAberto = doMes.filter((i) => !i.feito).reduce((s, i) => s + i.valor, 0);
  const temEst = doMes.some((i) => !i.feito && i.estimado);

  async function feito(i: Item) {
    if (i.cheque) await api.put(`/financeiro/cheques/${i.cheque.id}`, { estado: "DESCONTADO", descontadoEm: hoje });
    else if (i.mov) {
      if (i.mov.estimado) {
        const v = window.prompt(`Valor final de "${i.mov.descricao}" (previsto ${eur(i.mov.valor)}):`, String(i.mov.valor).replace(".", ","));
        if (v === null) return;
        const n = parseValor(v);
        if (!n || n <= 0) return;
        await api.put(`/financeiro/movimentos/${i.mov.id}`, { estado: "PAGO", valorPago: n, pagoEm: hoje });
      } else await api.put(`/financeiro/movimentos/${i.mov.id}`, { estado: "PAGO", valorPago: i.mov.valor, pagoEm: hoje });
    }
    await reload();
  }

  const kinds: Kind[] = agenda ? ["cheque", "transferencia", "pagamento"] : ["cheque"];
  const diaItems = dia ? byDay.get(dia) ?? [] : [];

  return (
    <div className="card fcal">
      <div className="fcal-head">
        <div className="fcal-nav">
          <button type="button" className="btn secondary" onClick={() => setMes(shiftMonth(mes, -1))} aria-label="Mês anterior">
            ‹
          </button>
          <h3>{monthLabel(mes)}</h3>
          <button type="button" className="btn secondary" onClick={() => setMes(shiftMonth(mes, 1))} aria-label="Mês seguinte">
            ›
          </button>
          {mes !== hoje.slice(0, 7) && (
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setMes(hoje.slice(0, 7));
                setDia(hoje);
              }}
            >
              Hoje
            </button>
          )}
        </div>
        <div className="fcal-legend">
          {kinds.map((k) => (
            <label key={k} className={`fcal-key fcal-${k}`}>
              <input type="checkbox" checked={ver[k]} onChange={(e) => setVer({ ...ver, [k]: e.target.checked })} />
              <i />
              {KIND_LABEL[k]}s
            </label>
          ))}
        </div>
      </div>

      <div className="fcal-sums">
        {kinds.map((k) => {
          const t = totais(k);
          return (
            <div key={k} className={`fcal-sum fcal-${k}`}>
              <span>{KIND_LABEL[k]}s por sair</span>
              <strong>
                {t.est ? "± " : ""}
                {eur(t.aberto)}
              </strong>
              <small>
                {t.n} no mês{t.feito ? ` · ${eur0(t.feito)} já saiu` : ""}
              </small>
            </div>
          );
        })}
        <div className="fcal-sum fcal-total">
          <span>Total por sair no mês</span>
          <strong>
            {temEst ? "± " : ""}
            {eur(totalAberto)}
          </strong>
          <small>{temEst ? "inclui valores estimados" : "valores certos"}</small>
        </div>
      </div>

      {atraso.length > 0 && (
        <div className="fcal-alert">
          <strong>Em atraso:</strong> {atraso.length} {atraso.length === 1 ? "movimento" : "movimentos"} · {eur(atraso.reduce((s, i) => s + i.valor, 0))} com a data já
          passada e ainda por sair.
        </div>
      )}

      <div className="fcal-grid" role="grid" aria-label={`Calendário de ${monthLabel(mes)}`}>
        {WEEKDAYS.map((w) => (
          <div key={w} className="fcal-wd" role="columnheader">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const l = byDay.get(d) ?? [];
          const fora = d.slice(0, 7) !== mes;
          const aberto = l.filter((i) => !i.feito);
          const tot = aberto.reduce((s, i) => s + i.valor, 0);
          const wk = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7 >= 5;
          return (
            <button
              key={d}
              type="button"
              role="gridcell"
              className={`fcal-day${fora ? " out" : ""}${d === hoje ? " today" : ""}${d === dia ? " sel" : ""}${l.length ? "" : " empty"}${wk ? " wk" : ""}`}
              onClick={() => setDia(d)}
              aria-label={`${formatDay(d)}: ${l.length} movimentos`}
            >
              <span className="fcal-num">
                <span className="fcal-wdm">{formatDay(d)}</span>
                <span className="fcal-dn">{Number(d.slice(8))}</span>
              </span>
              <span className="fcal-items">
                {l.slice(0, 4).map((i) => (
                  <span key={i.key} className={`fcal-item fcal-${i.kind}${i.feito ? " done" : ""}${i.late ? " late" : ""}`} title={`${KIND_LABEL[i.kind]} · ${i.titulo} · ${i.estimado ? "± " : ""}${eur(i.valor)}`}>
                    <span className="t">{i.titulo}</span>
                    <span className="v">
                      {i.estimado ? "±" : ""}
                      {eur0(i.valor)}
                    </span>
                  </span>
                ))}
                {l.length > 4 && <span className="fcal-more">+{l.length - 4} mais</span>}
              </span>
              {tot > 0 && (
                <span className="fcal-tot">
                  {aberto.some((i) => i.estimado) ? "±" : ""}
                  {eur0(tot)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {dia && (
        <div className="fcal-detail">
          <h4>
            {formatDay(dia)}
            {diaItems.length > 0 && (
              <span>
                {" "}
                · {diaItems.length} {diaItems.length === 1 ? "movimento" : "movimentos"} ·{" "}
                {eur(diaItems.filter((i) => !i.feito).reduce((s, i) => s + i.valor, 0))} por sair
              </span>
            )}
          </h4>
          {diaItems.length === 0 && <p className="muted">Nada marcado para este dia.</p>}
          {diaItems.map((i) => (
            <div key={i.key} className={`fcal-row fcal-${i.kind}${i.feito ? " done" : ""}`}>
              <i />
              <div className="fcal-row-main">
                <strong>{i.titulo}</strong>
                <small>
                  {KIND_LABEL[i.kind]}
                  {i.sub ? ` · ${i.sub}` : ""}
                  {i.feito ? (i.kind === "cheque" ? " · descontado" : " · pago") : i.late ? " · em atraso" : ""}
                </small>
              </div>
              <strong className="fcal-row-v">
                {i.estimado ? "± " : ""}
                {eur(i.valor)}
              </strong>
              {!i.feito && (
                <button type="button" className="btn sm" onClick={() => feito(i)}>
                  {i.kind === "cheque" ? "Descontado" : "Pago"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
