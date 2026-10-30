import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../contexts/AuthContext";
import { FeatureTestBanner } from "../components/FeatureTestBanner";

// ============================================================================
// Objetivos (pedido do utilizador de 2026-10-30): faturação e negócio fechado
// (encomendas cliente) contra os objetivos, à vista de toda a equipa — "para
// que todos os membros possam ver os nossos números e lutar juntos".
// Os números vêm dos mapas do Goldylocks importados pelo administrador.
// ============================================================================

type Kind = "FATURACAO" | "ENCOMENDAS";
type PeriodType = "MES" | "TRIMESTRE" | "ANO";

interface KindSummary {
  kind: Kind;
  total: number;
  count: number;
  clients: number;
  average: number;
  target: number | null;
  expectedByNow: number | null;
  previousSamePoint: number;
  previousTotal: number;
  series: { date: string; cumulative: number }[];
  topClients: { name: string; value: number; count: number }[];
  topDocs: { date: string; docType: string; docNumber: string; clientName: string; net: number }[];
  lastImport: { at: string; by: string | null; from: string; to: string } | null;
  workingDays: { total: number; elapsed: number; remaining: number };
}

interface Summary {
  periodType: PeriodType;
  year: number;
  period: number;
  start: string;
  end: string;
  today: string;
  faturacao: KindSummary;
  encomendas: KindSummary;
}

interface Target {
  kind: Kind;
  periodType: PeriodType;
  year: number;
  period: number;
  value: number;
}

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const KIND_LABEL: Record<Kind, string> = { FATURACAO: "Faturação", ENCOMENDAS: "Negócio fechado" };
const KIND_SUB: Record<Kind, string> = { FATURACAO: "faturas emitidas, sem IVA", ENCOMENDAS: "encomendas cliente, sem IVA" };

// Separador de milhares sempre (o pt-PT do browser não agrupa números de 4 algarismos: "2078 €").
const eur = (n: number, digits = 0) => {
  const [int, dec] = Math.abs(n).toFixed(digits).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
  return `${n < 0 ? "−" : ""}${grouped}${dec ? `,${dec}` : ""}\u00a0€`;
};
const pct = (n: number) => `${Math.round(n * 100)}%`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function periodLabel(t: PeriodType, year: number, period: number) {
  if (t === "ANO") return String(year);
  if (t === "TRIMESTRE") return `${period}.º trimestre ${year}`;
  return `${cap(MONTHS[period - 1])} ${year}`;
}

function currentPeriod(t: PeriodType) {
  const now = new Date();
  const m = now.getMonth() + 1;
  return { year: now.getFullYear(), period: t === "ANO" ? 1 : t === "TRIMESTRE" ? Math.ceil(m / 3) : m };
}

function shift(t: PeriodType, year: number, period: number, dir: number) {
  if (t === "ANO") return { year: year + dir, period: 1 };
  const n = t === "TRIMESTRE" ? 4 : 12;
  let p = period + dir;
  let y = year;
  if (p < 1) {
    p = n;
    y--;
  } else if (p > n) {
    p = 1;
    y++;
  }
  return { year: y, period: p };
}

