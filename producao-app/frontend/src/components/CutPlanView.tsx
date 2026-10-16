import { CutPlanInput, CutResult, SheetLayout, BarLayout, SheetTotals, BarTotals } from "../types";

// ============================================================================
// Desenho e resumo de um plano de corte (Otimização de Corte, 2026-10-16).
// Usado na pré-visualização do editor e na página do plano (que se imprime).
//
//  - Chapas: cada chapa desenhada à escala, com as peças numeradas pela
//    referência, as medidas, ↻ quando a peça vai rodada, e a tracejado os
//    primeiros cortes (as tiras). Chapas iguais aparecem uma vez com "× N".
//  - Barras: cada barra como uma régua com as peças pela ordem de corte e a
//    sobra; barras iguais também agrupadas.
//  - Totais: m² das peças, m² das chapas gastas, aproveitamento, nº de cortes,
//    nº de quinagens e de corta-cantos (regras da JPDC para chapa quinada).
// ============================================================================

const PALETTE = [
  ["#dbeafe", "#1d4ed8"],
  ["#dcfce7", "#15803d"],
  ["#fef3c7", "#b45309"],
  ["#fce7f3", "#be185d"],
  ["#ede9fe", "#6d28d9"],
  ["#cffafe", "#0e7490"],
  ["#ffedd5", "#c2410c"],
  ["#e0e7ff", "#4338ca"],
  ["#f3e8ff", "#7e22ce"],
  ["#ecfccb", "#4d7c0f"],
  ["#fee2e2", "#b91c1c"],
  ["#e2e8f0", "#334155"],
];

// Cores por OS (planos que juntam várias obras) — mais fortes que as das
// peças, para se distinguir bem cada obra na barra.
const OS_PALETTE = [
  ["#bfdbfe", "#1e40af"],
  ["#fde68a", "#92400e"],
  ["#bbf7d0", "#166534"],
  ["#fbcfe8", "#9d174d"],
  ["#ddd6fe", "#5b21b6"],
  ["#a5f3fc", "#155e75"],
  ["#fed7aa", "#9a3412"],
  ["#d9f99d", "#3f6212"],
];

export function osColor(index: number) {
  const [fill, stroke] = OS_PALETTE[index % OS_PALETTE.length];
  return { fill, stroke };
}

/** OS presentes no plano, pela ordem em que aparecem, com o cliente (se conhecido). */
export function planOrders(input: CutPlanInput) {
  const list: { os: string; client: string | null; index: number }[] = [];
  if (input.mode !== "BARRAS") return list;
  const clients = new Map<string, string>();
  (input.mosquitos ?? []).forEach((m) => m.os && m.client && clients.set(m.os, m.client));
  input.pieces.forEach((p) => {
    const os = p.os?.trim();
    if (os && !list.some((x) => x.os === os)) list.push({ os, client: clients.get(os) ?? null, index: list.length });
  });
  return list;
}

/** "2026/491" → "491" (para caber na barra). */
const shortOs = (os: string) => os.split("/").pop() || os;

export function pieceColor(typeIndex: number) {
  const [fill, stroke] = PALETTE[typeIndex % PALETTE.length];
  return { fill, stroke };
}

const nf = (n: number, d = 2) => n.toLocaleString("pt-PT", { minimumFractionDigits: 0, maximumFractionDigits: d });

/** Agrupa chapas/barras com exatamente o mesmo desenho. */
function groupBy<T>(items: T[], key: (t: T) => string) {
  const groups: { first: T; count: number; indexes: number[] }[] = [];
  const map = new Map<string, number>();
  items.forEach((it, i) => {
    const k = key(it);
    const g = map.get(k);
    if (g === undefined) {
      map.set(k, groups.length);
      groups.push({ first: it, count: 1, indexes: [i + 1] });
    } else {
      groups[g].count++;
      groups[g].indexes.push(i + 1);
    }
  });
  return groups;
}

function rangeLabel(indexes: number[]) {
  if (indexes.length === 1) return `${indexes[0]}`;
  const contiguous = indexes.every((n, i) => i === 0 || n === indexes[i - 1] + 1);
  return contiguous ? `${indexes[0]} a ${indexes[indexes.length - 1]}` : indexes.join(", ");
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="stat-card" style={accent ? ({ "--stat-accent": accent } as React.CSSProperties) : undefined}>
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-label">{label}</div>
    </div>
  );
}

