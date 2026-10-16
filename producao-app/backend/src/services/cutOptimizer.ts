// ============================================================================
// Otimização de corte tipo "cut list" (pedido do utilizador de 2026-10-16:
// "Melhoria programa de gestão produção — otimização de corte tipo cut list",
// para chapas e para barras).
//
// Dois modos, sem dependências externas:
//
//  CHAPAS (2D) — peças Largura × Comprimento em chapas de formato standard
//    (por omissão os seis formatos fixos da JPDC: 3000×1250, 3000×1500,
//    3000×800, 2500×1250, 2000×1000, 4000×1250, podendo misturar formatos).
//    Corte em guilhotina "de ponta a ponta": a chapa é primeiro cortada em
//    tiras, cada tira em colunas e cada coluna em peças (3 fases). Assim todos
//    os cortes vão de um lado ao outro, como na guilhotina/quinadora, e o nº de
//    cortes contado é o real.
//
//  BARRAS (1D) — comprimentos cortados de barras (por omissão 6000 mm), com
//    largura da lâmina (serra) e topo inicial. Cada barra é enchida da forma
//    exata que melhor a aproveita (mochila limitada), escolhendo também o
//    comprimento de barra mais económico quando há vários.
//
// Em ambos os modos correm-se várias estratégias e fica a que gasta menos
// material (m² de chapa ou metros de barra); em empate, a com menos cortes.
// ============================================================================

const EPS = 1e-6;

// ---------------------------------------------------------------------------
// Tipos — CHAPAS
// ---------------------------------------------------------------------------

export interface SheetPieceInput {
  ref: string;
  description?: string | null;
  width: number; // largura (mm)
  length: number; // comprimento (mm)
  qty: number;
  rotate: boolean; // pode rodar 90° na chapa
  bends?: number | null; // quinagens por peça (chapa quinada)
  cornerCuts?: number | null; // corta-cantos por peça
}

export interface SheetStockInput {
  length: number; // comprimento da chapa (mm), ex.: 3000
  width: number; // largura da chapa (mm), ex.: 1250
  qty?: number | null; // chapas disponíveis (vazio = ilimitado)
}

export interface SheetSettings {
  kerf: number; // espessura do corte (mm) — 0 na guilhotina
  trim: number; // margem de esquadria em cada lado (mm)
}

export interface SheetPlacement {
  ref: string;
  typeIndex: number;
  x: number; // ao longo do comprimento da chapa
  y: number; // ao longo da largura da chapa
  l: number; // medida ao longo do comprimento da chapa
  w: number; // medida ao longo da largura da chapa
  rotated: boolean; // true = comprimento da peça na largura da chapa
}

export interface SheetLayout {
  index: number;
  stockIndex: number;
  length: number;
  width: number;
  pieces: SheetPlacement[];
  strips: { pos: number; size: number; vertical: boolean }[];
  cuts: number;
  piecesArea: number; // mm²
  utilization: number; // 0..1
}

export interface UnplacedPiece {
  ref: string;
  typeIndex: number;
  qty: number;
  reason: string;
}

export interface SheetResult {
  mode: "CHAPAS";
  sheets: SheetLayout[];
  unplaced: UnplacedPiece[];
  totals: {
    piecesCount: number;
    piecesM2: number;
    sheetsCount: number;
    sheetsM2: number;
    wasteM2: number;
    yieldPct: number;
    cuts: number;
    bends: number;
    cornerCuts: number;
    byFormat: { length: number; width: number; count: number }[];
  };
}

// ---------------------------------------------------------------------------
// Tipos — BARRAS
// ---------------------------------------------------------------------------

export interface BarPieceInput {
  ref: string;
  description?: string | null;
  length: number;
  qty: number;
  // Perfil de onde sai a peça (ex.: "Guias", "Largura até 1400"). Peças de
  // perfis diferentes nunca partilham a mesma barra.
  profile?: string | null;
}