export function ObjetivosPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMINISTRADOR";
  const [periodType, setPeriodType] = useState<PeriodType>("MES");
  const [{ year, period }, setYP] = useState(() => currentPeriod("MES"));
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTargets, setShowTargets] = useState(false);
  const [importing, setImporting] = useState<Kind | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .get<Summary>(`/objetivos/resumo?periodType=${periodType}&year=${year}&period=${period}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Erro ao carregar os objetivos."));
  }, [periodType, year, period]);

  useEffect(load, [load]);

  function changeType(t: PeriodType) {
    setPeriodType(t);
    setYP(currentPeriod(t));
  }

  function pickFile(kind: Kind) {
    setImporting(kind);
    setNotice(null);
    fileRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !importing) return;
    try {
      const r = await api.postFile<{ from: string; to: string; count: number; totalNet: number }>(
        `/objetivos/importar?kind=${importing}&filename=${encodeURIComponent(file.name)}`,
        file,
        "application/pdf"
      );
      setNotice(
        `${importing === "FATURACAO" ? "Faturas" : "Encomendas"} importadas: ${r.count} documentos de ${r.from.split("-").reverse().join("/")} a ${r.to
          .split("-")
          .reverse()
          .join("/")}, total ${eur(r.totalNet, 2)} sem IVA.`
      );
      load();
    } catch (err) {
      setNotice(null);
      setError(err instanceof Error ? err.message : "Não foi possível importar o mapa.");
    } finally {
      setImporting(null);
    }
  }

  const fat = data?.faturacao;
  const wd = fat?.workingDays;
  const isCurrent = data ? data.today >= data.start && data.today <= data.end : false;

  return (
    <div className="obj-page">
      <FeatureTestBanner featureKey="objetivos" label="a página dos Objetivos" />
      <div className="obj-top">
        <div>
          <div className="obj-kicker">Central Minho Ferragens</div>
          <h2 className="obj-title">Objetivos</h2>
          <div className="muted">Os nossos números, para lutarmos juntos.</div>
        </div>
        <div className="obj-controls">
          <div className="obj-seg" role="tablist">
            {(["MES", "TRIMESTRE", "ANO"] as PeriodType[]).map((t) => (
              <button key={t} className={periodType === t ? "on" : ""} onClick={() => changeType(t)}>
                {t === "MES" ? "Mês" : t === "TRIMESTRE" ? "Trimestre" : "Ano"}
              </button>
            ))}
          </div>
          <div className="obj-nav">
            <button onClick={() => setYP(shift(periodType, year, period, -1))} aria-label="Anterior">
              ‹
            </button>
            <span>{periodLabel(periodType, year, period)}</span>
            <button onClick={() => setYP(shift(periodType, year, period, 1))} aria-label="Seguinte">
              ›
            </button>
          </div>
          {isAdmin && (
            <>
              <button className="btn secondary" onClick={() => pickFile("FATURACAO")}>
                Importar faturas
              </button>
              <button className="btn secondary" onClick={() => pickFile("ENCOMENDAS")}>
                Importar encomendas
              </button>
              <button className="btn" onClick={() => setShowTargets(true)}>
                Definir objetivos
              </button>
              <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={onFile} />
            </>
          )}
        </div>
      </div>

      {importing && <p className="muted">Escolhe o PDF do mapa…</p>}
      {notice && <p className="obj-notice">✓ {notice}</p>}
      {error && <p className="error-text">{error}</p>}
      {!data && !error && <p className="muted">A carregar…</p>}

      {data && fat && wd && (
        <>
          <StatusBanner data={data} isCurrent={isCurrent} />

          <div className="obj-grid2">
            <KindCard s={data.faturacao} isCurrent={isCurrent} prevLabel={periodType === "ANO" ? "Ano passado" : periodType === "TRIMESTRE" ? "Trimestre anterior" : "Mês passado"} />
            <KindCard s={data.encomendas} isCurrent={isCurrent} prevLabel={periodType === "ANO" ? "Ano passado" : periodType === "TRIMESTRE" ? "Trimestre anterior" : "Mês passado"} />
          </div>

          <div className="obj-grid3">
            <div className="card obj-card">
              <div className="obj-label">Acumulado no período</div>
              <CumulativeChart data={data} />
            </div>
            <div className="card obj-card">
              <div className="obj-label">Maiores clientes · negócio fechado</div>
              {data.encomendas.topClients.length === 0 && <p className="muted">Ainda sem encomendas importadas neste período.</p>}
              <table className="obj-table">
                <tbody>
                  {data.encomendas.topClients.map((c) => (
                    <tr key={c.name}>
                      <td>
                        {c.name} <span className="muted">· {c.count} enc.</span>
                      </td>
                      <td>{eur(c.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="obj-foot">
            {(["faturacao", "encomendas"] as const).map((k) => {
              const li = data[k].lastImport;
              return (
                <span key={k}>
                  {k === "faturacao" ? "Faturas" : "Encomendas"}:{" "}
                  {li
                    ? `dados até ${li.to.split("-").reverse().join("/")}, importados a ${new Date(li.at).toLocaleString("pt-PT", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}${li.by ? ` por ${li.by}` : ""}`
                    : "ainda sem importação"}
                </span>
              );
            })}
          </div>
        </>
      )}

      {showTargets && (
        <TargetsModal
          initialYear={year}
          onClose={() => {
            setShowTargets(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function StatusBanner({ data, isCurrent }: { data: Summary; isCurrent: boolean }) {
  const f = data.faturacao;
  const wd = f.workingDays;
  let msg: string;
  if (f.target == null) {
    msg = `Faturámos ${eur(f.total)} e fechámos ${eur(data.encomendas.total)} em negócio.`;
  } else if (!isCurrent) {
    const r = f.total / f.target;
    msg = r >= 1 ? `Objetivo de faturação cumprido: ${pct(r)}. Parabéns a todos!` : `Ficámos a ${pct(r)} do objetivo de faturação.`;
  } else {
    const r = f.total / f.target;
    const share = wd.total ? wd.elapsed / wd.total : 1;
    const ahead = f.expectedByNow != null && f.total >= f.expectedByNow;
    msg = `Vamos a ${pct(r)} da faturação com ${pct(share)} dos dias úteis — ${ahead ? "estamos à frente do ritmo 💪" : "temos de acelerar para lá chegar"}`;
  }
  return (
    <div className="obj-banner">
      <div>
        <div className="obj-banner-kicker">Estado {data.periodType === "ANO" ? "do ano" : data.periodType === "TRIMESTRE" ? "do trimestre" : "do mês"}</div>
        <b>{msg}</b>
      </div>
      {isCurrent && (
        <div className="obj-banner-days">
          <b>{wd.remaining}</b>
          {wd.remaining === 1 ? "dia útil" : "dias úteis"} até ao fim
        </div>
      )}
    </div>
  );
}

function KindCard({ s, isCurrent, prevLabel }: { s: KindSummary; isCurrent: boolean; prevLabel: string }) {
  const ratio = s.target ? s.total / s.target : null;
  const paceShare = s.workingDays.total ? s.workingDays.elapsed / s.workingDays.total : 1;
  const missing = s.target != null ? Math.max(0, s.target - s.total) : null;
  const perDay = missing != null && s.workingDays.remaining > 0 ? missing / s.workingDays.remaining : null;
  const diff = s.expectedByNow != null ? s.total - s.expectedByNow : null;
  return (
    <div className="card obj-card">
      <div className="obj-label">
        {KIND_LABEL[s.kind]} <span className="obj-label-sub">· {KIND_SUB[s.kind]}</span>
      </div>
      <div className="obj-hero">
        <b>{eur(s.total)}</b>
        {s.target != null && <span>de {eur(s.target)}</span>}
      </div>
      {ratio != null ? (
        <>
          <div className="obj-bar" role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className={`obj-bar-fill${ratio >= 1 ? " done" : ""}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
            {isCurrent && ratio < 1 && <div className="obj-bar-pace" style={{ left: `${paceShare * 100}%` }} title="Onde devíamos estar hoje" />}
          </div>
          <div className="obj-row">
            <span>
              <b>{pct(ratio)}</b> do objetivo
            </span>
            {missing! > 0 ? (
              <span>
                Faltam <b>{eur(missing!)}</b>
                {isCurrent && perDay != null && (
                  <>
                    {" "}
                    · ≈ <b>{eur(perDay)}</b> por dia útil
                  </>
                )}
              </span>
            ) : (
              <span className="obj-good">Objetivo cumprido 🎉</span>
            )}
          </div>
          {isCurrent && diff != null && missing! > 0 && (
            <span className={`obj-chip ${diff >= 0 ? "good" : "warn"}`}>
              <span className="obj-dot" />
              {diff >= 0 ? `À frente do ritmo (+${eur(diff)})` : `Atrás do ritmo (${eur(diff)})`}
            </span>
          )}
        </>
      ) : (
        <p className="muted" style={{ margin: "10px 0 0" }}>Sem objetivo definido para este período.</p>
      )}
      <div className="obj-mini">
        <div>
          {s.kind === "FATURACAO" ? "Faturas" : "Encomendas"}
          <b>{s.count}</b>
        </div>
        <div>
          Valor médio<b>{eur(s.average)}</b>
        </div>
        <div>
          {isCurrent ? `${prevLabel} até hoje` : prevLabel}
          <b>{eur(isCurrent ? s.previousSamePoint : s.previousTotal)}</b>
        </div>
      </div>
    </div>
  );
}

