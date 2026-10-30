import pdfParse from "pdf-parse";
import { prisma } from "../config/prisma";

// ============================================================================
// Objetivos de negócio (pedido do utilizador de 2026-10-30: "uma página para
// objetivos de negócio fechado e faturação para que todos os membros possam
// ver os nossos números e lutar juntos").
//
// Os números vêm do mapa "Totais de vendas por dia" do Goldylocks (PDF), que
// o administrador importa: um para as faturas e outro para as encomendas
// cliente. Cada linha do mapa é um documento (data, tipo e número, código e
// nome do cliente, total bruto, líquido, impostos e total). O valor que conta
// para os objetivos é o Total Líquido (sem IVA); notas de crédito contam a
// menos.
//
// Importar outra vez o mesmo período substitui os documentos desse período
// (um documento anulado no Goldylocks desaparece ao reimportar).
// ============================================================================

export type SalesKind = "FATURACAO" | "ENCOMENDAS";
export type PeriodType = "MES" | "TRIMESTRE" | "ANO";

export interface ParsedDoc {
  date: string; // AAAA-MM-DD
  docType: string;
  docNumber: string;
  clientCode: string | null;
  clientName: string;
  gross: number;
  net: number;
  tax: number;
  total: number;
}

export interface ParsedMap {
  title: string;
  documentFilter: string | null;
  from: string | null;
  to: string | null;
  docs: ParsedDoc[];
  reportedTotalNet: number | null;
}

/** Texto do PDF com as colunas separadas por tabulação (pela posição de cada bloco de texto). */
async function pdfText(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer, {
    pagerender: (page: any) =>
      page.getTextContent({ normalizeWhitespace: true }).then((tc: any) => {
        let last: number | null = null;
        let out = "";
        for (const it of tc.items) {
          const y = it.transform[5];
          if (last !== null && Math.abs(y - last) > 2) out += "\n";
          else if (last !== null) out += "\t";
          out += it.str;
          last = y;
        }
        return out;
      }),
  });
  return data.text ?? "";
}