export interface BarStockInput {
  length: number;
  qty?: number | null;
}

export interface BarSettings {
  kerf: number; // largura da lâmina (mm)
  trim: number; // topo cortado no início de cada barra (mm)
  minRemnant: number; // sobra a partir da qual se guarda (mm)
}

export interface BarLayout {
  index: number;
  stockIndex: number;
  profile?: string | null;
  length: number;
  pieces: { ref: string; typeIndex: number; offset: number; length: number }[];
  usedLength: number; // incluindo cortes e topo
  remnant: number;
  reusable: boolean;
  cuts: number;
}

export interface BarResult {
  mode: "BARRAS";
  bars: BarLayout[];
  unplaced: UnplacedPiece[];
  totals: {
    piecesCount: number;
    piecesM: number;
    barsCount: number;
    barsM: number;
    wasteM: number;
    yieldPct: number;
    cuts: number;
    reusableRemnants: number;
    reusableM: number;
    byLength: { length: number; count: number }[];
    // Resumo por perfil (só quando há mais do que um perfil ou um perfil com nome)
    byProfile?: { profile: string; barsCount: number; piecesM: number; barsM: number; yieldPct: number; cuts: number; byLength: { length: number; count: number }[] }[];
  };
}

export type CutResult = SheetResult | BarResult;

// ============================================================================
// CHAPAS — empacotamento de uma chapa em tiras / colunas / peças
// ============================================================================

interface Unit {
  uid: number;
  typeIndex: number;
  ref: string;
  dx: number; // medida ao longo do comprimento da chapa (sem rodar)
  dy: number; // medida ao longo da largura da chapa (sem rodar)
  canRotate: boolean;
}

interface Placed {
  unit: Unit;
  x: number;
  y: number;
  w: number; // ao longo da tira
  h: number; // atravessando a tira
}

interface Column {
  x: number;
  w: number;
  usedY: number; // altura ocupada na coluna (relativa à tira)
  pieces: Placed[];
}

interface Strip {
  y: number;
  h: number;
  usedX: number;
  columns: Column[];
}

type Rule = "acrossLong" | "acrossShort" | "asGiven";
type SortKey = "across" | "area" | "along";

/** Orientações possíveis de uma unidade no referencial (ao longo, através). */
function orientations(u: Unit): [number, number][] {
  const list: [number, number][] = [[u.dx, u.dy]];
  if (u.canRotate && Math.abs(u.dx - u.dy) > EPS) list.push([u.dy, u.dx]);
  return list;
}

function preferred(u: Unit, rule: Rule): [number, number][] {
  const o = orientations(u);
  if (o.length === 1 || rule === "asGiven") return o;
  // [ao longo, através]
  return [...o].sort((a, b) => (rule === "acrossLong" ? b[1] - a[1] : a[1] - b[1]));
}

/**
 * Empacota o máximo possível de unidades numa chapa de binW (ao longo das
 * tiras) × binH (através das tiras). Devolve as tiras e as peças colocadas.
 */
