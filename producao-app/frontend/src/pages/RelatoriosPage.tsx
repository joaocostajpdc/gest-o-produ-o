import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api, downloadBlob } from "../api/client";
import { useFeature } from "../contexts/FeaturesContext";
import { FeatureTestBanner } from "../components/FeatureTestBanner";
import { Kpi, todayIso } from "../components/EquipaFrota";

// ============================================================================
// Relatórios de gestão (pedido do utilizador de 2026-10-26: "para melhorar a
// gestão quero ter acesso a um relatório da produção e a tudo o que se
// passa"). Escolhe-se o período (semana, mês ou datas à escolha), vê-se tudo
// aqui e tira-se o PDF. O mesmo relatório pode sair sozinho todas as semanas
// e todos os meses (Administração → Avisos Semanais).
// ============================================================================

interface Report {
  from: string;
  to: string;
  label: string;
  geradoEm: string;
  numeros: {
    entradas: number;
    concluidas: number;
    emCurso: number;
    porEstado: { NAO_INICIADA: number; EM_PRODUCAO: number; SUSPENSA: number };
    atrasadas: number;
    prazoCumprido: number | null;
    concluidasComPrazo: number;
    concluidasNoPrazo: number;
    diasMedios: number | null;
    horasProducaoMedias: number | null;
  };
  porDia: { dia: string; entradas: number; concluidas: number }[];
  porProduto: { produto: string; entradas: number; concluidas: number }[];
  etapas: { etapa: string; passagens: number; horasMedias: number | null; agora: number; maisAntigaDias: number | null }[];
  paradas: { id: string; os: string; cliente: string; produto: string; etapa: string; estado: string; dias: number; prazo: string | null }[];
  atrasadas: { id: string; os: string; cliente: string; produto: string; etapa: string; estado: string; prazo: string; diasAtraso: number }[];
  concluidas: { id: string; os: string; cliente: string; produto: string; entrada: string; concluida: string; dias: number; noPrazo: boolean | null }[];
  paragens: {
    total: number;
    abertas: number;
    horas: number;
    porMotivo: { motivo: string; n: number; horas: number }[];
    lista: { id: string; osId: string; os: string; cliente: string; motivo: string; inicio: string; fim: string | null; horas: number; quem: string }[];
  };
  porUtilizador: { nome: string; total: number; etapasConcluidas: number; entradasEtapa: number; observacoes: number; paragens: number; criadas: number; outras: number }[];
  horas: { nome: string; dias: number; horas: number; extra: number; faltas: number; ferias: number; baixa: number }[];
  atividade: { id: string; quando: string; hora: string; tipo: string; tipoLabel: string; descricao: string; quem: string; osId: string; os: string; cliente: string }[];
  atividadeTotal: number;
  atividadePorTipo: { tipo: string; n: number }[];
  outras: {
    materialPedido: number;
    materialRecebido: number;
    materialPorPedir: number;
    poEntradaKg: number;
    poSaidaKg: number;
    vidrosRegistados: number;
    vidrosPorEncomendar: number;
    orcamentosCriados: number;
    orcamentosPorEstado: Record<string, number>;
  };
}