/** "1,569.83" / "1.569,83" / "-12.50" → número. */
function money(raw: string): number {
  let s = raw.trim().replace(/\s|€/g, "");
  if (/,\d{2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function isCredit(docType: string) {
  return /cr[eé]dito|devolu/i.test(docType);
}

export function parseSalesMapText(text: string): ParsedMap {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const title = lines[0] ?? "";
  const header = text.match(/Tipo Documento:\s*([^\t\n]*)/i);
  const range = text.match(/Entre\s+(\d{4}-\d{2}-\d{2})\s+e\s+(\d{4}-\d{2}-\d{2})/i);
  const docs: ParsedDoc[] = [];
  let reportedTotalNet: number | null = null;

  for (const line of lines) {
    const cols = line.split("\t").map((c) => c.trim()).filter((c) => c.length > 0);
    if (/^TOTAIS\s*::/i.test(cols[0] ?? "")) {
      // a última linha "TOTAIS ::" é o total geral do mapa
      if (cols.length >= 5) reportedTotalNet = money(cols[2]);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cols[0] ?? "") || cols.length < 7) continue;
    // Data | Tipo Nº | Cód | Cliente | Bruto | Líquido | Impostos | Total
    const date = cols[0];
    const typeNum = cols[1].match(/^(.*?)\s+(\S+\/\S+|\S*\d\S*)$/);
    if (!typeNum) continue;
    const nums = cols.slice(-4).map(money);
    if (nums.some((n) => Number.isNaN(n))) continue;
    const middle = cols.slice(2, -4);
    let clientCode: string | null = null;
    if (middle.length >= 2 && /^\d+$/.test(middle[0])) clientCode = middle.shift()!;
    const clientName = middle.join(" ").trim() || "—";
    const sign = isCredit(typeNum[1]) && nums[1] > 0 ? -1 : 1;
    docs.push({
      date,
      docType: typeNum[1].trim(),
      docNumber: typeNum[2],
      clientCode,
      clientName,
      gross: sign * nums[0],
      net: sign * nums[1],
      tax: sign * nums[2],
      total: sign * nums[3],
    });
  }

  return {
    title,
    documentFilter: header ? header[1].trim() : null,
    from: range ? range[1] : null,
    to: range ? range[2] : null,
    docs,
    reportedTotalNet,
  };
}

// ---------------------------------------------------------------------------
// Relatório de linhas de encomendas cliente (Goldylocks "Relatório"): uma
// linha por artigo, com o texto das células partido em várias linhas. Cada
// registo começa com um bloco vazio na margem esquerda; as células são
// reconhecidas pela posição (x) das colunas do cabeçalho. Os artigos são
// somados por documento (nº da encomenda).
// ---------------------------------------------------------------------------

interface Item {
  x: number;
  y: number;
  str: string;
}

async function pdfItems(buffer: Buffer): Promise<Item[][]> {
  const pages: Item[][] = [];
  await pdfParse(buffer, {
    pagerender: (page: any) =>
      page.getTextContent({ normalizeWhitespace: true }).then((tc: any) => {
        pages.push(tc.items.map((it: any) => ({ x: it.transform[4], y: it.transform[5], str: String(it.str) })));
        return "";
      }),
  });
  return pages;
}

const LINE_COLS: { key: string; re: RegExp }[] = [
  { key: "data", re: /^Data$/i },
  { key: "doc", re: /^Document/i },
  { key: "cliente", re: /^Cliente$/i },
  { key: "total", re: /^Total$/i },
  { key: "estado", re: /^Estado$/i },
  { key: "artigo", re: /^Artigo$/i },
];

function parseOrderLinesPages(pages: Item[][]): ParsedMap {
  const byDoc = new Map<string, ParsedDoc>();
  for (const items of pages) {
    // posições das colunas a partir do cabeçalho desta página
    const headerY = items.find((i) => /^Data$/i.test(i.str.trim()))?.y;
    if (headerY == null) continue;
    const header = items.filter((i) => Math.abs(i.y - headerY) < 1 && i.str.trim());
    const xs = header.map((h) => h.x).sort((a, b) => a - b);
    const colOf = (x: number) => {
      let best = -1;
      for (const hx of xs) if (x >= hx - 2) best = hx;
      return best;
    };
    const colX: Record<string, number> = {};
    for (const c of LINE_COLS) {
      const h = header.find((i) => c.re.test(i.str.trim()));
      if (h) colX[c.key] = h.x;
    }
    if (colX.data == null || colX.doc == null || colX.total == null) continue;
    const leftMargin = Math.min(...xs) - 5;

    let rec: Map<number, string[]> | null = null;
    const flush = () => {
      if (!rec) return;
      const cell = (k: string) => (rec!.get(colX[k]) ?? []);
      const date = cell("data").join("").replace(/\s/g, "");
      const docText = cell("doc").join(" ").replace(/\s+/g, " ");
      const num = docText.match(/(\d{4}\/\d+)/);
      const totalRaw = cell("total").join("");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !num || !totalRaw) return;
      const net = money(totalRaw);
      if (Number.isNaN(net)) return;
      const docType = docText.replace(num[1], "").replace(/Encomend\s*a/i, "Encomenda").trim() || "Encomenda Cliente";
      const clientText = cell("cliente").join(" ").replace(/\s+/g, " ").trim();
      const cm = clientText.match(/^\((\w+)\)\s*(.*)$/);
      const key = `${docType}|${num[1]}`;
      const cur = byDoc.get(key);
      if (cur) {
        cur.net = round2(cur.net + net);
        cur.gross = cur.net;
        cur.total = cur.net;
      } else {
        byDoc.set(key, {
          date,
          docType,
          docNumber: num[1],
          clientCode: cm ? cm[1] : null,
          clientName: (cm ? cm[2] : clientText) || "—",
          gross: net,
          net,
          tax: 0,
          total: net,
        });
      }
    };

    for (const it of items) {
      if (it.y >= headerY - 12) continue; // cabeçalho e título
      if (it.x < leftMargin + 3 && !it.str.trim()) {
        flush();
        rec = new Map();
        continue;
      }
      if (!rec || !it.str.trim()) continue;
      const c = colOf(it.x);
      if (c < 0) continue;
      const arr = rec.get(c) ?? [];
      arr.push(it.str.trim());
      rec.set(c, arr);
    }
    flush();
  }
  const docs = [...byDoc.values()].sort((a, b) => a.date.localeCompare(b.date) || a.docNumber.localeCompare(b.docNumber, "pt", { numeric: true }));
  return { title: "Relatório de encomendas cliente", documentFilter: null, from: null, to: null, docs, reportedTotalNet: null };
}

/** Lê qualquer um dos dois mapas do Goldylocks (totais por dia, ou relatório de linhas). */
export async function parseSalesMapPdf(buffer: Buffer): Promise<ParsedMap & { detectedKind: SalesKind | null }> {
  const text = await pdfText(buffer);
  let map = parseSalesMapText(text);
  if (!map.docs.length) map = parseOrderLinesPages(await pdfItems(buffer));
  const types = map.docs.map((d) => d.docType.toLowerCase());
  const enc = types.filter((t) => t.includes("encomenda")).length;
  const fat = types.filter((t) => /fatura|cr[eé]dito/.test(t)).length;
  const detectedKind: SalesKind | null = enc > fat ? "ENCOMENDAS" : fat > 0 ? "FATURACAO" : null;
  return { ...map, detectedKind };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Grava os documentos do mapa, substituindo os que já existiam nesse período. */
export async function importSalesMap(kind: SalesKind, map: ParsedMap, filename: string | null, userId?: string) {
  if (!map.docs.length) throw new Error("Não encontrei documentos neste PDF. É o mapa \"Totais de vendas por dia\" do Goldylocks?");
  const dates = map.docs.map((d) => d.date).sort();
  const from = map.from ?? dates[0];
  const to = map.to ?? dates[dates.length - 1];
  const totalNet = round2(map.docs.reduce((a, d) => a + d.net, 0));

  return prisma.$transaction(async (tx) => {
    const imp = await tx.salesImport.create({
      data: {
        kind,
        filename,
        periodFrom: new Date(`${from}T00:00:00Z`),
        periodTo: new Date(`${to}T00:00:00Z`),
        count: map.docs.length,
        totalNet,
        userId,
      },
    });
    await tx.salesDocument.deleteMany({
      where: { kind, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
    });
    // um documento repetido (mesmo tipo e número) fica só uma vez
    const seen = new Set<string>();
    const rows = map.docs.filter((d) => {
      const k = `${d.docType}|${d.docNumber}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    await tx.salesDocument.deleteMany({
      where: { kind, OR: rows.map((d) => ({ docType: d.docType, docNumber: d.docNumber })) },
    });
    await tx.salesDocument.createMany({
      data: rows.map((d) => ({
        kind,
        docType: d.docType,
        docNumber: d.docNumber,
        date: new Date(`${d.date}T00:00:00Z`),
        clientCode: d.clientCode,
        clientName: d.clientName,
        gross: d.gross,
        net: d.net,
        tax: d.tax,
        total: d.total,
        importId: imp.id,
      })),
    });
    return { importId: imp.id, from, to, count: rows.length, totalNet, reportedTotalNet: map.reportedTotalNet };
  });
}

// ---------------------------------------------------------------------------
// Resumo para a página
// ---------------------------------------------------------------------------

function periodRange(periodType: PeriodType, year: number, period: number) {
  if (periodType === "ANO") return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year + 1, 0, 1)) };
  if (periodType === "TRIMESTRE") return { start: new Date(Date.UTC(year, (period - 1) * 3, 1)), end: new Date(Date.UTC(year, period * 3, 1)) };
  return { start: new Date(Date.UTC(year, period - 1, 1)), end: new Date(Date.UTC(year, period, 1)) };
}

function previousPeriod(periodType: PeriodType, year: number, period: number) {
  if (periodType === "ANO") return { year: year - 1, period: 1 };
  const n = periodType === "TRIMESTRE" ? 4 : 12;
  return period === 1 ? { year: year - 1, period: n } : { year, period: period - 1 };
}

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Feriados nacionais de Portugal (fixos + Sexta-feira Santa e Corpo de Deus). */
function holidays(year: number): Set<string> {
  const fixed = ["01-01", "04-25", "05-01", "06-10", "08-15", "10-05", "11-01", "12-01", "12-08", "12-25"];
  // Páscoa (algoritmo de Meeus/Jones/Butcher)
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = Date.UTC(year, month - 1, day);
  const set = new Set(fixed.map((md) => `${year}-${md}`));
  set.add(iso(new Date(easter - 2 * DAY)));
  set.add(iso(new Date(easter + 60 * DAY)));
  return set;
}

function workingDays(from: Date, to: Date): number {
  // dias úteis em [from, to)
  let n = 0;
  const hol = new Map<number, Set<string>>();
  for (let t = from.getTime(); t < to.getTime(); t += DAY) {
    const d = new Date(t);
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const y = d.getUTCFullYear();
    if (!hol.has(y)) hol.set(y, holidays(y));
    if (hol.get(y)!.has(iso(d))) continue;
    n++;
  }
  return n;
}

function lisbonToday(): Date {
  const s = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Lisbon" });
  return new Date(`${s}T00:00:00Z`);
}

async function kindSummary(kind: SalesKind, periodType: PeriodType, year: number, period: number, today: Date) {
  const { start, end } = periodRange(periodType, year, period);
  const docs = await prisma.salesDocument.findMany({
    where: { kind, date: { gte: start, lt: end } },
    orderBy: { date: "asc" },
  });
  const target = await prisma.businessTarget.findUnique({
    where: { kind_periodType_year_period: { kind, periodType, year, period } },
  });
  // sem objetivo próprio de trimestre/ano: soma dos objetivos dos meses
  let targetValue = target?.value ?? null;
  if (targetValue == null && periodType !== "MES") {
    const months = periodType === "ANO" ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [1, 2, 3].map((m) => (period - 1) * 3 + m);
    const rows = await prisma.businessTarget.findMany({ where: { kind, periodType: "MES", year, period: { in: months } } });
    if (rows.length) targetValue = rows.reduce((a, r) => a + r.value, 0);
  }

  const total = round2(docs.reduce((a, d) => a + d.net, 0));
  const count = docs.filter((d) => d.net >= 0).length;
  const clients = new Set(docs.map((d) => d.clientCode ?? d.clientName)).size;

  // acumulado por dia (para o gráfico)
  const byDay = new Map<string, number>();
  for (const d of docs) byDay.set(iso(d.date), (byDay.get(iso(d.date)) ?? 0) + d.net);
  const lastDay = new Date(Math.min(end.getTime(), today.getTime() + DAY));
  const series: { date: string; cumulative: number }[] = [];
  let acc = 0;
  for (let t = start.getTime(); t < end.getTime(); t += DAY) {
    const key = iso(new Date(t));
    acc += byDay.get(key) ?? 0;
    if (t < lastDay.getTime()) series.push({ date: key, cumulative: round2(acc) });
  }

  // ritmo: % de dias úteis já passados no período
  const totalWd = workingDays(start, end);
  const elapsedEnd = new Date(Math.min(Math.max(today.getTime() + DAY, start.getTime()), end.getTime()));
  const elapsedWd = workingDays(start, elapsedEnd);
  const remainingWd = Math.max(0, totalWd - elapsedWd);
  const paceShare = totalWd ? elapsedWd / totalWd : 1;

  // período anterior até ao mesmo ponto (mesmo nº de dias desde o início)
  const prev = previousPeriod(periodType, year, period);
  const pr = periodRange(periodType, prev.year, prev.period);
  const daysIn = Math.round((elapsedEnd.getTime() - start.getTime()) / DAY);
  const prevCut = new Date(Math.min(pr.start.getTime() + daysIn * DAY, pr.end.getTime()));
  const prevAgg = await prisma.salesDocument.aggregate({
    where: { kind, date: { gte: pr.start, lt: prevCut } },
    _sum: { net: true },
  });
  const prevFull = await prisma.salesDocument.aggregate({ where: { kind, date: { gte: pr.start, lt: pr.end } }, _sum: { net: true } });

  // maiores clientes do período
  const byClient = new Map<string, { name: string; value: number; count: number }>();
  for (const d of docs) {
    const k = d.clientCode ?? d.clientName;
    const c = byClient.get(k) ?? { name: d.clientName, value: 0, count: 0 };
    c.value += d.net;
    c.count += d.net >= 0 ? 1 : 0;
    byClient.set(k, c);
  }
  const topClients = [...byClient.values()]
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)
    .map((c) => ({ ...c, value: round2(c.value) }));
  const topDocs = [...docs]
    .sort((a, b) => b.net - a.net)
    .slice(0, 6)
    .map((d) => ({ date: iso(d.date), docType: d.docType, docNumber: d.docNumber, clientName: d.clientName, net: d.net }));

  const lastImport = await prisma.salesImport.findFirst({ where: { kind }, orderBy: { createdAt: "desc" } });
  let lastImportBy: string | null = null;
  if (lastImport?.userId) {
    lastImportBy = (await prisma.user.findUnique({ where: { id: lastImport.userId }, select: { name: true } }))?.name ?? null;
  }

  return {
    kind,
    total,
    count,
    clients,
    average: count ? round2(total / count) : 0,
    target: targetValue,
    expectedByNow: targetValue != null ? round2(targetValue * paceShare) : null,
    previousSamePoint: round2(prevAgg._sum.net ?? 0),
    previousTotal: round2(prevFull._sum.net ?? 0),
    series,
    topClients,
    topDocs,
    lastImport: lastImport
      ? { at: lastImport.createdAt.toISOString(), by: lastImportBy, from: iso(lastImport.periodFrom), to: iso(lastImport.periodTo) }
      : null,
    workingDays: { total: totalWd, elapsed: elapsedWd, remaining: remainingWd },
  };
}

export async function getSummary(periodType: PeriodType, year: number, period: number) {
  const today = lisbonToday();
  const { start, end } = periodRange(periodType, year, period);
  const [faturacao, encomendas] = await Promise.all([
    kindSummary("FATURACAO", periodType, year, period, today),
    kindSummary("ENCOMENDAS", periodType, year, period, today),
  ]);
  return { periodType, year, period, start: iso(start), end: iso(new Date(end.getTime() - DAY)), today: iso(today), faturacao, encomendas };
}

export async function listTargets(year: number) {
  return prisma.businessTarget.findMany({ where: { year }, orderBy: [{ kind: "asc" }, { periodType: "asc" }, { period: "asc" }] });
}

export async function setTarget(kind: SalesKind, periodType: PeriodType, year: number, period: number, value: number | null) {
  const where = { kind_periodType_year_period: { kind, periodType, year, period } };
  if (value == null) {
    await prisma.businessTarget.deleteMany({ where: { kind, periodType, year, period } });
    return null;
  }
  return prisma.businessTarget.upsert({ where, update: { value }, create: { kind, periodType, year, period, value } });
}