function packStrips(
  binW: number,
  binH: number,
  units: Unit[],
  kerf: number,
  rule: Rule,
  sortKey: SortKey
): { strips: Strip[]; placed: Placed[] } {
  const keyed = units.map((u) => {
    const [al, ac] = preferred(u, rule)[0];
    return { u, al, ac };
  });
  keyed.sort((a, b) => {
    if (sortKey === "area") return b.al * b.ac - a.al * a.ac || b.ac - a.ac;
    if (sortKey === "along") return b.al - a.al || b.ac - a.ac;
    return b.ac - a.ac || b.al - a.al;
  });

  const strips: Strip[] = [];
  const placed: Placed[] = [];
  let usedH = 0;

  for (const { u } of keyed) {
    const opts = orientations(u);
    // 1) melhor encaixe numa tira já aberta (empilhar numa coluna ou nova coluna)
    let best: { waste: number; apply: () => void } | null = null;
    for (const s of strips) {
      for (const [w, h] of opts) {
        if (h > s.h + EPS) continue;
        // empilhar em coluna existente
        for (const c of s.columns) {
          if (w <= c.w + EPS && c.usedY + kerf + h <= s.h + EPS) {
            const waste = (c.w - w) * h + 0.01;
            if (!best || waste < best.waste) {
              best = {
                waste,
                apply: () => {
                  const p: Placed = { unit: u, x: c.x, y: s.y + c.usedY + kerf, w, h };
                  c.usedY += kerf + h;
                  c.pieces.push(p);
                  placed.push(p);
                },
              };
            }
          }
        }
        // nova coluna no fim da tira
        const gap = s.columns.length ? kerf : 0;
        if (s.usedX + gap + w <= binW + EPS) {
          const waste = (s.h - h) * w;
          if (!best || waste < best.waste) {
            best = {
              waste,
              apply: () => {
                const x = s.usedX + gap;
                const p: Placed = { unit: u, x, y: s.y, w, h };
                s.columns.push({ x, w, usedY: h, pieces: [p] });
                s.usedX = x + w;
                placed.push(p);
              },
            };
          }
        }
      }
    }
    if (best) {
      best.apply();
      continue;
    }
    // 2) abrir tira nova
    const gap = strips.length ? kerf : 0;
    const open = preferred(u, rule).find(([w, h]) => w <= binW + EPS && usedH + gap + h <= binH + EPS);
    if (!open) continue;
    const [w, h] = open;
    const y = usedH + gap;
    const p: Placed = { unit: u, x: 0, y, w, h };
    strips.push({ y, h, usedX: w, columns: [{ x: 0, w, usedY: h, pieces: [p] }] });
    usedH = y + h;
    placed.push(p);
  }
  return { strips, placed };
}

/** Nº de cortes de guilhotina (de ponta a ponta) para separar todas as peças. */
function countSheetCuts(strips: Strip[], binW: number, binH: number): number {
  let cuts = 0;
  strips.forEach((s, i) => {
    const lastStrip = i === strips.length - 1;
    if (!(lastStrip && s.y + s.h >= binH - EPS)) cuts++; // corte que separa a tira
    s.columns.forEach((c, j) => {
      const lastCol = j === s.columns.length - 1;
      if (!(lastCol && c.x + c.w >= binW - EPS)) cuts++; // corte que separa a coluna
      c.pieces.forEach((p) => {
        if (p.y + p.h < s.y + s.h - EPS) cuts++; // separar a peça do que fica acima
        if (p.w < c.w - EPS) cuts++; // acertar a peça mais estreita que a coluna
      });
    });
  });
  return cuts;
}

interface SheetPack {
  layout: Omit<SheetLayout, "index" | "stockIndex">;
  units: Unit[];
}

