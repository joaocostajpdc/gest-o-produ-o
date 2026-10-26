import { FormEvent, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../contexts/AuthContext";
import { useFeature } from "../contexts/FeaturesContext";
import { Kpi, formatDay, todayIso } from "../components/EquipaFrota";

// ============================================================================
// Financeiro — Cheques passados (pedido do utilizador de 2026-10-24: "cria
// uma parte para o financeiro já, apenas eu" → "cheques passados").
// Regista os cheques que a empresa passa (a quem, banco, valor e data do
// cheque) e mostra o que vai sair do banco por semana e por mês.
// Só o administrador e quem ele escolher veem esta parte (Alice, 2026-10-25).
// ============================================================================

type Estado = "POR_DESCONTAR" | "DESCONTADO" | "ANULADO";

interface Cheque {
  id: string;
  numero: string;
  banco: string;
  beneficiario: string;
  valor: number;
  dataEmissao: string;
  dataCheque: string;
  estado: Estado;
  descontadoEm: string | null;
  referencia: string | null;
  notas: string | null;
}

const ESTADO_LABEL: Record<Estado, string> = {
  POR_DESCONTAR: "Por descontar",
  DESCONTADO: "Descontado",
  ANULADO: "Anulado",
};

const eur = (n: number) => n.toLocaleString("pt-PT", { style: "currency", currency: "EUR" });
const d10 = (s: string) => s.slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const monthKey = (iso: string) => iso.slice(0, 7);
const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  const s = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("pt-PT", { month: "long", year: "numeric", timeZone: "UTC" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
// Segunda-feira da semana de uma data.
const weekStart = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd);
  return d.toISOString().slice(0, 10);
};

const emptyForm = () => ({
  numero: "",
  banco: "",
  beneficiario: "",
  valor: "",
  dataEmissao: todayIso(),
  dataCheque: todayIso(),
  estado: "POR_DESCONTAR" as Estado,
  referencia: "",
  notas: "",
});

type Tab = "cheques" | "semanas" | "meses";
type Filtro = "abertos" | "atraso" | "DESCONTADO" | "ANULADO" | "todos";

export function FinanceiroPage() {
  const { user } = useAuth();
  const feature = useFeature("financeiro");
  const [list, setList] = useState<Cheque[]>([]);
  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Adiar um cheque direto na linha (pedido de 2026-10-26).
  const [adiar, setAdiar] = useState<{ id: string; data: string } | null>(null);
  const [tab, setTab] = useState<Tab>("cheques");
  const [filtro, setFiltro] = useState<Filtro>("abertos");
  const [banco, setBanco] = useState("");
  const [q, setQ] = useState("");

  // Restrito: administrador e quem ele escolher (a Alice, desde 2026-10-25).
  const allowed = feature.available;
  const hoje = todayIso();

  async function load() {
    setLoading(true);
    try {
      setList(await api.get<Cheque[]>("/financeiro/cheques"));
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!allowed) return;
    load();
    api
      .get<{ name: string }[]>("/suppliers")
      .then((s) => setSuppliers(s.map((x) => x.name)))
      .catch(() => setSuppliers([]));
  }, [allowed]);

  const abertos = useMemo(() => list.filter((c) => c.estado === "POR_DESCONTAR"), [list]);
  const sum = (l: Cheque[]) => l.reduce((s, c) => s + c.valor, 0);
  const emAtraso = abertos.filter((c) => d10(c.dataCheque) < hoje);
  const semana = abertos.filter((c) => d10(c.dataCheque) >= hoje && d10(c.dataCheque) <= addDays(hoje, 7));
  const mesAtual = abertos.filter((c) => monthKey(d10(c.dataCheque)) === monthKey(hoje));
  const bancos = useMemo(() => [...new Set(list.map((c) => c.banco))].sort((a, b) => a.localeCompare(b, "pt")), [list]);
  const beneficiarios = useMemo(
    () => [...new Set([...list.map((c) => c.beneficiario), ...suppliers])].sort((a, b) => a.localeCompare(b, "pt")),
    [list, suppliers]
  );

  // Saídas previstas por semana (próximas 12 semanas + atrasados).
  const porSemana = useMemo(() => {
    const ini = weekStart(hoje);
    const rows: { key: string; label: string; total: number; n: number; bancos: Map<string, number> }[] = [];
    const atr = { key: "atraso", label: "Em atraso (data já passou)", total: 0, n: 0, bancos: new Map<string, number>() };
    for (let i = 0; i < 12; i++) {
      const k = addDays(ini, i * 7);
      rows.push({ key: k, label: `${i === 0 ? "Esta semana · " : i === 1 ? "Próxima · " : ""}${dm(k)} a ${dm(addDays(k, 6))}`, total: 0, n: 0, bancos: new Map() });
    }
    let depois = 0;
    for (const c of abertos) {
      const d = d10(c.dataCheque);
      const row = d < ini ? atr : rows.find((r) => d >= r.key && d <= addDays(r.key, 6));
      if (!row) {
        depois += c.valor;
        continue;
      }
      row.total += c.valor;
      row.n++;
      row.bancos.set(c.banco, (row.bancos.get(c.banco) ?? 0) + c.valor);
    }
    return { rows: atr.n ? [atr, ...rows] : rows, depois };
  }, [abertos, hoje]);

  // Por mês: o que está por descontar e o que já foi descontado.
  const porMes = useMemo(() => {
    const map = new Map<string, { key: string; aberto: number; nAberto: number; descontado: number; nDesc: number; bancos: Map<string, number> }>();
    for (const c of list) {
      if (c.estado === "ANULADO") continue;
      const k = monthKey(d10(c.dataCheque));
      const row = map.get(k) ?? { key: k, aberto: 0, nAberto: 0, descontado: 0, nDesc: 0, bancos: new Map() };
      if (c.estado === "POR_DESCONTAR") {
        row.aberto += c.valor;
        row.nAberto++;
      } else {
        row.descontado += c.valor;
        row.nDesc++;
      }
      row.bancos.set(c.banco, (row.bancos.get(c.banco) ?? 0) + c.valor);
      map.set(k, row);
    }
    return [...map.values()].sort((a, b) => b.key.localeCompare(a.key));
  }, [list]);

  if (feature.loading) return <div className="muted">A carregar...</div>;
  if (feature.loading) return null;
  if (!allowed) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const valor = Number(String(form.valor).replace(/\s/g, "").replace(",", "."));
    if (!valor || valor <= 0) return setError("Indica o valor do cheque.");
    setBusy(true);
    try {
      const body = {
        numero: form.numero,
        banco: form.banco,
        beneficiario: form.beneficiario,
        valor,
        dataEmissao: form.dataEmissao,
        dataCheque: form.dataCheque,
        estado: form.estado,
        referencia: form.referencia || null,
        notas: form.notas || null,
      };
      if (editingId) await api.put(`/financeiro/cheques/${editingId}`, body);
      else await api.post("/financeiro/cheques", body);
      setEditingId(null);
      // Fica pronto para o cheque seguinte do mesmo livro (nº seguinte, mesmo banco).
      const n = /^\d+$/.test(form.numero) ? String(Number(form.numero) + 1).padStart(form.numero.length, "0") : "";
      setForm({ ...emptyForm(), banco: form.banco, numero: editingId ? "" : n, dataEmissao: form.dataEmissao });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao gravar.");
    } finally {
      setBusy(false);
    }
  }

  function edit(c: Cheque) {
    setEditingId(c.id);
    setForm({
      numero: c.numero,
      banco: c.banco,
      beneficiario: c.beneficiario,
      valor: String(c.valor).replace(".", ","),
      dataEmissao: d10(c.dataEmissao),
      dataCheque: d10(c.dataCheque),
      estado: c.estado,
      referencia: c.referencia ?? "",
      notas: c.notas ?? "",
    });
    setTab("cheques");
    // O ecrã pode estar dentro de uma aba: leva o formulário à vista e põe o cursor na data.
    setTimeout(() => {
      const el = document.getElementById("c-data") as HTMLInputElement | null;
      el?.closest("form")?.scrollIntoView({ behavior: "smooth", block: "start" });
      el?.focus({ preventScroll: true });
    }, 50);
  }

  async function setEstado(c: Cheque, estado: Estado) {
    await api.put(`/financeiro/cheques/${c.id}`, { estado, descontadoEm: estado === "DESCONTADO" ? hoje : null });
    await load();
  }

  async function gravarAdiamento(c: Cheque) {
    if (!adiar || !adiar.data) return;
    await api.put(`/financeiro/cheques/${c.id}`, { dataCheque: adiar.data });
    setAdiar(null);
    await load();
  }

  async function remove(c: Cheque) {
    if (!window.confirm(`Apagar o cheque nº ${c.numero} (${c.beneficiario}, ${eur(c.valor)})?`)) return;
    await api.delete(`/financeiro/cheques/${c.id}`);
    await load();
  }

  const qq = q.trim().toLowerCase();
  const shown = list
    .filter((c) => {
      if (filtro === "abertos" && c.estado !== "POR_DESCONTAR") return false;
      if (filtro === "atraso" && !(c.estado === "POR_DESCONTAR" && d10(c.dataCheque) < hoje)) return false;
      if ((filtro === "DESCONTADO" || filtro === "ANULADO") && c.estado !== filtro) return false;
      if (banco && c.banco !== banco) return false;
      if (qq && ![c.numero, c.beneficiario, c.banco, c.referencia ?? "", c.notas ?? ""].some((s) => s.toLowerCase().includes(qq))) return false;
      return true;
    })
    .sort((a, b) =>
      filtro === "DESCONTADO" || filtro === "todos"
        ? d10(b.dataCheque).localeCompare(d10(a.dataCheque))
        : d10(a.dataCheque).localeCompare(d10(b.dataCheque))
    );

  const filtros: [Filtro, string, number][] = [
    ["abertos", "Por descontar", abertos.length],
    ["atraso", "Em atraso", emAtraso.length],
    ["DESCONTADO", "Descontados", list.filter((c) => c.estado === "DESCONTADO").length],
    ["ANULADO", "Anulados", list.filter((c) => c.estado === "ANULADO").length],
    ["todos", "Todos", list.length],
  ];

  return (
    <div>
      <div className="page-header">
        <h2>Financeiro · Cheques passados</h2>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
        🔒 Só tu vês esta parte.
      </p>

      <div className="ef-kpis">
        <Kpi label="Por descontar" value={eur(sum(abertos))} sub={`${abertos.length} ${abertos.length === 1 ? "cheque" : "cheques"} em circulação`} />
        <Kpi label="Próximos 7 dias" value={eur(sum(semana))} sub={`${semana.length} ${semana.length === 1 ? "cheque" : "cheques"} a sair`} />
        <Kpi label="Este mês" value={eur(sum(mesAtual))} sub={`por descontar em ${monthLabel(monthKey(hoje)).toLowerCase()}`} />
        <Kpi
          label="Em atraso"
          value={eur(sum(emAtraso))}
          sub={emAtraso.length ? `${emAtraso.length} com a data já passada` : "nenhum"}
        />
      </div>

      <div className="tabs" role="tablist">
        {(
          [
            ["cheques", "Cheques"],
            ["semanas", "Saídas por semana"],
            ["meses", "Por mês"],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      {tab === "cheques" && (
        <div className="ef-two">
          <form className="card ef-form" onSubmit={submit}>
            <h3>{editingId ? "Editar cheque" : "Registar cheque"}</h3>
            <div className="field">
              <label htmlFor="c-benef">Passado a</label>
              <input
                id="c-benef"
                type="text"
                list="c-benef-list"
                placeholder="Fornecedor ou entidade"
                value={form.beneficiario}
                onChange={(e) => setForm({ ...form, beneficiario: e.target.value })}
                required
              />
              <datalist id="c-benef-list">
                {beneficiarios.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </div>
            <div className="ef-row">
              <div className="field">
                <label htmlFor="c-valor">Valor (€)</label>
                <input id="c-valor" type="text" inputMode="decimal" placeholder="0,00" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} required />
              </div>
              <div className="field">
                <label htmlFor="c-num">Nº do cheque</label>
                <input id="c-num" type="text" inputMode="numeric" value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} required />
              </div>
            </div>
            <div className="field">
              <label htmlFor="c-banco">Banco</label>
              <input id="c-banco" type="text" list="c-banco-list" placeholder="ex.: CGD, Millennium, Crédito Agrícola" value={form.banco} onChange={(e) => setForm({ ...form, banco: e.target.value })} required />
              <datalist id="c-banco-list">
                {bancos.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </div>
            <div className="ef-row">
              <div className="field">
                <label htmlFor="c-emis">Passado em</label>
                <input id="c-emis" type="date" value={form.dataEmissao} onChange={(e) => setForm({ ...form, dataEmissao: e.target.value })} required />
              </div>
              <div className="field">
                <label htmlFor="c-data">Data do cheque</label>
                <input id="c-data" type="date" value={form.dataCheque} onChange={(e) => setForm({ ...form, dataCheque: e.target.value })} required />
              </div>
            </div>
            <div className="field">
              <label htmlFor="c-ref">Faturas / referência</label>
              <input id="c-ref" type="text" placeholder="ex.: FT 2026/1234, 1240" value={form.referencia} onChange={(e) => setForm({ ...form, referencia: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="c-notas">Observações</label>
              <input id="c-notas" type="text" value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
            </div>
            {editingId && (
              <div className="field">
                <label htmlFor="c-estado">Estado</label>
                <select id="c-estado" value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value as Estado })}>
                  {(Object.keys(ESTADO_LABEL) as Estado[]).map((k) => (
                    <option key={k} value={k}>
                      {ESTADO_LABEL[k]}
                    </option>
                  ))}
                </select>
              </div>
            )}
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
                {shown.length} {shown.length === 1 ? "cheque" : "cheques"} · {eur(sum(shown))}
              </h3>
              <div className="ef-filters">
                <input className="fin-search" type="search" placeholder="Pesquisar nº, a quem, fatura…" value={q} onChange={(e) => setQ(e.target.value)} />
                <select aria-label="Filtrar por banco" value={banco} onChange={(e) => setBanco(e.target.value)}>
                  <option value="">Todos os bancos</option>
                  {bancos.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="ef-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Data do cheque</th>
                    <th>Passado a</th>
                    <th>Banco · nº</th>
                    <th className="num">Valor</th>
                    <th>Estado</th>
                    <th aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={6} className="muted">A carregar...</td>
                    </tr>
                  )}
                  {!loading && shown.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted">{list.length ? "Nenhum cheque com estes filtros." : "Ainda não há cheques registados."}</td>
                    </tr>
                  )}
                  {!loading &&
                    shown.map((c) => {
                      const d = d10(c.dataCheque);
                      const late = c.estado === "POR_DESCONTAR" && d < hoje;
                      const soon = c.estado === "POR_DESCONTAR" && !late && d <= addDays(hoje, 7);
                      return (
                        <tr key={c.id} className={c.estado === "ANULADO" ? "fin-anulado" : ""}>
                          <td className="ef-nowrap">
                            <strong className={late ? "fin-late" : soon ? "fin-soon" : ""}>{formatDay(d)}</strong>
                            <div className="cell-sub">passado {formatDay(d10(c.dataEmissao))}</div>
                          </td>
                          <td>
                            <strong>{c.beneficiario}</strong>
                            {(c.referencia || c.notas) && <div className="cell-sub">{[c.referencia, c.notas].filter(Boolean).join(" · ")}</div>}
                          </td>
                          <td className="ef-nowrap">
                            {c.banco}
                            <div className="cell-sub">nº {c.numero}</div>
                          </td>
                          <td className="num">
                            <strong>{eur(c.valor)}</strong>
                          </td>
                          <td className="ef-nowrap">
                            <span className={`fin-estado fin-${c.estado.toLowerCase()}${late ? " late" : ""}`}>
                              {late ? "Em atraso" : ESTADO_LABEL[c.estado]}
                            </span>
                            {c.estado === "DESCONTADO" && c.descontadoEm && <div className="cell-sub">em {formatDay(d10(c.descontadoEm))}</div>}
                          </td>
                          <td className="ef-row-actions">
                            {adiar?.id === c.id ? (
                              <>
                                <input
                                  type="date"
                                  aria-label="Nova data do cheque"
                                  value={adiar.data}
                                  autoFocus
                                  onChange={(e) => setAdiar({ id: c.id, data: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") gravarAdiamento(c);
                                    if (e.key === "Escape") setAdiar(null);
                                  }}
                                  style={{ width: "auto" }}
                                />
                                <button className="btn" type="button" onClick={() => gravarAdiamento(c)} disabled={!adiar.data}>
                                  Gravar
                                </button>
                                <button className="btn secondary" type="button" onClick={() => setAdiar(null)}>
                                  Cancelar
                                </button>
                              </>
                            ) : (
                            <>
                            {c.estado === "POR_DESCONTAR" && (
                              <button className="btn secondary" type="button" onClick={() => setAdiar({ id: c.id, data: d10(c.dataCheque) })} title="Mudar a data do cheque">
                                Adiar
                              </button>
                            )}
                            {c.estado === "POR_DESCONTAR" && (
                              <button className="btn" type="button" onClick={() => setEstado(c, "DESCONTADO")} title="Já saiu do banco">
                                Descontado
                              </button>
                            )}
                            {c.estado === "DESCONTADO" && (
                              <button className="btn secondary" type="button" onClick={() => setEstado(c, "POR_DESCONTAR")}>
                                Desfazer
                              </button>
                            )}
                            <button className="btn secondary" type="button" onClick={() => edit(c)} title="Editar" aria-label="Editar">
                              ✎
                            </button>
                            <button className="btn secondary" type="button" onClick={() => remove(c)} title="Apagar" aria-label="Apagar">
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
      )}

      {tab === "semanas" && (
        <div className="card ef-table-card">
          <div className="ef-table-head">
            <h3>O que vai sair do banco · próximas 12 semanas</h3>
          </div>
          <div className="ef-scroll">
            <table>
              <thead>
                <tr>
                  <th>Semana</th>
                  <th className="num">Cheques</th>
                  {bancos.map((b) => (
                    <th key={b} className="num">
                      {b}
                    </th>
                  ))}
                  <th className="num">Total</th>
                  <th className="num">Acumulado</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let acc = 0;
                  return porSemana.rows.map((r) => {
                    acc += r.total;
                    return (
                      <tr key={r.key} className={r.key === "atraso" ? "fin-row-late" : r.n ? "" : "fin-row-empty"}>
                        <td className="ef-nowrap">{r.label}</td>
                        <td className="num">{r.n || "—"}</td>
                        {bancos.map((b) => (
                          <td key={b} className="num">
                            {r.bancos.get(b) ? eur(r.bancos.get(b)!) : "—"}
                          </td>
                        ))}
                        <td className="num">
                          <strong>{r.total ? eur(r.total) : "—"}</strong>
                        </td>
                        <td className="num muted">{eur(acc)}</td>
                      </tr>
                    );
                  });
                })()}
                {porSemana.depois > 0 && (
                  <tr>
                    <td colSpan={2 + bancos.length} className="muted">
                      Mais tarde
                    </td>
                    <td className="num">
                      <strong>{eur(porSemana.depois)}</strong>
                    </td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "meses" && (
        <div className="card ef-table-card">
          <div className="ef-table-head">
            <h3>Cheques por mês (pela data do cheque)</h3>
          </div>
          <div className="ef-scroll">
            <table>
              <thead>
                <tr>
                  <th>Mês</th>
                  <th className="num">Por descontar</th>
                  <th className="num">Descontado</th>
                  {bancos.map((b) => (
                    <th key={b} className="num">
                      {b}
                    </th>
                  ))}
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {porMes.length === 0 && (
                  <tr>
                    <td colSpan={4 + bancos.length} className="muted">Ainda não há cheques registados.</td>
                  </tr>
                )}
                {porMes.map((r) => (
                  <tr key={r.key}>
                    <td className="ef-nowrap">{monthLabel(r.key)}</td>
                    <td className="num">
                      {r.aberto ? eur(r.aberto) : "—"}
                      {r.nAberto > 0 && <div className="cell-sub">{r.nAberto} ch.</div>}
                    </td>
                    <td className="num">
                      {r.descontado ? eur(r.descontado) : "—"}
                      {r.nDesc > 0 && <div className="cell-sub">{r.nDesc} ch.</div>}
                    </td>
                    {bancos.map((b) => (
                      <td key={b} className="num">
                        {r.bancos.get(b) ? eur(r.bancos.get(b)!) : "—"}
                      </td>
                    ))}
                    <td className="num">
                      <strong>{eur(r.aberto + r.descontado)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