type Preset = "semana" | "semanaPassada" | "mes" | "mesPassado" | "outro";
type Tab = "resumo" | "etapas" | "paragens" | "pessoas" | "atividade" | "outras";

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const monday = (iso: string) => addDays(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));
const monthRange = (iso: string, shift = 0) => {
  const [y, m] = iso.split("-").map(Number);
  return {
    from: new Date(Date.UTC(y, m - 1 + shift, 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(y, m + shift, 0)).toISOString().slice(0, 10),
  };
};
function presetRange(p: Preset, custom: { from: string; to: string }) {
  const hoje = todayIso();
  if (p === "semana") return { from: monday(hoje), to: addDays(monday(hoje), 6) };
  if (p === "semanaPassada") return { from: addDays(monday(hoje), -7), to: addDays(monday(hoje), -1) };
  if (p === "mes") return monthRange(hoje);
  if (p === "mesPassado") return monthRange(hoje, -1);
  return custom;
}
const fmtPT = (iso: string) => iso.split("-").reverse().join("/");
const n1 = (v: number | null) => (v === null ? "—" : v.toLocaleString("pt-PT", { maximumFractionDigits: 1 }));

export function RelatoriosPage() {
  const feature = useFeature("relatorios");
  const [preset, setPreset] = useState<Preset>("semana");
  const [custom, setCustom] = useState(() => ({ from: addDays(todayIso(), -13), to: todayIso() }));
  const [tab, setTab] = useState<Tab>("resumo");
  const [r, setR] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [fTipo, setFTipo] = useState("");
  const [fQuem, setFQuem] = useState("");
  const [q, setQ] = useState("");

  const range = presetRange(preset, custom);
  const qs = `?from=${range.from}&to=${range.to}`;

  useEffect(() => {
    if (!feature.available) return;
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .get<Report>(`/relatorios/producao${qs}`)
      .then((d) => alive && setR(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Não foi possível carregar o relatório."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [qs, feature.available]);

  const atividade = useMemo(() => {
    if (!r) return [];
    const t = q.trim().toLowerCase();
    return r.atividade.filter(
      (a) =>
        (!fTipo || a.tipoLabel === fTipo) &&
        (!fQuem || a.quem === fQuem) &&
        (!t || [a.os, a.cliente, a.descricao, a.quem].join(" ").toLowerCase().includes(t))
    );
  }, [r, fTipo, fQuem, q]);

  if (feature.loading) return null;
  if (!feature.available) return <Navigate to="/" replace />;

  async function tirarPdf() {
    setPdfBusy(true);
    try {
      const blob = await api.getBlob(`/relatorios/producao/pdf${qs}`);
      downloadBlob(blob, `relatorio-producao-${range.from}${range.from === range.to ? "" : `-a-${range.to}`}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível gerar o PDF.");
    } finally {
      setPdfBusy(false);
    }
  }

  const k = r?.numeros;
  const maxDia = r ? Math.max(1, ...r.porDia.map((d) => Math.max(d.entradas, d.concluidas))) : 1;
  const pessoas = r ? [...new Set(r.atividade.map((a) => a.quem))].sort((a, b) => a.localeCompare(b, "pt")) : [];

  return (
    <div className="rel">
      <div className="page-header rel-head">
        <div>
          <h2>Relatório de produção</h2>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 13.5 }}>
            {r ? r.label : "…"} · tudo o que se passou na produção e no programa
          </p>
        </div>
        <button className="btn" type="button" onClick={tirarPdf} disabled={pdfBusy || loading}>
          {pdfBusy ? "A gerar…" : "Tirar PDF"}
        </button>
      </div>

      {!feature.released && (
        <div style={{ marginBottom: 14 }}>
          <FeatureTestBanner featureKey="relatorios" label="os Relatórios" />
        </div>
      )}

      <div className="rel-periodo">
        {(
          [
            ["semana", "Esta semana"],
            ["semanaPassada", "Semana passada"],
            ["mes", "Este mês"],
            ["mesPassado", "Mês passado"],
            ["outro", "Escolher datas"],
          ] as [Preset, string][]
        ).map(([p, l]) => (
          <button key={p} type="button" className={`fin-chip${preset === p ? " on" : ""}`} onClick={() => setPreset(p)}>
            {l}
          </button>
        ))}
        {preset === "outro" && (
          <span className="rel-datas">
            <input type="date" aria-label="De" value={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} />
            <span className="muted">a</span>
            <input type="date" aria-label="Até" value={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} />
          </span>
        )}
      </div>

      {error && <p className="error-text">{error}</p>}
      {loading && !r && <p className="muted">A carregar o relatório…</p>}

      {r && k && (
        <div style={{ opacity: loading ? 0.55 : 1, transition: "opacity .15s" }}>
          <div className="ef-kpis rel-kpis">
            <Kpi label="OS entradas" value={String(k.entradas)} sub="no período" />
            <Kpi label="OS concluídas" value={String(k.concluidas)} sub={k.diasMedios !== null ? `em média ${n1(k.diasMedios)} dias` : "no período"} />
            <Kpi
              label="Prazo cumprido"
              value={k.prazoCumprido === null ? "—" : `${k.prazoCumprido}%`}
              sub={k.concluidasComPrazo ? `${k.concluidasNoPrazo} de ${k.concluidasComPrazo} com prazo` : "sem OS com prazo"}
            />
            <Kpi label="Em curso agora" value={String(k.emCurso)} sub={`${k.porEstado.EM_PRODUCAO} em produção · ${k.porEstado.NAO_INICIADA} por iniciar · ${k.porEstado.SUSPENSA} suspensas`} />
            <Kpi label="Atrasadas agora" value={String(k.atrasadas)} sub={k.atrasadas ? "com o prazo já passado" : "nenhuma"} />
            <Kpi label="Paragens" value={String(r.paragens.total)} sub={`${n1(r.paragens.horas)} h paradas${r.paragens.abertas ? ` · ${r.paragens.abertas} em curso` : ""}`} />
          </div>

          <div className="tabs" role="tablist">
            {(
              [
                ["resumo", "Resumo"],
                ["etapas", "Etapas"],
                ["paragens", `Paragens (${r.paragens.total})`],
                ["pessoas", "Por pessoa"],
                ["atividade", `Atividade (${r.atividadeTotal})`],
                ["outras", "Outras áreas"],
              ] as [Tab, string][]
            ).map(([t, l]) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                {l}
              </button>
            ))}
          </div>

          {tab === "resumo" && (
            <div className="rel-grid">
              <div className="card rel-card">
                <h3>Entradas e conclusões por dia</h3>
                <div className="rel-legend">
                  <span className="e">Entradas</span>
                  <span className="c">Concluídas</span>
                </div>
                <div className="rel-bars" style={{ ["--n" as string]: r.porDia.length }}>
                  {r.porDia.map((d) => (
                    <div key={d.dia} className="rel-bar" title={`${fmtPT(d.dia)}: ${d.entradas} entradas, ${d.concluidas} concluídas`}>
                      <div className="rel-bar-stack">
                        <span className="e" style={{ height: `${(d.entradas / maxDia) * 100}%` }}>
                          {d.entradas > 0 && r.porDia.length <= 16 ? <em>{d.entradas}</em> : null}
                        </span>
                        <span className="c" style={{ height: `${(d.concluidas / maxDia) * 100}%` }}>
                          {d.concluidas > 0 && r.porDia.length <= 16 ? <em>{d.concluidas}</em> : null}
                        </span>
                      </div>
                      {(r.porDia.length <= 16 || Number(d.dia.slice(8)) % 5 === 1) && <small>{d.dia.slice(8)}</small>}
                    </div>
                  ))}
                </div>
              </div>

              <div className="card ef-table-card">
                <div className="ef-table-head">
                  <h3 className={r.atrasadas.length ? "fin-late" : ""}>Atrasadas agora ({r.atrasadas.length})</h3>
                </div>
                <div className="ef-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>OS</th>
                        <th>Cliente</th>
                        <th>Etapa</th>
                        <th>Prazo</th>
                        <th className="num">Dias</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.atrasadas.length === 0 && (
                        <tr>
                          <td colSpan={5} className="muted">
                            Nenhuma OS com o prazo ultrapassado. 👍
                          </td>
                        </tr>
                      )}
                      {r.atrasadas.slice(0, 12).map((o) => (
                        <tr key={o.id}>
                          <td>
                            <Link to={`/service-orders/${o.id}`}>
                              <strong>{o.os}</strong>
                            </Link>
                          </td>
                          <td>
                            {o.cliente}
                            <div className="cell-sub">{o.produto}</div>
                          </td>
                          <td>{o.etapa}</td>
                          <td className="ef-nowrap">{fmtPT(o.prazo)}</td>
                          <td className="num fin-late">
                            <strong>{o.diasAtraso}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {r.atrasadas.length > 12 && <p className="muted" style={{ padding: "8px 18px" }}>e mais {r.atrasadas.length - 12} — estão todas no PDF.</p>}
                </div>
              </div>

              <div className="card ef-table-card">
                <div className="ef-table-head">
                  <h3>Onde está parado há mais tempo</h3>
                </div>
                <div className="ef-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>OS</th>
                        <th>Cliente</th>
                        <th>Etapa atual</th>
                        <th className="num">Dias na etapa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.paradas.length === 0 && (
                        <tr>
                          <td colSpan={4} className="muted">
                            Nenhuma OS em curso.
                          </td>
                        </tr>
                      )}
                      {r.paradas.slice(0, 10).map((o) => (
                        <tr key={o.id}>
                          <td>
                            <Link to={`/service-orders/${o.id}`}>
                              <strong>{o.os}</strong>
                            </Link>
                          </td>
                          <td>
                            {o.cliente}
                            <div className="cell-sub">{o.produto}</div>
                          </td>
                          <td>
                            {o.etapa}
                            <div className="cell-sub">{o.estado}</div>
                          </td>
                          <td className="num">
                            <strong className={o.dias >= 7 ? "fin-late" : o.dias >= 3 ? "fin-soon" : ""}>{n1(o.dias)}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card ef-table-card">
                <div className="ef-table-head">
                  <h3>Concluídas no período ({r.concluidas.length})</h3>
                </div>
                <div className="ef-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>OS</th>
                        <th>Cliente</th>
                        <th>Concluída</th>
                        <th className="num">Dias</th>
                        <th>No prazo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.concluidas.length === 0 && (
                        <tr>
                          <td colSpan={5} className="muted">
                            Nenhuma OS concluída no período.
                          </td>
                        </tr>
                      )}
                      {r.concluidas.slice(0, 12).map((o) => (
                        <tr key={o.id}>
                          <td>
                            <Link to={`/service-orders/${o.id}`}>
                              <strong>{o.os}</strong>
                            </Link>
                          </td>
                          <td>
                            {o.cliente}
                            <div className="cell-sub">{o.produto}</div>
                          </td>
                          <td className="ef-nowrap">{fmtPT(o.concluida)}</td>
                          <td className="num">{n1(o.dias)}</td>
                          <td>{o.noPrazo === null ? <span className="muted">—</span> : o.noPrazo ? <span className="rel-ok">Sim</span> : <span className="rel-ko">Não</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {r.concluidas.length > 12 && <p className="muted" style={{ padding: "8px 18px" }}>e mais {r.concluidas.length - 12} — estão todas no PDF.</p>}
                </div>
              </div>

              {r.porProduto.length > 0 && (
                <div className="card ef-table-card">
                  <div className="ef-table-head">
                    <h3>Por produto</h3>
                  </div>
                  <div className="ef-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Produto</th>
                          <th className="num">Entradas</th>
                          <th className="num">Concluídas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.porProduto.map((p) => (
                          <tr key={p.produto}>
                            <td>{p.produto}</td>
                            <td className="num">{p.entradas}</td>
                            <td className="num">{p.concluidas}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "etapas" && (
            <div className="card ef-table-card">
              <div className="ef-table-head">
                <h3>Etapas — tempo médio no período e trabalho que está agora em cada uma</h3>
              </div>
              <div className="ef-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Etapa</th>
                      <th className="num">Passagens concluídas</th>
                      <th className="num">Tempo médio na etapa</th>
                      <th className="num">OS agora na etapa</th>
                      <th className="num">Há mais tempo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.etapas.length === 0 && (
                      <tr>
                        <td colSpan={5} className="muted">
                          Sem movimentos nas etapas.
                        </td>
                      </tr>
                    )}
                    {r.etapas.map((e) => {
                      const maxAgora = Math.max(1, ...r.etapas.map((x) => x.agora));
                      return (
                        <tr key={e.etapa}>
                          <td>
                            <strong>{e.etapa}</strong>
                          </td>
                          <td className="num">{e.passagens || "—"}</td>
                          <td className="num">{e.horasMedias === null ? "—" : e.horasMedias >= 24 ? `${n1(e.horasMedias / 24)} dias` : `${n1(e.horasMedias)} h`}</td>
                          <td className="num">
                            <span className="rel-inline-bar">
                              <i style={{ width: `${(e.agora / maxAgora) * 100}%` }} />
                            </span>
                            <strong>{e.agora}</strong>
                          </td>
                          <td className="num">
                            <span className={(e.maisAntigaDias ?? 0) >= 7 ? "fin-late" : ""}>{e.maisAntigaDias === null ? "—" : `${n1(e.maisAntigaDias)} dias`}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "paragens" && (
            <div className="rel-grid">
              <div className="card ef-table-card">
                <div className="ef-table-head">
                  <h3>
                    Por motivo · {n1(r.paragens.horas)} h paradas
                  </h3>
                </div>
                <div className="ef-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Motivo</th>
                        <th className="num">Nº</th>
                        <th className="num">Horas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.paragens.porMotivo.length === 0 && (
                        <tr>
                          <td colSpan={3} className="muted">
                            Sem paragens no período.
                          </td>
                        </tr>
                      )}
                      {r.paragens.porMotivo.map((m) => (
                        <tr key={m.motivo}>
                          <td>
                            <span className="rel-inline-bar">
                              <i style={{ width: `${(m.horas / Math.max(1, r.paragens.porMotivo[0]?.horas ?? 1)) * 100}%` }} />
                            </span>
                            {m.motivo}
                          </td>
                          <td className="num">{m.n}</td>
                          <td className="num">
                            <strong>{n1(m.horas)}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="card ef-table-card rel-wide">
                <div className="ef-table-head">
                  <h3>Detalhe</h3>
                </div>
                <div className="ef-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>OS</th>
                        <th>Motivo</th>
                        <th>Início</th>
                        <th>Fim</th>
                        <th className="num">Horas</th>
                        <th>Quem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.paragens.lista.length === 0 && (
                        <tr>
                          <td colSpan={6} className="muted">
                            Sem paragens no período.
                          </td>
                        </tr>
                      )}
                      {r.paragens.lista.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <Link to={`/service-orders/${p.osId}`}>
                              <strong>{p.os}</strong>
                            </Link>
                            <div className="cell-sub">{p.cliente}</div>
                          </td>
                          <td>{p.motivo}</td>
                          <td className="ef-nowrap">{p.inicio}</td>
                          <td className="ef-nowrap">{p.fim ?? <span className="fin-late">em curso</span>}</td>
                          <td className="num">{n1(p.horas)}</td>
                          <td>{p.quem}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab === "pessoas" && (
            <div className="rel-grid">
              <div className="card ef-table-card rel-wide">
                <div className="ef-table-head">
                  <h3>O que cada um registou no programa</h3>
                </div>
                <div className="ef-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Pessoa</th>
                        <th className="num">Etapas concluídas</th>
                        <th className="num">Entradas em etapa</th>
                        <th className="num">Observações</th>
                        <th className="num">Paragens</th>
                        <th className="num">OS criadas</th>
                        <th className="num">Outras</th>
                        <th className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.porUtilizador.length === 0 && (
                        <tr>
                          <td colSpan={8} className="muted">
                            Sem atividade no período.
                          </td>
                        </tr>
                      )}
                      {r.porUtilizador.map((u) => (
                        <tr key={u.nome}>
                          <td>
                            <button
                              type="button"
                              className="rel-link"
                              onClick={() => {
                                setFQuem(u.nome === "Sistema / importação" ? "Sistema" : u.nome);
                                setTab("atividade");
                              }}
                              title="Ver o que fez"
                            >
                              {u.nome}
                            </button>
                          </td>
                          <td className="num">{u.etapasConcluidas}</td>
                          <td className="num">{u.entradasEtapa}</td>
                          <td className="num">{u.observacoes}</td>
                          <td className="num">{u.paragens}</td>
                          <td className="num">{u.criadas}</td>
                          <td className="num">{u.outras}</td>
                          <td className="num">
                            <strong>{u.total}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="card ef-table-card rel-wide">
                <div className="ef-table-head">
                  <h3>Horas dos colaboradores</h3>
                  <Link to="/controlo-horas" className="muted" style={{ fontSize: 13 }}>
                    Abrir Controlo de Horas →
                  </Link>
                </div>
                <div className="ef-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Colaborador</th>
                        <th className="num">Dias</th>
                        <th className="num">Horas</th>
                        <th className="num">Horas extra</th>
                        <th className="num">Faltas</th>
                        <th className="num">Férias</th>
                        <th className="num">Baixa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.horas.length === 0 && (
                        <tr>
                          <td colSpan={7} className="muted">
                            Sem horas registadas no período.
                          </td>
                        </tr>
                      )}
                      {r.horas.map((h) => (
                        <tr key={h.nome}>
                          <td>{h.nome}</td>
                          <td className="num">{h.dias}</td>
                          <td className="num">{n1(h.horas)}</td>
                          <td className="num">{h.extra ? <strong>{n1(h.extra)}</strong> : "—"}</td>
                          <td className="num">{h.faltas || "—"}</td>
                          <td className="num">{h.ferias || "—"}</td>
                          <td className="num">{h.baixa || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab === "atividade" && (
            <div className="card ef-table-card">
              <div className="fin-filtros" style={{ paddingTop: 14 }}>
                <button type="button" className={`fin-chip${!fTipo ? " on" : ""}`} onClick={() => setFTipo("")}>
                  Tudo <span>{r.atividadeTotal}</span>
                </button>
                {r.atividadePorTipo.map((t) => (
                  <button key={t.tipo} type="button" className={`fin-chip${fTipo === t.tipo ? " on" : ""}`} onClick={() => setFTipo(fTipo === t.tipo ? "" : t.tipo)}>
                    {t.tipo} <span>{t.n}</span>
                  </button>
                ))}
              </div>
              <div className="ef-table-head">
                <h3>
                  {atividade.length} {atividade.length === 1 ? "registo" : "registos"}
                  {r.atividadeTotal > r.atividade.length && <span className="muted" style={{ fontWeight: 500, fontSize: 13 }}> · a mostrar os {r.atividade.length} mais recentes</span>}
                </h3>
                <div className="ef-filters">
                  <input className="fin-search" type="search" placeholder="Pesquisar OS, cliente…" value={q} onChange={(e) => setQ(e.target.value)} />
                  <select aria-label="Pessoa" value={fQuem} onChange={(e) => setFQuem(e.target.value)}>
                    <option value="">Todas as pessoas</option>
                    {pessoas.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="ef-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>OS</th>
                      <th>O quê</th>
                      <th>Detalhe</th>
                      <th>Quem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {atividade.length === 0 && (
                      <tr>
                        <td colSpan={5} className="muted">
                          Nada registado com estes filtros.
                        </td>
                      </tr>
                    )}
                    {atividade.map((a) => (
                      <tr key={a.id}>
                        <td className="ef-nowrap">{a.hora}</td>
                        <td>
                          <Link to={`/service-orders/${a.osId}`}>
                            <strong>{a.os}</strong>
                          </Link>
                          <div className="cell-sub">{a.cliente}</div>
                        </td>
                        <td>
                          <span className={`rel-ev rel-ev-${a.tipo.toLowerCase()}`}>{a.tipoLabel}</span>
                        </td>
                        <td>{a.descricao}</td>
                        <td>{a.quem}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "outras" && (
            <div className="rel-outras">
              <Link to="/material-a-pedir" className="card rel-out">
                <span>Material a pedir</span>
                <strong>
                  {r.outras.materialPedido} pedidos · {r.outras.materialRecebido} recebidos
                </strong>
                <small>{r.outras.materialPorPedir} ainda por pedir agora</small>
              </Link>
              <Link to="/po-em-stock" className="card rel-out">
                <span>Pó (lacagem)</span>
                <strong>
                  {n1(r.outras.poSaidaKg)} kg gastos · {n1(r.outras.poEntradaKg)} kg entrada
                </strong>
                <small>movimentos de stock no período</small>
              </Link>
              <Link to="/pedidos-vidros" className="card rel-out">
                <span>Vidros</span>
                <strong>{r.outras.vidrosRegistados} pedidos registados</strong>
                <small>{r.outras.vidrosPorEncomendar} por encomendar agora</small>
              </Link>
              <Link to="/orcamentos" className="card rel-out">
                <span>Orçamentos</span>
                <strong>{r.outras.orcamentosCriados} criados</strong>
                <small>
                  {Object.entries(r.outras.orcamentosPorEstado)
                    .map(([e, n]) => `${n} ${e.toLowerCase()}`)
                    .join(" · ") || "nenhum no período"}
                </small>
              </Link>
            </div>
          )}

          <p className="muted rel-foot">
            O mesmo relatório pode chegar sozinho em PDF todas as semanas e todos os meses — liga-o em{" "}
            <Link to="/emails-automaticos">Avisos Semanais</Link>.
          </p>
        </div>
      )}
    </div>
  );
}