/** Faturação e negócio fechado acumulados ao longo do período, com a linha do objetivo de faturação. */
function CumulativeChart({ data }: { data: Summary }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 240, L = 56, R = 16, T = 16, B = 28;
  const startMs = Date.parse(data.start);
  const endMs = Date.parse(data.end);
  const days = Math.round((endMs - startMs) / 86_400_000) + 1;
  const f = data.faturacao, e = data.encomendas;
  const max = Math.max(f.target ?? 0, e.target ?? 0, f.series[f.series.length - 1]?.cumulative ?? 0, e.series[e.series.length - 1]?.cumulative ?? 0, 1);
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const x = (i: number) => L + ((W - L - R) * i) / Math.max(1, days - 1);
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const path = (s: { cumulative: number }[]) => s.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.cumulative).toFixed(1)}`).join(" ");
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let v = 0; v <= top + 1e-6; v += step) out.push(v);
    return out;
  }, [top, step]);
  const xTicks = useMemo(() => {
    const n = Math.min(6, days);
    return Array.from({ length: n }, (_, k) => Math.round(((days - 1) * k) / Math.max(1, n - 1)));
  }, [days]);
  const dateLabel = (i: number) => {
    const d = new Date(startMs + i * 86_400_000);
    return data.periodType === "MES" ? String(d.getUTCDate()) : `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
  };
  const last = Math.max(f.series.length, e.series.length) - 1;

  return (
    <div className="obj-chart">
      <div className="obj-legend">
        <span><i className="sw fat" /> Faturação</span>
        <span><i className="sw enc" /> Negócio fechado</span>
        {f.target != null && <span><i className="sw tgt" /> Objetivo de faturação</span>}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Faturação e negócio fechado acumulados no período"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(ev) => {
          const r = (ev.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((ev.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - L) / (W - L - R)) * (days - 1));
          setHover(i >= 0 && i <= last ? i : null);
        }}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--obj-grid)" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="obj-axis">
              {v >= 1000 ? `${Math.round(v / 1000)}k` : v}
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="obj-axis">
            {dateLabel(i)}
          </text>
        ))}
        {f.target != null && <line x1={x(0)} y1={y(0)} x2={x(days - 1)} y2={y(f.target)} stroke="var(--obj-target)" strokeWidth={1.5} strokeDasharray="5 5" />}
        {e.series.length > 0 && <path d={path(e.series)} fill="none" stroke="var(--obj-enc)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {f.series.length > 0 && <path d={path(f.series)} fill="none" stroke="var(--obj-fat)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--obj-target)" strokeOpacity={0.35} />
            {f.series[hover] && <circle cx={x(hover)} cy={y(f.series[hover].cumulative)} r={4.5} fill="var(--obj-fat)" stroke="#fff" strokeWidth={2} />}
            {e.series[hover] && <circle cx={x(hover)} cy={y(e.series[hover].cumulative)} r={4.5} fill="var(--obj-enc)" stroke="#fff" strokeWidth={2} />}
          </g>
        )}
      </svg>
      {hover != null && (
        <div className="obj-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <b>{new Date(startMs + hover * 86_400_000).toLocaleDateString("pt-PT", { timeZone: "UTC", day: "numeric", month: "long" })}</b>
          <div>Faturação: {eur(f.series[hover]?.cumulative ?? 0)}</div>
          <div>Negócio fechado: {eur(e.series[hover]?.cumulative ?? 0)}</div>
        </div>
      )}
    </div>
  );
}