/** Melhor empacotamento de uma chapa (várias direções/regras/ordens). */
function bestSheetPack(stock: SheetStockInput, units: Unit[], s: SheetSettings): SheetPack | null {
  const L = stock.length - 2 * s.trim; // útil ao longo do comprimento
  const W = stock.width - 2 * s.trim; // útil ao longo da largura
  if (L <= 0 || W <= 0) return null;

  let best: { placed: Placed[]; strips: Strip[]; vertical: boolean; area: number; cuts: number } | null = null;
  // Em planos muito grandes testam-se menos variantes, para a resposta não demorar.
  const big = units.length > 250;
  const rules: Rule[] = big ? ["acrossLong", "acrossShort"] : ["acrossLong", "acrossShort", "asGiven"];
  const sorts: SortKey[] = big ? ["across"] : ["across", "area", "along"];

  for (const vertical of [false, true]) {
    // Horizontal: tiras ao longo do comprimento da chapa. Vertical: tiras
    // atravessando a largura (transpõe-se a chapa e as peças).
    const binW = vertical ? W : L;
    const binH = vertical ? L : W;
    const tUnits = vertical ? units.map((u) => ({ ...u, dx: u.dy, dy: u.dx })) : units;
    for (const rule of rules) {
      for (const sortKey of sorts) {
        const { strips, placed } = packStrips(binW, binH, tUnits, s.kerf, rule, sortKey);
        if (!placed.length) continue;
        const area = placed.reduce((a, p) => a + p.w * p.h, 0);
        const cuts = countSheetCuts(strips, binW, binH);
        if (!best || area > best.area + EPS || (Math.abs(area - best.area) <= EPS && cuts < best.cuts)) {
          best = { placed, strips, vertical, area, cuts };
        }
      }
    }
  }
  if (!best) return null;

  const byUid = new Map(units.map((u) => [u.uid, u]));
  const pieces: SheetPlacement[] = best.placed.map((p) => {
    const u = byUid.get(p.unit.uid)!;
    // Voltar ao referencial da chapa (x = comprimento, y = largura) e somar a esquadria.
    const x = (best!.vertical ? p.y : p.x) + s.trim;
    const y = (best!.vertical ? p.x : p.y) + s.trim;
    const l = best!.vertical ? p.h : p.w;
    const w = best!.vertical ? p.w : p.h;
    return { ref: u.ref, typeIndex: u.typeIndex, x, y, l, w, rotated: Math.abs(l - u.dx) > EPS };
  });
  const trimCuts = s.trim > 0 ? 4 : 0;
  return {
    layout: {
      length: stock.length,
      width: stock.width,
      pieces,
      strips: best.strips.map((st) => ({ pos: st.y + s.trim, size: st.h, vertical: best!.vertical })),
      cuts: best.cuts + trimCuts,
      piecesArea: best.area,
      utilization: best.area / (stock.length * stock.width),
    },
    units: best.placed.map((p) => byUid.get(p.unit.uid)!),
  };
}

function fitsStock(u: Unit, st: SheetStockInput, s: SheetSettings) {
  const L = st.length - 2 * s.trim;
  const W = st.width - 2 * s.trim;
  return orientations(u).some(([a, b]) => a <= L + EPS && b <= W + EPS);
}

type Strategy = "utilization" | "biggest";

function runSheetStrategy(
  units: Unit[],
  stock: SheetStockInput[],
  s: SheetSettings,
  strategy: Strategy
): { sheets: SheetLayout[]; left: Unit[] } {
  const used = stock.map(() => 0);
  const available = (i: number) => stock[i].qty == null || used[i] < (stock[i].qty as number);
  let remaining = [...units];
  const sheets: SheetLayout[] = [];
  let unitSets: Unit[][] = [];

  while (remaining.length) {
    let best: { i: number; pack: SheetPack; score: number } | null = null;
    stock.forEach((st, i) => {
      if (!available(i)) return;
      const pack = bestSheetPack(st, remaining, s);
      if (!pack) return;
      const score = strategy === "utilization" ? pack.layout.utilization : pack.layout.piecesArea;
      if (
        !best ||
        score > best.score + 1e-9 ||
        (Math.abs(score - best.score) <= 1e-9 && pack.layout.piecesArea > best.pack.layout.piecesArea)
      ) {
        best = { i, pack, score };
      }
    });
    if (!best) break;
    const b = best as { i: number; pack: SheetPack; score: number };
    used[b.i]++;
    sheets.push({ index: sheets.length, stockIndex: b.i, ...b.pack.layout });
    unitSets.push(b.pack.units);
    const placedIds = new Set(b.pack.units.map((u) => u.uid));
    remaining = remaining.filter((u) => !placedIds.has(u.uid));
  }

  // Passagem final: trocar cada chapa por um formato mais pequeno, se lá
  // couberem exatamente as mesmas peças (ex.: última chapa meio vazia).
  sheets.forEach((sh, k) => {
    const set = unitSets[k];
    const order = stock
      .map((st, i) => ({ st, i }))
      .filter(({ st }) => st.length * st.width < sh.length * sh.width - EPS)
      .sort((a, b) => a.st.length * a.st.width - b.st.length * b.st.width);
    for (const { st, i } of order) {
      if (!available(i)) continue;
      const pack = bestSheetPack(st, set, s);
      if (pack && pack.units.length === set.length) {
        used[sh.stockIndex]--;
        used[i]++;
        sheets[k] = { index: k, stockIndex: i, ...pack.layout };
        unitSets[k] = pack.units;
        break;
      }
    }
  });
  unitSets = [];
  return { sheets, left: remaining };
}

