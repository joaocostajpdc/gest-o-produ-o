import { prisma } from "../config/prisma";

// ============================================================================
// Relatório de produção (pedido do utilizador de 2026-10-26: "para melhorar a
// gestão quero ter acesso a um relatório da produção e a tudo o que se
// passa"). Página no programa + PDF semanal e mensal, e "quando eu quiser
// tirar" (qualquer período).
//
// Junta, para um período (datas de Portugal, inclusivas):
// - números da produção (OS entradas, concluídas, em curso, atrasadas,
//   prazos cumpridos, tempos);
// - etapas (tempo médio em cada uma e onde está o trabalho parado agora);
// - paragens (interrupções por motivo e tempo perdido);
// - por pessoa (o que cada utilizador fez no programa e horas dos
//   colaboradores);
// - registo de atividade (tudo o que ficou no histórico das OS);
// - outras áreas (material pedido/recebido, pó, vidros, orçamentos).
// ============================================================================

const TZ = "Europe/Lisbon";

export const INTERRUPTION_PT: Record<string, string> = {
  FALTA_MATERIA_PRIMA: "Falta de matéria-prima",
  AVARIA_EQUIPAMENTO: "Avaria de equipamento",
  FALTA_CAPACIDADE: "Falta de capacidade",
  AGUARDAR_INFORMACAO: "A aguardar informação",
  AGUARDAR_APROVACAO: "A aguardar aprovação",
  AGUARDAR_FORNECEDOR: "A aguardar fornecedor",
  PROBLEMA_QUALIDADE: "Problema de qualidade",
  OUTRO: "Outro",
};

export const EVENT_PT: Record<string, string> = {
  CRIACAO: "OS criada",
  ALTERACAO_ESTADO: "Mudança de estado",
  ENTRADA_ETAPA: "Entrada em etapa",
  SAIDA_ETAPA: "Saída de etapa",
  INICIO_INTERRUPCAO: "Paragem",
  FIM_INTERRUPCAO: "Fim de paragem",
  ALTERACAO_LINHA_PRODUCAO: "Linha de produção alterada",
  INSERCAO_ETAPA: "Etapa acrescentada",
  OMISSAO_ETAPA: "Etapa omitida",
  ENCAMINHAMENTO_FORNECEDOR: "Enviada a fornecedor",
  ENVIO_TRABALHO_EXTERNO: "Enviada para trabalho externo",
  RETORNO_TRABALHO_EXTERNO: "Voltou de trabalho externo",
  OBSERVACAO_REGISTADA: "Observação",
  OUTRA_ALTERACAO: "Outra alteração",
};

const STATUS_PT: Record<string, string> = {
  NAO_INICIADA: "Não iniciada",
  EM_PRODUCAO: "Em produção",
  SUSPENSA: "Suspensa",
  CONCLUIDA: "Concluída",
  CANCELADA: "Cancelada",
};