function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function TargetsModal({ initialYear, onClose }: { initialYear: number; onClose: () => void }) {
  const [year, setYear] = useState(initialYear);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = (k: Kind, t: PeriodType, p: number) => `${k}|${t}|${p}`;

  useEffect(() => {
    api
      .get<Target[]>(`/objetivos/metas?year=${year}`)
      .then((rows) => {
        const v: Record<string, string> = {};
        rows.forEach((r) => (v[key(r.kind, r.periodType, r.period)] = String(r.value)));
        setValues(v);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Erro."));
  }, [year]);

  const rows: { label: string; t: PeriodType; p: number }[] = [
    ...MONTHS.map((m, i) => ({ label: cap(m), t: "MES" as PeriodType, p: i + 1 })),
    ...[1, 2, 3, 4].map((q) => ({ label: `${q}.º trimestre`, t: "TRIMESTRE" as PeriodType, p: q })),
    { label: "Ano", t: "ANO", p: 1 },
  ];

  async function save() {
    setSaving(true);
    setError(null);
    try {
      for (const r of rows) {
        for (const k of ["FATURACAO", "ENCOMENDAS"] as Kind[]) {
          const raw = (values[key(k, r.t, r.p)] ?? "").replace(/\s|€/g, "").replace(/\./g, "").replace(",", ".");
          const value = raw === "" ? null : Number(raw);
          if (value != null && !Number.isFinite(value)) throw new Error(`Valor inválido em ${r.label}.`);
          await api.put("/objetivos/metas", { kind: k, periodType: r.t, year, period: r.p, value });
        }
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao gravar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="plan-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="plan-modal obj-targets">
        <div className="obj-targets-head">
          <h3>Objetivos de {year}</h3>
          <div className="obj-nav">
            <button onClick={() => setYear(year - 1)}>‹</button>
            <span>{year}</span>
            <button onClick={() => setYear(year + 1)}>›</button>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Valores em euros, sem IVA. Se deixares o trimestre ou o ano em branco, conta a soma dos meses.
        </p>
        <table className="obj-targets-table">
          <thead>
            <tr>
              <th />
              <th>Faturação</th>
              <th>Negócio fechado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.t}${r.p}`} className={r.t !== "MES" ? "sum" : ""}>
                <td>{r.label}</td>
                {(["FATURACAO", "ENCOMENDAS"] as Kind[]).map((k) => (
                  <td key={k}>
                    <input
                      inputMode="decimal"
                      value={values[key(k, r.t, r.p)] ?? ""}
                      placeholder="—"
                      onChange={(e) => setValues({ ...values, [key(k, r.t, r.p)]: e.target.value })}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {error && <p className="error-text">{error}</p>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="btn secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn" onClick={save} disabled={saving}>
            {saving ? "A gravar…" : "Gravar"}
          </button>
        </div>
      </div>
    </div>
  );
}