export function optimizeSheets(
  pieces: SheetPieceInput[],
  stock: SheetStockInput[],
  settings: SheetSettings
): SheetResult {
  const units: Unit[] = [];
  const unplaced: UnplacedPiece[] = [];
  let uid = 0;
  pieces.forEach((p, typeIndex) => {
    const proto: Unit = { uid: -1, typeIndex, ref: p.ref, dx: p.length, dy: p.width, canRotate: p.rotate };
    if (!stock.some((st) => fitsStock(proto, st, settings))) {
      unplaced.push({ ref: p.ref, typeIndex, qty: p.qty, reason: "Não cabe em nenhum formato de chapa" });
      return;
    }
    for (let k = 0; k < p.qty; k++) units.push({ ...proto, uid: uid++ });
  });

  let chosen: { sheets: SheetLayout[]; left: Unit[] } | null = null;
  for (const strategy of ["utilization", "biggest"] as Strategy[]) {
    const r = runSheetStrategy(units, stock, settings, strategy);
    const area = (x: typeof r) => x.sheets.reduce((a, sh) => a + sh.length * sh.width, 0);
    const cuts = (x: typeof r) => x.sheets.reduce((a, sh) => a + sh.cuts, 0);
    if (
      !chosen ||
      r.left.length < chosen.left.length ||
      (r.left.length === chosen.left.length &&
        (area(r) < area(chosen) - EPS ||
          (Math.abs(area(r) - area(chosen)) <= EPS &&
            (r.sheets.length < chosen.sheets.length ||
              (r.sheets.length === chosen.sheets.length && cuts(r) < cuts(chosen))))))
    ) {
      chosen = r;
    }
  }
  const { sheets, left } = chosen!;

  // Peças que sobraram por falta de chapas disponíveis (quantidades limitadas).
  const leftByType = new Map<number, number>();
  left.forEach((u) => leftByType.set(u.typeIndex, (leftByType.get(u.typeIndex) ?? 0) + 1));
  leftByType.forEach((qty, typeIndex) =>
    unplaced.push({ ref: pieces[typeIndex].ref, typeIndex, qty, reason: "Faltam chapas disponíveis" })
  );

  const placedCount = new Map<number, number>();
  sheets.forEach((sh) => sh.pieces.forEach((p) => placedCount.set(p.typeIndex, (placedCount.get(p.typeIndex) ?? 0) + 1)));

  const piecesArea = sheets.reduce((a, sh) => a + sh.piecesArea, 0);
  const sheetsArea = sheets.reduce((a, sh) => a + sh.length * sh.width, 0);
  const byFormat = new Map<string, { length: number; width: number; count: number }>();
  sheets.forEach((sh) => {
    const k = `${sh.length}x${sh.width}`;
    const e = byFormat.get(k) ?? { length: sh.length, width: sh.width, count: 0 };
    e.count++;
    byFormat.set(k, e);
  });

  let bends = 0;
  let cornerCuts = 0;
  pieces.forEach((p, i) => {
    const n = placedCount.get(i) ?? 0;
    bends += n * (p.bends ?? 0);
    cornerCuts += n * (p.cornerCuts ?? 0);
  });

  return {
    mode: "CHAPAS",
    sheets,
    unplaced,
    totals: {
      piecesCount: sheets.reduce((a, sh) => a + sh.pieces.length, 0),
      piecesM2: round(piecesArea / 1e6, 3),
      sheetsCount: sheets.length,
      sheetsM2: round(sheetsArea / 1e6, 3),
      wasteM2: round((sheetsArea - piecesArea) / 1e6, 3),
      yieldPct: sheetsArea ? round((piecesArea / sheetsArea) * 100, 1) : 0,
      cuts: sheets.reduce((a, sh) => a + sh.cuts, 0),
      bends,
      cornerCuts,
      byFormat: [...byFormat.values()].sort((a, b) => b.count - a.count),
    },
  };
}