// ---------------------------------------------------------------------------
// Datas de Portugal
// ---------------------------------------------------------------------------
function lisbonParts(d: Date) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday")) + 1;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), minute: Number(get("minute")), weekday: wd };
}
export const lisbonDate = (d: Date) => lisbonParts(d).date;
export function addDaysIso(iso: string, n: number) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Instante UTC da meia-noite de Portugal desse dia. */
function lisbonMidnight(iso: string) {
  const noon = new Date(`${iso}T12:00:00Z`);
  const offsetH = lisbonParts(noon).hour - 12; // 0 no inverno, 1 no verão
  return new Date(Date.parse(`${iso}T00:00:00Z`) - offsetH * 3600_000);
}
export const fmtPT = (iso: string) => iso.split("-").reverse().join("/");
const fmtDateTime = (d: Date) => {
  const p = lisbonParts(d);
  return `${fmtPT(p.date).slice(0, 5)} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

/** Semana anterior (segunda a domingo) e mês anterior, em relação a `now`. */
export function previousWeek(now = new Date()) {
  const { date, weekday } = lisbonParts(now);
  const monday = addDaysIso(date, -(weekday - 1) - 7);
  return { from: monday, to: addDaysIso(monday, 6) };
}
export function currentWeekRange(now = new Date()) {
  const { date, weekday } = lisbonParts(now);
  const monday = addDaysIso(date, -(weekday - 1));
  return { from: monday, to: addDaysIso(monday, 6) };
}
export function previousMonth(now = new Date()) {
  const { date } = lisbonParts(now);
  const [y, m] = date.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  return { from: first, to: last };
}
export function currentMonthRange(now = new Date()) {
  const { date } = lisbonParts(now);
  const [y, m] = date.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from: first, to: last };
}
export function periodLabel(from: string, to: string) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const lastOfMonth = new Date(Date.UTC(fy, fm, 0)).toISOString().slice(0, 10);
  if (fd === 1 && to === lastOfMonth) {
    const s = new Date(Date.UTC(fy, fm - 1, 1)).toLocaleDateString("pt-PT", { month: "long", year: "numeric", timeZone: "UTC" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  if (from === to) return fmtPT(from);
  return `${fmtPT(from)} a ${fmtPT(to)}`;
}

// ---------------------------------------------------------------------------
// Horas dos colaboradores (mesma regra da página Controlo de Horas)
// ---------------------------------------------------------------------------
function minutesOf(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function workedHours(e: { tipo: string; startTime: string | null; endTime: string | null; breakMinutes: number }) {
  if (e.tipo !== "TRABALHO" || !e.startTime || !e.endTime) return 0;
  let diff = minutesOf(e.endTime) - minutesOf(e.startTime);
  if (diff < 0) diff += 24 * 60;
  return Math.max(0, diff - e.breakMinutes) / 60;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const hoursBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3600_000;

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------
export async function buildProductionReport(from: string, to: string, now = new Date()) {
  const start = lisbonMidnight(from);
  const end = lisbonMidnight(addDaysIso(to, 1)); // exclusivo
  const inRange = { gte: start, lt: end };
  const today = lisbonDate(now);

  const [entradas, concluidas, abertas, saidasEtapa, interrupcoes, eventos, timeEntries, colaboradores, materiais, po, vidros, orcamentos] =
    await Promise.all([
      prisma.serviceOrder.findMany({ where: { createdAt: inRange }, include: { client: true, product: true } }),
      prisma.serviceOrder.findMany({ where: { status: "CONCLUIDA", completedAt: inRange }, include: { client: true, product: true } }),
      prisma.serviceOrder.findMany({
        where: { status: { in: ["NAO_INICIADA", "EM_PRODUCAO", "SUSPENSA"] } },
        include: { client: true, product: true, currentStageInstance: { include: { stage: true, supplier: true } } },
      }),
      prisma.serviceOrderStageInstance.findMany({
        where: { exitedAt: inRange, enteredAt: { not: null }, status: "CONCLUIDA" },
        include: { stage: true },
      }),
      prisma.interruption.findMany({
        where: { startedAt: { lt: end }, OR: [{ endedAt: null }, { endedAt: { gte: start } }] },
        include: { serviceOrder: { include: { client: true } }, user: { select: { id: true, name: true } } },
        orderBy: { startedAt: "desc" },
      }),
      prisma.historyEvent.findMany({
        where: { createdAt: inRange },
        include: { user: { select: { id: true, name: true } }, serviceOrder: { select: { id: true, externalId: true, client: { select: { name: true } } } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.timeEntry.findMany({ where: { date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } } }),
      prisma.colaborador.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      Promise.all([
        prisma.materialRequest.count({ where: { createdAt: inRange } }),
        prisma.materialRequest.count({ where: { receivedAt: inRange } }),
        prisma.materialRequest.count({ where: { status: "A_PEDIR" } }),
      ]),
      prisma.powderMovement.findMany({ where: { createdAt: inRange }, select: { type: true, quantityKg: true } }),
      Promise.all([
        prisma.glassOrder.count({ where: { createdAt: inRange } }),
        prisma.glassOrder.count({ where: { status: "POR_ENCOMENDAR" } }),
      ]),
      prisma.orcamento.findMany({ where: { createdAt: inRange }, select: { data: true } }),
    ]);

  // ---- Números -----------------------------------------------------------
  const comPrazo = concluidas.filter((o) => o.deadlineAt);
  const noPrazo = comPrazo.filter((o) => o.completedAt! <= o.deadlineAt!);
  const leadDays = concluidas.map((o) => hoursBetween(o.createdAt, o.completedAt!) / 24);
  const prodHours = concluidas.map((o) => o.productionMinutes / 60).filter((h) => h > 0);
  const avg = (l: number[]) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : null);
  const atrasadas = abertas.filter((o) => o.deadlineAt && lisbonDate(o.deadlineAt) < today);

  const numeros = {
    entradas: entradas.length,
    concluidas: concluidas.length,
    emCurso: abertas.length,
    porEstado: {
      NAO_INICIADA: abertas.filter((o) => o.status === "NAO_INICIADA").length,
      EM_PRODUCAO: abertas.filter((o) => o.status === "EM_PRODUCAO").length,
      SUSPENSA: abertas.filter((o) => o.status === "SUSPENSA").length,
    },
    atrasadas: atrasadas.length,
    prazoCumprido: comPrazo.length ? Math.round((noPrazo.length / comPrazo.length) * 100) : null,
    concluidasComPrazo: comPrazo.length,
    concluidasNoPrazo: noPrazo.length,
    diasMedios: avg(leadDays) !== null ? round1(avg(leadDays)!) : null,
    horasProducaoMedias: avg(prodHours) !== null ? round1(avg(prodHours)!) : null,
  };

  // Entradas e saídas por dia (para o gráfico).
  const porDia: { dia: string; entradas: number; concluidas: number }[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) porDia.push({ dia: d, entradas: 0, concluidas: 0 });
  for (const o of entradas) {
    const r = porDia.find((x) => x.dia === lisbonDate(o.createdAt));
    if (r) r.entradas++;
  }
  for (const o of concluidas) {
    const r = porDia.find((x) => x.dia === lisbonDate(o.completedAt!));
    if (r) r.concluidas++;
  }

  // Por produto.
  const prodMap = new Map<string, { produto: string; entradas: number; concluidas: number }>();
  const prodRow = (name: string) => prodMap.get(name) ?? { produto: name, entradas: 0, concluidas: 0 };
  for (const o of entradas) {
    const r = prodRow(o.product.name);
    r.entradas++;
    prodMap.set(o.product.name, r);
  }
  for (const o of concluidas) {
    const r = prodRow(o.product.name);
    r.concluidas++;
    prodMap.set(o.product.name, r);
  }
  const porProduto = [...prodMap.values()].sort((a, b) => b.entradas + b.concluidas - (a.entradas + a.concluidas));

  // ---- Etapas ------------------------------------------------------------
  const stageMap = new Map<string, { etapa: string; passagens: number; horas: number[]; agora: number; maisAntigaDias: number | null }>();
  const stageRow = (name: string) => stageMap.get(name) ?? { etapa: name, passagens: 0, horas: [], agora: 0, maisAntigaDias: null };
  for (const s of saidasEtapa) {
    const r = stageRow(s.stage.name);
    r.passagens++;
    r.horas.push(hoursBetween(s.enteredAt!, s.exitedAt!));
    stageMap.set(s.stage.name, r);
  }
  for (const o of abertas) {
    const csi = o.currentStageInstance;
    if (!csi) continue;
    const r = stageRow(csi.stage.name);
    r.agora++;
    if (csi.enteredAt) {
      const dias = round1(hoursBetween(csi.enteredAt, now) / 24);
      r.maisAntigaDias = Math.max(r.maisAntigaDias ?? 0, dias);
    }
    stageMap.set(csi.stage.name, r);
  }
  const etapas = [...stageMap.values()]
    .map((r) => {
      const h = avg(r.horas);
      return { etapa: r.etapa, passagens: r.passagens, horasMedias: h === null ? null : round1(h), agora: r.agora, maisAntigaDias: r.maisAntigaDias };
    })
    .sort((a, b) => b.agora - a.agora || b.passagens - a.passagens);

  // Onde está o trabalho parado há mais tempo (OS abertas, por tempo na etapa atual).
  const paradas = abertas
    .filter((o) => o.currentStageInstance?.enteredAt)
    .map((o) => ({
      id: o.id,
      os: o.externalId,
      cliente: o.client.name,
      produto: o.product.name,
      etapa: o.currentStageInstance!.stage.name + (o.currentStageInstance!.supplier ? ` (${o.currentStageInstance!.supplier.name})` : ""),
      estado: STATUS_PT[o.status] ?? o.status,
      dias: round1(hoursBetween(o.currentStageInstance!.enteredAt!, now) / 24),
      prazo: o.deadlineAt ? lisbonDate(o.deadlineAt) : null,
    }))
    .sort((a, b) => b.dias - a.dias)
    .slice(0, 15);

  const atrasadasLista = atrasadas
    .map((o) => ({
      id: o.id,
      os: o.externalId,
      cliente: o.client.name,
      produto: o.product.name,
      etapa: o.currentStageInstance?.stage.name ?? "—",
      estado: STATUS_PT[o.status] ?? o.status,
      prazo: lisbonDate(o.deadlineAt!),
      diasAtraso: Math.round(hoursBetween(o.deadlineAt!, now) / 24),
    }))
    .sort((a, b) => b.diasAtraso - a.diasAtraso);

  const concluidasLista = concluidas
    .map((o) => ({
      id: o.id,
      os: o.externalId,
      cliente: o.client.name,
      produto: o.product.name,
      entrada: lisbonDate(o.createdAt),
      concluida: lisbonDate(o.completedAt!),
      dias: round1(hoursBetween(o.createdAt, o.completedAt!) / 24),
      noPrazo: o.deadlineAt ? o.completedAt! <= o.deadlineAt : null,
    }))
    .sort((a, b) => b.concluida.localeCompare(a.concluida));

  // ---- Paragens ----------------------------------------------------------
  const minutosNoPeriodo = (i: (typeof interrupcoes)[number]) => {
    const a = Math.max(i.startedAt.getTime(), start.getTime());
    const b = Math.min((i.endedAt ?? now).getTime(), end.getTime(), now.getTime());
    return Math.max(0, (b - a) / 60000);
  };
  const motivoMap = new Map<string, { motivo: string; n: number; horas: number }>();
  for (const i of interrupcoes) {
    const k = INTERRUPTION_PT[i.reason] ?? i.reason;
    const r = motivoMap.get(k) ?? { motivo: k, n: 0, horas: 0 };
    r.n++;
    r.horas += minutosNoPeriodo(i) / 60;
    motivoMap.set(k, r);
  }
  const paragens = {
    total: interrupcoes.length,
    abertas: interrupcoes.filter((i) => !i.endedAt).length,
    horas: round1(interrupcoes.reduce((s, i) => s + minutosNoPeriodo(i), 0) / 60),
    porMotivo: [...motivoMap.values()].map((r) => ({ ...r, horas: round1(r.horas) })).sort((a, b) => b.horas - a.horas),
    lista: interrupcoes.slice(0, 60).map((i) => ({
      id: i.id,
      osId: i.serviceOrderId,
      os: i.serviceOrder.externalId,
      cliente: i.serviceOrder.client.name,
      motivo: (INTERRUPTION_PT[i.reason] ?? i.reason) + (i.otherDescription ? ` — ${i.otherDescription}` : ""),
      inicio: fmtDateTime(i.startedAt),
      fim: i.endedAt ? fmtDateTime(i.endedAt) : null,
      horas: round1(((i.endedAt ?? now).getTime() - i.startedAt.getTime()) / 3600_000),
      quem: i.user?.name ?? "—",
    })),
  };

  // ---- Por pessoa (utilizadores do programa) ------------------------------
  const userMap = new Map<string, { nome: string; total: number; etapasConcluidas: number; entradasEtapa: number; observacoes: number; paragens: number; criadas: number; outras: number }>();
  for (const e of eventos) {
    const nome = e.user?.name ?? "Sistema / importação";
    const r = userMap.get(nome) ?? { nome, total: 0, etapasConcluidas: 0, entradasEtapa: 0, observacoes: 0, paragens: 0, criadas: 0, outras: 0 };
    r.total++;
    if (e.type === "SAIDA_ETAPA") r.etapasConcluidas++;
    else if (e.type === "ENTRADA_ETAPA") r.entradasEtapa++;
    else if (e.type === "OBSERVACAO_REGISTADA") r.observacoes++;
    else if (e.type === "INICIO_INTERRUPCAO") r.paragens++;
    else if (e.type === "CRIACAO") r.criadas++;
    else r.outras++;
    userMap.set(nome, r);
  }
  const porUtilizador = [...userMap.values()].sort((a, b) => b.total - a.total);

  // ---- Horas dos colaboradores ---------------------------------------------
  const horasMap = new Map<string, { nome: string; dias: number; horas: number; extra: number; faltas: number; ferias: number; baixa: number }>();
  for (const c of colaboradores) horasMap.set(c.id, { nome: c.name, dias: 0, horas: 0, extra: 0, faltas: 0, ferias: 0, baixa: 0 });
  const daily = new Map<string, number>(colaboradores.map((c) => [c.id, Number(c.dailyHours)] as [string, number]));
  for (const t of timeEntries) {
    const r = horasMap.get(t.colaboradorId);
    if (!r) continue;
    if (t.tipo === "TRABALHO") {
      const h = workedHours(t);
      r.dias++;
      r.horas += h;
      r.extra += Math.max(0, h - (daily.get(t.colaboradorId) ?? 8));
    } else if (t.tipo === "FALTA") r.faltas++;
    else if (t.tipo === "FERIAS") r.ferias++;
    else if (t.tipo === "BAIXA") r.baixa++;
  }
  const horas = [...horasMap.values()]
    .map((r) => ({ ...r, horas: round1(r.horas), extra: round1(r.extra) }))
    .filter((r) => r.dias || r.faltas || r.ferias || r.baixa);

  // ---- Atividade (tudo o que ficou registado) -------------------------------
  const atividade = eventos.slice(0, 400).map((e) => ({
    id: e.id,
    quando: e.createdAt.toISOString(),
    hora: fmtDateTime(e.createdAt),
    tipo: e.type,
    tipoLabel: EVENT_PT[e.type] ?? e.type,
    descricao: e.description,
    quem: e.user?.name ?? "Sistema",
    osId: e.serviceOrder.id,
    os: e.serviceOrder.externalId,
    cliente: e.serviceOrder.client.name,
  }));
  const tipoCount: Record<string, number> = {};
  for (const e of eventos) {
    const k = EVENT_PT[e.type] ?? String(e.type);
    tipoCount[k] = (tipoCount[k] ?? 0) + 1;
  }
  const atividadePorTipo = Object.entries(tipoCount)
    .map(([tipo, n]) => ({ tipo, n }))
    .sort((a, b) => b.n - a.n);

  // ---- Outras áreas -------------------------------------------------------
  const kg = (t: string) => {
    let total = 0;
    for (const m of po) if (m.type === t) total += Number(m.quantityKg);
    return round1(total);
  };
  const orcEstados: Record<string, number> = {};
  for (const o of orcamentos) {
    const e = String((o.data as { estado?: string } | null)?.estado ?? "Em orçamento");
    orcEstados[e] = (orcEstados[e] ?? 0) + 1;
  }
  const outras = {
    materialPedido: materiais[0],
    materialRecebido: materiais[1],
    materialPorPedir: materiais[2],
    poEntradaKg: kg("ENTRADA"),
    poSaidaKg: kg("SAIDA"),
    vidrosRegistados: vidros[0],
    vidrosPorEncomendar: vidros[1],
    orcamentosCriados: orcamentos.length,
    orcamentosPorEstado: orcEstados,
  };

  return {
    from,
    to,
    label: periodLabel(from, to),
    geradoEm: now.toISOString(),
    numeros,
    porDia,
    porProduto,
    etapas,
    paradas,
    atrasadas: atrasadasLista,
    concluidas: concluidasLista,
    paragens,
    porUtilizador,
    horas,
    atividade,
    atividadeTotal: eventos.length,
    atividadePorTipo,
    outras,
  };
}

export type ProductionReport = Awaited<ReturnType<typeof buildProductionReport>>;