export function CutPlanView({ input, result }: { input: CutPlanInput; result: CutResult }) {
  return (
    <div className="cut-view">
      {result.mode === "CHAPAS" ? (
        <SheetTotalsView totals={result.totals} />
      ) : (
        <BarTotalsView totals={result.totals} />
      )}

      {result.unplaced.length > 0 && (
        <div className="card" style={{ borderLeft: "4px solid #dc2626", background: "#fef2f2" }}>
          <strong>Peças que ficaram de fora:</strong>
          <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
            {result.unplaced.map((u) => (
              <li key={u.typeIndex}>
                {u.ref} — {u.qty} un. ({u.reason})
              </li>
            ))}
          </ul>
        </div>
      )}

      <PiecesTable input={input} result={result} />

      {result.mode === "CHAPAS" ? <SheetsList sheets={result.sheets} /> : <BarsList bars={result.bars} input={input} />}
    </div>
  );
}

function SheetTotalsView({ totals }: { totals: SheetTotals }) {
  const formats = totals.byFormat.map((f) => `${f.count}× ${f.length}×${f.width}`).join(" · ");
  return (
    <>
      <div className="stat-grid cut-stats">
        <Stat label={`Chapas gastas${formats ? ` (${formats})` : ""}`} value={String(totals.sheetsCount)} />
        <Stat label="m² das peças" value={nf(totals.piecesM2, 3)} accent="#16a34a" />
        <Stat label="m² das chapas gastas (usada + não usada)" value={nf(totals.sheetsM2, 3)} accent="#0e7490" />
        <Stat label={`Aproveitamento (desperdício ${nf(totals.wasteM2, 3)} m²)`} value={`${nf(totals.yieldPct, 1)}%`} accent="#d97706" />
        <Stat label="Nº de cortes" value={String(totals.cuts)} accent="#6d28d9" />
        <Stat label="Nº de quinagens" value={String(totals.bends)} accent="#be185d" />
        <Stat label="Nº de corta-cantos" value={String(totals.cornerCuts)} accent="#334155" />
      </div>
    </>
  );
}