// ============================================================================
// BARRAS — enchimento ótimo de cada barra (mochila limitada)
// ============================================================================

/**
 * Escolhe quantas peças de cada tipo cabem numa barra, enchendo-a o mais
 * possível. Pesos inteiros (mm, arredondados para cima, já com a lâmina).
 * Devolve a contagem por tipo.
 */
function fillBar(capacity: number, weights: number[], counts: number[]): number[] {
  // Divisão binária das quantidades → mochila 0/1.
  const chunks: { type: number; k: number; w: number }[] = [];
  weights.forEach((w, t) => {
    let left = counts[t];
    let k = 1;
    while (left > 0 && w <= capacity) {
      const take = Math.min(k, left);
      if (w * take <= capacity) chunks.push({ type: t, k: take, w: w * take });
      left -= take;
      k *= 2;
    }
  });
  const from = new Int32Array(capacity + 1).fill(-1);
  const reach = new Uint8Array(capacity + 1);
  reach[0] = 1;
  let bestC = 0;
  chunks.forEach((ch, j) => {
    for (let c = capacity; c >= ch.w; c--) {
      if (!reach[c] && reach[c - ch.w]) {
        reach[c] = 1;
        from[c] = j;
        if (c > bestC) bestC = c;
      }
    }
  });
  const take = weights.map(() => 0);
  let c = bestC;
  while (c > 0) {
    const ch = chunks[from[c]];
    take[ch.type] += ch.k;
    c -= ch.w;
  }
  return take;
}

function runBarStrategy(
  pieces: BarPieceInput[],
  counts: number[],
  stock: BarStockInput[],
  s: BarSettings,
  strategy: Strategy
): { bars: BarLayout[]; left: number[] } {
  const remaining = [...counts];
  const used = stock.map(() => 0);
  const available = (i: number) => stock[i].qty == null || used[i] < (stock[i].qty as number);
  const weights = pieces.map((p) => Math.ceil(p.length + s.kerf - EPS));
  const bars: BarLayout[] = [];
  const takes: number[][] = [];

  const build = (i: number, take: number[], index: number): BarLayout => {
    const L = stock[i].length;
    const list: BarLayout["pieces"] = [];
    let offset = s.trim;
    let cuts = s.trim > 0 ? 1 : 0;
    const order = take
      .map((n, t) => ({ n, t }))
      .filter((x) => x.n > 0)
      .sort((a, b) => pieces[b.t].length - pieces[a.t].length);
    order.forEach(({ n, t }) => {
      for (let k = 0; k < n; k++) {
        list.push({ ref: pieces[t].ref, typeIndex: t, offset, length: pieces[t].length });
        offset += pieces[t].length;
        // corte no fim da peça, a não ser que acabe exatamente no fim da barra
        if (offset < L - EPS) {
          cuts++;
          offset += s.kerf;
        }
      }
    });
    const usedLength = Math.min(offset, L);
    const remnant = Math.max(0, L - usedLength);
    return {
      index,
      stockIndex: i,
      length: L,
      pieces: list,
      usedLength: round(usedLength, 1),
      remnant: round(remnant, 1),
      reusable: s.minRemnant > 0 && remnant >= s.minRemnant,
      cuts,
    };
  };

  while (remaining.some((n) => n > 0)) {
    let best: { i: number; take: number[]; score: number; fill: number } | null = null;
    stock.forEach((st, i) => {
      if (!available(i)) return;
      // a última peça não precisa de lâmina depois: dá-se essa folga à capacidade
      const capacity = Math.floor(st.length - s.trim + s.kerf + EPS);
      if (capacity <= 0) return;
      const take = fillBar(capacity, weights, remaining);
      const fill = take.reduce((a, n, t) => a + n * pieces[t].length, 0);
      if (fill <= 0) return;
      const score = strategy === "utilization" ? fill / st.length : fill;
      if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && fill > best.fill)) {
        best = { i, take, score, fill };
      }
    });
    if (!best) break;
    const b = best as { i: number; take: number[] };
    used[b.i]++;
    b.take.forEach((n, t) => (remaining[t] -= n));
    takes.push(b.take);
    bars.push(build(b.i, b.take, bars.length));
  }

  // Passagem final: barra mais curta, se couberem as mesmas peças.
  bars.forEach((bar, k) => {
    const take = takes[k];
    const fillW = take.reduce((a, n, t) => a + n * weights[t], 0);
    const order = stock
      .map((st, i) => ({ st, i }))
      .filter(({ st }) => st.length < bar.length - EPS)
      .sort((a, b) => a.st.length - b.st.length);
    for (const { st, i } of order) {
      if (!available(i)) continue;
      if (fillW <= Math.floor(st.length - s.trim + s.kerf + EPS)) {
        used[bar.stockIndex]--;
        used[i]++;
        bars[k] = build(i, take, k);
        break;
      }
    }
  });
  return { bars, left: remaining };
}

/**
 * Barras: cada perfil é otimizado à parte (as peças de perfis diferentes
 * saem de barras diferentes) e os resultados juntam-se num só plano.
 */
export function optimizeBars(pieces: BarPieceInput[], stock: BarStockInput[], settings: BarSettings): BarResult {
  const profiles: string[] = [];
  const groups = new Map<string, number[]>();
  pieces.forEach((p, i) => {
    const key = (p.profile ?? "").trim();
    if (!groups.has(key)) {
      groups.set(key, []);
      profiles.push(key);
    }
    groups.get(key)!.push(i);
  });

  const bars: BarLayout[] = [];
  const unplaced: UnplacedPiece[] = [];
  const byProfile: NonNullable<BarResult["totals"]["byProfile"]> = [];
  for (const profile of profiles) {
    const idx = groups.get(profile)!;
    const r = optimizeBarsSingle(idx.map((i) => pieces[i]), stock, settings);
    r.bars.forEach((b) => {
      bars.push({
        ...b,
        index: bars.length,
        profile: profile || null,
        pieces: b.pieces.map((p) => ({ ...p, typeIndex: idx[p.typeIndex] })),
      });
    });
    r.unplaced.forEach((u) => unplaced.push({ ...u, typeIndex: idx[u.typeIndex] }));
    byProfile.push({
      profile: profile || "Sem perfil",
      barsCount: r.totals.barsCount,
      piecesM: r.totals.piecesM,
      barsM: r.totals.barsM,
      yieldPct: r.totals.yieldPct,
      cuts: r.totals.cuts,
      byLength: r.totals.byLength,
    });
  }

  const piecesLen = bars.reduce((a, b) => a + b.pieces.reduce((x, p) => x + p.length, 0), 0);
  const barsLen = bars.reduce((a, b) => a + b.length, 0);
  const byLength = new Map<number, number>();
  bars.forEach((b) => byLength.set(b.length, (byLength.get(b.length) ?? 0) + 1));
  const reusable = bars.filter((b) => b.reusable);
  const named = profiles.length > 1 || (profiles.length === 1 && profiles[0] !== "");
  return {
    mode: "BARRAS",
    bars,
    unplaced,
    totals: {
      piecesCount: bars.reduce((a, b) => a + b.pieces.length, 0),
      piecesM: round(piecesLen / 1000, 3),
      barsCount: bars.length,
      barsM: round(barsLen / 1000, 3),
      wasteM: round((barsLen - piecesLen) / 1000, 3),
      yieldPct: barsLen ? round((piecesLen / barsLen) * 100, 1) : 0,
      cuts: bars.reduce((a, b) => a + b.cuts, 0),
      reusableRemnants: reusable.length,
      reusableM: round(reusable.reduce((a, b) => a + b.remnant, 0) / 1000, 3),
      byLength: [...byLength.entries()].map(([length, count]) => ({ length, count })).sort((a, b) => b.length - a.length),
      ...(named ? { byProfile } : {}),
    },
  };
}