function BarTotalsView({ totals }: { totals: BarTotals }) {
  const lengths = totals.byLength.map((b) => `${b.count}× ${b.length} mm`).join(" · ");
  return (
    <>
    <div className="stat-grid cut-stats">
      <Stat label={`Barras gastas${lengths ? ` (${lengths})` : ""}`} value={String(totals.barsCount)} />
      <Stat label="Metros de peças" value={`${nf(totals.piecesM, 2)} m`} accent="#16a34a" />
      <Stat label="Metros de barra gastos" value={`${nf(totals.barsM, 2)} m`} accent="#0e7490" />
      <Stat label={`Aproveitamento (desperdício ${nf(totals.wasteM, 2)} m)`} value={`${nf(totals.yieldPct, 1)}%`} accent="#d97706" />
      <Stat label="Nº de cortes" value={String(totals.cuts)} accent="#6d28d9" />
      <Stat
        label={`Sobras a guardar (${nf(totals.reusableM, 2)} m)`}
        value={String(totals.reusableRemnants)}
        accent="#334155"
      />
    </div>
    {totals.byProfile && totals.byProfile.length > 0 && (
      <div className="card cut-pieces">
        <h3 style={{ margin: "0 0 8px" }}>Por perfil</h3>
        <div className="cut-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Perfil</th>
                <th>Barras</th>
                <th>Metros de peças</th>
                <th>Aproveitamento</th>
                <th>Cortes</th>
              </tr>
            </thead>
            <tbody>
              {totals.byProfile.map((p) => (
                <tr key={p.profile}>
                  <td>
                    <strong>{p.profile}</strong>
                  </td>
                  <td>
                    {p.barsCount} ({p.byLength.map((b) => `${b.count}× ${b.length}`).join(", ")})
                  </td>
                  <td>{nf(p.piecesM, 2)} m</td>
                  <td>{nf(p.yieldPct, 1)}%</td>
                  <td>{p.cuts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )}
    </>
  );
}

function PiecesTable({ input, result }: { input: CutPlanInput; result: CutResult }) {
  const placed = new Map<number, number>();
  if (result.mode === "CHAPAS") result.sheets.forEach((s) => s.pieces.forEach((p) => placed.set(p.typeIndex, (placed.get(p.typeIndex) ?? 0) + 1)));
  else result.bars.forEach((b) => b.pieces.forEach((p) => placed.set(p.typeIndex, (placed.get(p.typeIndex) ?? 0) + 1)));

  const hasProfile = input.mode === "BARRAS" && input.pieces.some((p) => p.profile);
  const orders = planOrders(input);

  return (
    <>
    {input.mode === "BARRAS" && input.mosquitos && input.mosquitos.length > 0 && <MosquitoSource input={input} />}
    <div className="card cut-pieces">
      <h3 style={{ margin: "0 0 8px" }}>Lista de peças</h3>
      <div className="cut-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Ref.</th>
            <th>Descrição</th>
            {hasProfile && <th>Perfil</th>}
            {orders.length > 0 && <th>OS</th>}
            {input.mode === "CHAPAS" ? <th>Largura × Comprimento</th> : <th>Comprimento</th>}
            <th>Quant.</th>
            {input.mode === "CHAPAS" && (
              <>
                <th>Rodar</th>
                <th>Quinagens</th>
                <th>Corta-cantos</th>
              </>
            )}
            <th>No plano</th>
          </tr>
        </thead>
        <tbody>
          {input.pieces.map((p, i) => {
            const pOs = (p as { os?: string | null }).os?.trim();
            const o = orders.find((x) => x.os === pOs);
            const c = orders.length ? (o ? osColor(o.index) : pieceColor(i)) : pieceColor(i);
            const n = placed.get(i) ?? 0;
            return (
              <tr key={i}>
                <td>
                  <span className="cut-swatch" style={{ background: c.fill, borderColor: c.stroke }} />
                  <strong>{p.ref}</strong>
                </td>
                <td>{p.description || "—"}</td>
                {hasProfile && <td>{(p as { profile?: string | null }).profile || "—"}</td>}
                {orders.length > 0 && <td>{pOs || "—"}</td>}
                <td>{input.mode === "CHAPAS" ? `${nf((p as { width: number }).width, 1)} × ${nf(p.length, 1)}` : nf(p.length, 1)}</td>
                <td>{p.qty}</td>
                {input.mode === "CHAPAS" && (
                  <>
                    <td>{(p as { rotate: boolean }).rotate ? "Sim" : "Não"}</td>
                    <td>{(p as { bends?: number | null }).bends ?? 0}</td>
                    <td>{(p as { cornerCuts?: number | null }).cornerCuts ?? 0}</td>
                  </>
                )}
                <td style={{ color: n < p.qty ? "#dc2626" : undefined, fontWeight: n < p.qty ? 700 : undefined }}>
                  {n}/{p.qty}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
        Total — {input.pieces.reduce((a, p) => a + p.qty, 0)} unid.
      </p>
    </div>
    </>
  );
}

/** Mosquiteiras de onde saíram as peças e os descontos aplicados. */
function MosquitoSource({ input }: { input: Extract<CutPlanInput, { mode: "BARRAS" }> }) {
  const r = input.mosquitoRules;
  const items = input.mosquitos ?? [];
  const hasOs = items.some((m) => m.os);
  return (
    <div className="card cut-pieces">
      <h3 style={{ margin: "0 0 4px" }}>Mosquiteiras</h3>
      {r && (
        <p className="muted" style={{ fontSize: 13, margin: "0 0 8px" }}>
          Alturas − {nf(r.heightDeduct ?? 0, 1)} mm ({r.heightsPerUnit} por mosquiteira) · larguras até {nf(r.widthLimit, 0)} −{" "}
          {nf(r.widthDeductSmall ?? 0, 1)} mm · acima de {nf(r.widthLimit, 0)} − {nf(r.widthDeductLarge ?? 0, 1)} mm ({r.widthsPerUnit}{" "}
          por mosquiteira)
        </p>
      )}
      <div className="cut-table-wrap">
        <table>
          <thead>
            <tr>
              {hasOs && <th>OS</th>}
              <th>Largura × Altura</th>
              <th>Quant.</th>
              <th>Acabamento</th>
            </tr>
          </thead>
          <tbody>
            {items.map((m, i) => (
              <tr key={i}>
                {hasOs && (
                  <td>
                    {m.os || "—"}
                    {m.client && <div className="muted" style={{ fontSize: 12 }}>{m.client}</div>}
                  </td>
                )}
                <td>
                  {nf(m.width, 1)} × {nf(m.height, 1)}
                </td>
                <td>{m.qty}</td>
                <td>{m.finish || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
        Total — {items.reduce((a, m) => a + m.qty, 0)} unid.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chapas
// ---------------------------------------------------------------------------

function SheetsList({ sheets }: { sheets: SheetLayout[] }) {
  const groups = groupBy(sheets, (s) =>
    `${s.length}x${s.width}|` +
    s.pieces
      .map((p) => `${p.typeIndex}:${p.x},${p.y},${p.l},${p.w}`)
      .sort()
      .join(";")
  );
  return (
    <>
      {groups.map((g) => (
        <div className="card cut-sheet" key={g.indexes[0]}>
          <div className="cut-sheet-head">
            <strong>
              Chapa {rangeLabel(g.indexes)} — {g.first.length} × {g.first.width} mm
            </strong>
            {g.count > 1 && <span className="badge" style={{ background: "#1f3fe0" }}>× {g.count} iguais</span>}
            <span className="muted">
              {g.first.pieces.length} peças · aproveitamento {nf(g.first.utilization * 100, 1)}% · {g.first.cuts} cortes
              {g.count > 1 ? " por chapa" : ""}
            </span>
          </div>
          <SheetDrawing sheet={g.first} />
        </div>
      ))}
    </>
  );
}

function SheetDrawing({ sheet }: { sheet: SheetLayout }) {
  const { length: L, width: W } = sheet;
  const base = Math.max(L, W) / 55; // tamanho de letra de referência
  const pad = base * 2.2;
  return (
    <svg
      className="cut-svg"
      viewBox={`${-pad} ${-pad} ${L + pad * 1.4} ${W + pad * 1.6}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Chapa ${L} por ${W}`}
    >
      {/* cotas da chapa */}
      <text x={L / 2} y={-pad * 0.35} fontSize={base} textAnchor="middle" fill="#475467">
        {nf(L, 1)}
      </text>
      <text
        x={-pad * 0.35}
        y={W / 2}
        fontSize={base}
        textAnchor="middle"
        fill="#475467"
        transform={`rotate(-90 ${-pad * 0.35} ${W / 2})`}
      >
        {nf(W, 1)}
      </text>
      <rect x={0} y={0} width={L} height={W} fill="#f2f4f7" stroke="#344054" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      {sheet.pieces.map((p, i) => {
        const c = pieceColor(p.typeIndex);
        const pw = p.rotated ? p.l : p.w; // largura da peça
        const pl = p.rotated ? p.w : p.l; // comprimento da peça
        const dims = `${nf(pw, 1)}×${nf(pl, 1)}${p.rotated ? " ↻" : ""}`;
        const short = Math.min(p.l, p.w);
        const vertical = p.w > p.l * 1.3; // escrever ao alto em peças estreitas e altas
        const along = vertical ? p.w : p.l;
        const fs = Math.max(Math.min(base, short * 0.32, (along / Math.max(dims.length, 4)) * 1.6), 0);
        const showDims = short >= fs * 2.6;
        const cx = p.x + p.l / 2;
        const cy = p.y + p.w / 2;
        return (
          <g key={i}>
            <rect
              x={p.x}
              y={p.y}
              width={p.l}
              height={p.w}
              fill={c.fill}
              stroke={c.stroke}
              strokeWidth={1.2}
              vectorEffect="non-scaling-stroke"
            />
            {fs > base * 0.18 && (
              <text
                x={cx}
                y={cy}
                fontSize={fs}
                textAnchor="middle"
                fill={c.stroke}
                transform={vertical ? `rotate(-90 ${cx} ${cy})` : undefined}
              >
                <tspan x={cx} dy={showDims ? -fs * 0.15 : fs * 0.35} fontWeight={700}>
                  {p.ref}
                </tspan>
                {showDims && (
                  <tspan x={cx} dy={fs * 1.05} fontSize={fs * 0.8}>
                    {dims}
                  </tspan>
                )}
              </text>
            )}
          </g>
        );
      })}
      {/* primeiros cortes (tiras), a tracejado */}
      {sheet.strips.map((s, i) => {
        const at = s.pos + s.size;
        if (s.vertical ? at >= L - 0.5 : at >= W - 0.5) return null;
        return s.vertical ? (
          <line key={i} x1={at} y1={-pad * 0.15} x2={at} y2={W + pad * 0.15} stroke="#dc2626" strokeWidth={1.5} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
        ) : (
          <line key={i} x1={-pad * 0.15} y1={at} x2={L + pad * 0.15} y2={at} stroke="#dc2626" strokeWidth={1.5} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Barras
// ---------------------------------------------------------------------------

function BarsList({ bars, input }: { bars: BarLayout[]; input: CutPlanInput }) {
  const groups = groupBy(bars, (b) => `${b.profile ?? ""}|${b.length}|${b.pieces.map((p) => `${p.typeIndex}:${p.length}`).join(";")}`);
  const profiles = [...new Set(bars.map((b) => b.profile ?? ""))];
  const named = profiles.some((p) => p);
  const orders = planOrders(input);
  const osOf = (typeIndex: number) => (input.pieces[typeIndex] as { os?: string | null } | undefined)?.os?.trim() || null;
  return (
    <div className="card cut-bars">
      <h3 style={{ margin: "0 0 10px" }}>Barras</h3>
      {orders.length > 0 && (
        <div className="cut-os-legend">
          {orders.map((o) => {
            const c = osColor(o.index);
            return (
              <span key={o.os} className="cut-os-chip" style={{ background: c.fill, borderColor: c.stroke, color: c.stroke }}>
                <b>OS {o.os}</b>
                {o.client ? ` — ${o.client}` : ""}
              </span>
            );
          })}
        </div>
      )}
      {profiles.map((profile) => (
        <div key={profile || "-"}>
          {named && (
            <div className="cut-profile-head">
              <strong style={{ fontSize: 16 }}>{profile || "Sem perfil"}</strong>
              <span className="muted" style={{ fontSize: 13 }}>
                {bars.filter((b) => (b.profile ?? "") === profile).length} barra(s)
              </span>
            </div>
          )}
      {groups.filter((g) => (g.first.profile ?? "") === profile).map((g) => {
        const b = g.first;
        const start = b.pieces.length ? b.pieces[0].offset : 0;
        return (
          <div className="cut-bar-row" key={g.indexes[0]}>
            <div className="cut-bar-label">
              <strong>
                Barra {rangeLabel(g.indexes)} — {nf(b.length, 1)} mm
              </strong>
              {g.count > 1 && <span className="badge" style={{ background: "#1f3fe0" }}>× {g.count}</span>}
              <span className="muted">
                {b.pieces.length} peças · {b.cuts} cortes · sobra {nf(b.remnant, 1)} mm{b.reusable ? " (guardar)" : ""}
              </span>
            </div>
            <div className={`cut-bar${orders.length ? " with-os" : ""}`}>
              {start > 0 && <div className="cut-bar-seg cut-bar-trim" style={{ width: `${(start / b.length) * 100}%` }} title={`Topo ${start} mm`} />}
              {b.pieces.map((p, i) => {
                const pOs = osOf(p.typeIndex);
                const o = orders.find((x) => x.os === pOs);
                const c = orders.length && o ? osColor(o.index) : pieceColor(p.typeIndex);
                const next = i + 1 < b.pieces.length ? b.pieces[i + 1].offset : b.usedLength;
                const gap = Math.max(0, next - (p.offset + p.length));
                return (
                  <div key={i} style={{ display: "contents" }}>
                    <div
                      className="cut-bar-seg"
                      style={{ width: `${(p.length / b.length) * 100}%`, background: c.fill, borderColor: c.stroke, color: c.stroke }}
                      title={`${p.ref} — ${p.length} mm${pOs ? ` — OS ${pOs}` : ""}`}
                    >
                      <span>
                        <b>{p.ref}</b> {nf(p.length, 1)}
                        {pOs && <small className="cut-seg-os">OS {shortOs(pOs)}</small>}
                      </span>
                    </div>
                    {gap > 0 && <div className="cut-bar-kerf" style={{ width: `${(gap / b.length) * 100}%` }} />}
                  </div>
                );
              })}
              {b.remnant > 0 && (
                <div
                  className={`cut-bar-seg cut-bar-rest${b.reusable ? " reusable" : ""}`}
                  style={{ width: `${(b.remnant / b.length) * 100}%` }}
                  title={`Sobra ${b.remnant} mm`}
                >
                  <span>{nf(b.remnant, 0)}</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
        </div>
      ))}
    </div>
  );
}