function optimizeBarsSingle(pieces: BarPieceInput[], stock: BarStockInput[], settings: BarSettings): BarResult {
  const unplaced: UnplacedPiece[] = [];
  const maxLen = Math.max(0, ...stock.map((st) => st.length - settings.trim));
  const counts = pieces.map((p, t) => {
    if (p.length > maxLen + EPS) {
      unplaced.push({ ref: p.ref, typeIndex: t, qty: p.qty, reason: "Maior que a barra mais comprida" });
      return 0;
    }
    return p.qty;
  });

  let chosen: { bars: BarLayout[]; left: number[] } | null = null;
  for (const strategy of ["utilization", "biggest"] as Strategy[]) {
    const r = runBarStrategy(pieces, counts, stock, settings, strategy);
    const leftN = (x: typeof r) => x.left.reduce((a, n) => a + n, 0);
    const total = (x: typeof r) => x.bars.reduce((a, b) => a + b.length, 0);
    const cuts = (x: typeof r) => x.bars.reduce((a, b) => a + b.cuts, 0);
    if (
      !chosen ||
      leftN(r) < leftN(chosen) ||
      (leftN(r) === leftN(chosen) &&
        (total(r) < total(chosen) - EPS ||
          (Math.abs(total(r) - total(chosen)) <= EPS &&
            (r.bars.length < chosen.bars.length || (r.bars.length === chosen.bars.length && cuts(r) < cuts(chosen))))))
    ) {
      chosen = r;
    }
  }
  const { bars, left } = chosen!;
  left.forEach((qty, t) => {
    if (qty > 0) unplaced.push({ ref: pieces[t].ref, typeIndex: t, qty, reason: "Faltam barras disponíveis" });
  });

  const piecesLen = bars.reduce((a, b) => a + b.pieces.reduce((x, p) => x + p.length, 0), 0);
  const barsLen = bars.reduce((a, b) => a + b.length, 0);
  const byLength = new Map<number, number>();
  bars.forEach((b) => byLength.set(b.length, (byLength.get(b.length) ?? 0) + 1));
  const reusable = bars.filter((b) => b.reusable);

  return {
    mode: "BARRAS",
    bars,
    unplaced,
    totals: {
      piecesCount: bars.reduce((a, b) => a + b.pieces.length, 0),
      piecesM: round(piecesLen / 1000, 3),
      barsCount: bars.length,
      barsM: round(barsLen / 1000, 3),
      wasteM: round((barsLen - piecesLen) / 1000, 3),
      yieldPct: barsLen ? round((piecesLen / barsLen) * 100, 1) : 0,
      cuts: bars.reduce((a, b) => a + b.cuts, 0),
      reusableRemnants: reusable.length,
      reusableM: round(reusable.reduce((a, b) => a + b.remnant, 0) / 1000, 3),
      byLength: [...byLength.entries()].map(([length, count]) => ({ length, count })).sort((a, b) => b.length - a.length),
    },
  };
}

function round(n: number, d: number) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
