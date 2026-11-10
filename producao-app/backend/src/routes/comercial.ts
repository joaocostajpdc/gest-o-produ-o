import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { requireFeature } from "../config/featureReleases";
import { asyncHandler } from "../utils/asyncHandler";

// ============================================================================
// Comercial (pedido do utilizador de 2026-11-10: "e se passamos a parte
// comercial para a Central?" → "lança isso no teste"). Carteira de clientes,
// visitas e voltas, prospeção e um painel comercial, ligados ao que a Central
// já tem: OS, vendas (faturas/encomendas importadas para os Objetivos) e
// orçamentos. Acesso restrito ("comercial"): administrador e quem ele
// escolher.
// ============================================================================

export const comercialRouter = Router();
comercialRouter.use(requireAuth);
comercialRouter.use(requireFeature("comercial"));

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");
const toDate = (v: string) => new Date(`${v}T00:00:00Z`);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const norm = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(lda|unipessoal|sa|limitada)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// ---------------------------------------------------------------------------
// Vendas por cliente (faturas e encomendas importadas para os Objetivos).
// ---------------------------------------------------------------------------
async function salesByClient() {
  const year = new Date().getUTCFullYear();
  const rows = await prisma.$queryRaw<
    { code: string | null; name: string | null; kind: string; total: number; n: bigint; last: Date | null; ytd: number }[]
  >`select "clientCode" as code, max("clientName") as name, kind,
            coalesce(sum(net),0)::float as total, count(*) as n, max(date) as last,
            coalesce(sum(case when extract(year from date) = ${year} then net else 0 end),0)::float as ytd
     from sales_documents group by "clientCode", kind`;
  const map = new Map<string, { faturado: number; encomendado: number; faturas: number; encomendas: number; ultimaCompra: string | null; nome: string | null }>();
  for (const r of rows) {
    const key = r.code ?? "";
    const cur = map.get(key) ?? { faturado: 0, encomendado: 0, faturas: 0, encomendas: 0, ultimaCompra: null, nome: r.name };
    if (r.kind === "FATURACAO") {
      cur.faturado += r.ytd;
      cur.faturas += Number(r.n);
    } else {
      cur.encomendado += r.ytd;
      cur.encomendas += Number(r.n);
    }
    const last = day(r.last);
    if (last && (!cur.ultimaCompra || last > cur.ultimaCompra)) cur.ultimaCompra = last;
    map.set(key, cur);
  }
  return map;
}

const clienteSchema = z.object({
  numero: z.string().trim().max(20).nullable().optional(),
  nif: z.string().trim().max(20).nullable().optional(),
  nome: z.string().trim().min(1, "Indica o nome.").max(200),
  zona: z.string().trim().max(80).nullable().optional(),
  volta: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().max(160).nullable().optional(),
  telefone: z.string().trim().max(60).nullable().optional(),
  estado: z.enum(["ativo", "prospecao", "inativo"]).default("ativo"),
  comercial: z.string().trim().max(60).nullable().optional(),
  plafond: z.coerce.number().min(0).max(10_000_000).nullable().optional(),
  morada: z.string().trim().max(240).nullable().optional(),
  codPostal: z.string().trim().max(20).nullable().optional(),
  localidade: z.string().trim().max(80).nullable().optional(),
  notas: z.string().trim().max(4000).nullable().optional(),
});

function presentCliente(c: { plafond: unknown } & Record<string, unknown>) {
  return { ...c, plafond: c.plafond == null ? null : Number(c.plafond) };
}

// Lista da carteira com o resumo de cada cliente (última visita, vendas, OS).
comercialRouter.get(
  "/clientes",
  asyncHandler(async (_req, res) => {
    const [clientes, sales, lastVisits, nextVisits, centralClients] = await Promise.all([
      prisma.comercialCliente.findMany({ orderBy: { nome: "asc" } }),
      salesByClient(),
      prisma.comercialVisita.groupBy({ by: ["clienteId"], where: { estado: "realizada", clienteId: { not: null } }, _max: { data: true } }),
      prisma.comercialVisita.groupBy({ by: ["clienteId"], where: { estado: "planeada", clienteId: { not: null } }, _min: { data: true } }),
      prisma.client.findMany({ select: { id: true, externalId: true, _count: { select: { serviceOrders: { where: { status: { in: ["NAO_INICIADA", "EM_PRODUCAO", "SUSPENSA"] } } } } } } }),
    ]);
    const last = new Map(lastVisits.map((v) => [v.clienteId, day(v._max.data)]));
    const next = new Map(nextVisits.map((v) => [v.clienteId, day(v._min.data)]));
    const osAtivas = new Map(centralClients.map((c) => [c.externalId, c._count.serviceOrders]));
    res.json(
      clientes.map((c) => {
        const s = c.numero ? sales.get(c.numero) : undefined;
        return {
          ...presentCliente(c),
          ultimaVisita: last.get(c.id) ?? null,
          proximaVisita: next.get(c.id) ?? null,
          faturadoAno: s?.faturado ?? 0,
          encomendadoAno: s?.encomendado ?? 0,
          ultimaCompra: s?.ultimaCompra ?? null,
          osAtivas: c.numero ? osAtivas.get(c.numero) ?? 0 : 0,
        };
      })
    );
  })
);

// Ficha de um cliente: dados, visitas, OS, vendas e orçamentos.
comercialRouter.get(
  "/clientes/:id",
  asyncHandler(async (req, res) => {
    const c = await prisma.comercialCliente.findUnique({
      where: { id: req.params.id },
      include: { visitas: { orderBy: { data: "desc" } } },
    });
    if (!c) return res.status(404).json({ error: "Cliente não encontrado." });

    const central = c.numero ? await prisma.client.findUnique({ where: { externalId: c.numero } }) : null;
    const os = central
      ? await prisma.serviceOrder.findMany({
          where: { clientId: central.id },
          orderBy: { createdAt: "desc" },
          take: 30,
          include: { product: { select: { name: true } }, currentStageInstance: { include: { stage: { select: { name: true } } } } },
        })
      : [];
    const vendas = c.numero
      ? await prisma.$queryRaw<{ id: string; kind: string; docType: string; docNumber: string; date: Date; net: number }[]>`
          select id, kind, "docType", "docNumber", date, net from sales_documents where "clientCode" = ${c.numero} order by date desc limit 40`
      : [];
    // Orçamentos da Central com o mesmo nome (ou NIF) de cliente.
    const orcRows = await prisma.$queryRaw<{ id: string; data: Record<string, unknown> }[]>`select id, data from orcamentos`;
    const nn = norm(c.nome);
    const orcamentos = orcRows
      .filter((o) => {
        const cl = ((o.data as { cliente?: { nome?: string; nif?: string } } | null)?.cliente ?? {}) as { nome?: string; nif?: string };
        return (c.nif && cl.nif && cl.nif.replace(/\D/g, "") === c.nif.replace(/\D/g, "")) || (nn && norm(cl.nome) === nn);
      })
      .map((o) => {
        const d = o.data as { num?: string; data?: string; tipo?: string; estado?: string; totais?: { total?: number }; obra?: string };
        return { id: o.id, num: d.num ?? "", data: d.data ?? null, tipo: d.tipo ?? "", estado: d.estado ?? "", total: d.totais?.total ?? null, obra: d.obra ?? "" };
      })
      .sort((a, b) => String(b.data ?? "").localeCompare(String(a.data ?? "")));

    res.json({
      ...presentCliente(c),
      visitas: c.visitas.map((v) => ({ ...v, data: day(v.data), proxima: day(v.proxima) })),
      os: os.map((o) => ({
        id: o.id,
        externalId: o.externalId,
        status: o.status,
        produto: o.product.name,
        etapa: o.currentStageInstance?.stage.name ?? null,
        deadlineAt: o.deadlineAt,
        createdAt: o.createdAt,
      })),
      vendas: vendas.map((v) => ({ ...v, date: day(v.date) })),
      orcamentos,
    });
  })
);

comercialRouter.post(
  "/clientes",
  asyncHandler(async (req, res) => {
    const d = clienteSchema.parse(req.body);
    const c = await prisma.comercialCliente.create({ data: { ...d, plafond: d.plafond ?? null } });
    res.status(201).json(presentCliente(c));
  })
);

comercialRouter.put(
  "/clientes/:id",
  asyncHandler(async (req, res) => {
    const d = clienteSchema.partial().parse(req.body);
    const c = await prisma.comercialCliente.update({ where: { id: req.params.id }, data: d });
    res.json(presentCliente(c));
  })
);

// ---------------------------------------------------------------------------
// Visitas
// ---------------------------------------------------------------------------
const visitaSchema = z.object({
  clienteId: z.string().min(1).nullable().optional(),
  leadId: z.string().min(1).nullable().optional(),
  data: dateOnly,
  objetivo: z.string().trim().max(500).nullable().optional(),
  estado: z.enum(["planeada", "realizada", "cancelada"]).default("planeada"),
  notas: z.string().trim().max(4000).nullable().optional(),
  resultado: z.string().trim().max(1000).nullable().optional(),
  proxima: dateOnly.nullable().optional(),
});
function visitaData(d: Partial<z.infer<typeof visitaSchema>>) {
  const out: Record<string, unknown> = { ...d };
  if (d.data) out.data = toDate(d.data);
  if (d.proxima !== undefined) out.proxima = d.proxima ? toDate(d.proxima) : null;
  return out;
}

comercialRouter.get(
  "/visitas",
  asyncHandler(async (req, res) => {
    const de = typeof req.query.de === "string" ? req.query.de : null;
    const ate = typeof req.query.ate === "string" ? req.query.ate : null;
    const rows = await prisma.comercialVisita.findMany({
      where: {
        ...(de || ate ? { data: { ...(de ? { gte: toDate(de) } : {}), ...(ate ? { lte: toDate(ate) } : {}) } } : {}),
      },
      orderBy: { data: "desc" },
      take: 500,
      include: {
        cliente: { select: { id: true, nome: true, zona: true, volta: true, comercial: true } },
        lead: { select: { id: true, nome: true, distrito: true } },
      },
    });
    res.json(rows.map((v) => ({ ...v, data: day(v.data), proxima: day(v.proxima) })));
  })
);

comercialRouter.post(
  "/visitas",
  asyncHandler(async (req, res) => {
    const d = visitaSchema.parse(req.body);
    if (!d.clienteId && !d.leadId) return res.status(400).json({ error: "Escolhe o cliente ou a empresa." });
    const v = await prisma.comercialVisita.create({ data: { ...(visitaData(d) as Record<string, unknown>), userId: req.user?.id } as never });
    // Visita realizada com "próxima visita": fica já marcada.
    if (d.estado === "realizada" && d.proxima) {
      await prisma.comercialVisita.create({
        data: { clienteId: d.clienteId ?? null, leadId: d.leadId ?? null, data: toDate(d.proxima), estado: "planeada", objetivo: "Seguimento da visita de " + d.data.split("-").reverse().join("/"), userId: req.user?.id },
      });
    }
    res.status(201).json({ ...v, data: day(v.data), proxima: day(v.proxima) });
  })
);

comercialRouter.put(
  "/visitas/:id",
  asyncHandler(async (req, res) => {
    const d = visitaSchema.partial().parse(req.body);
    const v = await prisma.comercialVisita.update({ where: { id: req.params.id }, data: visitaData(d) as never });
    res.json({ ...v, data: day(v.data), proxima: day(v.proxima) });
  })
);

comercialRouter.delete(
  "/visitas/:id",
  asyncHandler(async (req, res) => {
    await prisma.comercialVisita.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);

// ---------------------------------------------------------------------------
// Prospeção
// ---------------------------------------------------------------------------
const leadSchema = z.object({
  mercado: z.enum(["PT", "ES"]).default("PT"),
  nif: z.string().trim().max(20).nullable().optional(),
  nome: z.string().trim().min(1).max(200),
  distrito: z.string().trim().max(80).nullable().optional(),
  email: z.string().trim().max(160).nullable().optional(),
  telefone: z.string().trim().max(60).nullable().optional(),
  estado: z.enum(["prospecao", "conversas", "cliente", "concorrente", "sem_interesse"]).default("prospecao"),
  newsletter: z.boolean().optional(),
  whatsapp: z.boolean().optional(),
  emailApresentacao: z.string().trim().max(20).nullable().optional(),
  campanhas: z.string().trim().max(200).nullable().optional(),
  conversas: z.string().trim().max(2000).nullable().optional(),
  notas: z.string().trim().max(4000).nullable().optional(),
});

comercialRouter.get(
  "/leads",
  asyncHandler(async (_req, res) => {
    res.json(await prisma.comercialLead.findMany({ orderBy: [{ mercado: "asc" }, { distrito: "asc" }, { nome: "asc" }] }));
  })
);
comercialRouter.post(
  "/leads",
  asyncHandler(async (req, res) => {
    res.status(201).json(await prisma.comercialLead.create({ data: leadSchema.parse(req.body) }));
  })
);
comercialRouter.put(
  "/leads/:id",
  asyncHandler(async (req, res) => {
    res.json(await prisma.comercialLead.update({ where: { id: req.params.id }, data: leadSchema.partial().parse(req.body) }));
  })
);

// ---------------------------------------------------------------------------
// Painel comercial
// ---------------------------------------------------------------------------
comercialRouter.get(
  "/painel",
  asyncHandler(async (req, res) => {
    const dias = Math.max(15, Math.min(365, Number(req.query.dias) || 60));
    const hoje = new Date();
    const hojeStr = day(hoje)!;
    const limite = new Date(hoje.getTime() - dias * 86400000);
    const [clientes, sales, visitas, leads, orcRows] = await Promise.all([
      prisma.comercialCliente.findMany({ where: { estado: "ativo" } }),
      salesByClient(),
      prisma.comercialVisita.findMany({ include: { cliente: { select: { id: true, nome: true, zona: true } }, lead: { select: { id: true, nome: true } } }, orderBy: { data: "asc" } }),
      prisma.comercialLead.groupBy({ by: ["estado"], _count: { _all: true } }),
      prisma.$queryRaw<{ id: string; data: Record<string, unknown> }[]>`select id, data from orcamentos`,
    ]);
    const semComprar = clientes
      .map((c) => ({ c, s: c.numero ? sales.get(c.numero) : undefined }))
      .filter(({ s }) => !s?.ultimaCompra || new Date(s.ultimaCompra) < limite)
      .map(({ c, s }) => ({ id: c.id, nome: c.nome, zona: c.zona, comercial: c.comercial, ultimaCompra: s?.ultimaCompra ?? null }))
      .sort((a, b) => String(a.ultimaCompra ?? "").localeCompare(String(b.ultimaCompra ?? "")));
    const lastVisit = new Map<string, string>();
    for (const v of visitas) if (v.estado === "realizada" && v.clienteId) lastVisit.set(v.clienteId, day(v.data)!);
    const semVisita = clientes
      .filter((c) => {
        const l = lastVisit.get(c.id);
        return !l || new Date(l) < limite;
      })
      .map((c) => ({ id: c.id, nome: c.nome, zona: c.zona, volta: c.volta, comercial: c.comercial, ultimaVisita: lastVisit.get(c.id) ?? null }));
    const proximas = visitas
      .filter((v) => v.estado === "planeada" && day(v.data)! >= hojeStr)
      .slice(0, 15)
      .map((v) => ({ id: v.id, data: day(v.data), nome: v.cliente?.nome ?? v.lead?.nome ?? "—", zona: v.cliente?.zona ?? null, objetivo: v.objetivo, clienteId: v.clienteId }));
    const atrasadas = visitas
      .filter((v) => v.estado === "planeada" && day(v.data)! < hojeStr)
      .map((v) => ({ id: v.id, data: day(v.data), nome: v.cliente?.nome ?? v.lead?.nome ?? "—", clienteId: v.clienteId }));
    const orcSemResposta = orcRows
      .map((o) => o.data as { num?: string; data?: string; estado?: string; cliente?: { nome?: string }; totais?: { total?: number } })
      .filter((d) => {
        const e = String(d.estado ?? "").toLowerCase();
        return (e === "" || e === "enviado" || e === "rascunho" || e === "pendente") && d.data && new Date(d.data) < new Date(hoje.getTime() - 7 * 86400000);
      })
      .map((d) => ({ num: d.num ?? "", data: d.data ?? null, cliente: d.cliente?.nome ?? "", total: d.totais?.total ?? null, estado: d.estado ?? "" }))
      .sort((a, b) => String(b.data).localeCompare(String(a.data)))
      .slice(0, 20);
    const mesIni = `${hojeStr.slice(0, 7)}-01`;
    res.json({
      dias,
      clientesAtivos: clientes.length,
      visitasMes: visitas.filter((v) => v.estado === "realizada" && day(v.data)! >= mesIni).length,
      semComprar: semComprar.slice(0, 40),
      nSemComprar: semComprar.length,
      semVisita: semVisita.slice(0, 40),
      nSemVisita: semVisita.length,
      proximas,
      atrasadas,
      orcSemResposta,
      leads: Object.fromEntries(leads.map((l) => [l.estado, l._count._all])),
    });
  })
);

// ---------------------------------------------------------------------------
// Importar do programa "carteira de clientes" (ficheiro JSON exportado ou os
// dados de arranque). Não duplica: usa o id antigo (origemId).
// ---------------------------------------------------------------------------
interface OldClient { id: string; number?: string; nif?: string; name: string; zona?: string; volta?: string; email?: string; phone?: string; status?: string; comercial?: string; plafond?: number; address?: string; postalCode?: string; city?: string; notes?: string }
interface OldVisit { id: string; clientId?: string; date: string; purpose?: string; status?: string; notes?: string; result?: string; nextVisit?: string }
interface OldLead { id: string; mercado?: string; nif?: string; name: string; distrito?: string; email?: string; phone?: string; estado?: string; newsletter?: boolean; whatsapp?: boolean; emailApresentacao?: string; campanhas?: string; conversas?: string; notes?: string }

const blank = (s: string | undefined | null) => (s && String(s).trim() ? String(s).trim() : null);

export async function importarCarteira(data: { clients?: OldClient[]; visits?: OldVisit[]; leads?: OldLead[] }) {
  let nc = 0;
  let nv = 0;
  let nl = 0;
  const idMap = new Map<string, string>();
  for (const c of data.clients ?? []) {
    const estado = ["ativo", "prospecao", "inativo"].includes(c.status ?? "") ? c.status! : "ativo";
    const row = await prisma.comercialCliente.upsert({
      where: { origemId: c.id },
      update: {},
      create: {
        origemId: c.id,
        numero: blank(c.number),
        nif: blank(c.nif),
        nome: c.name,
        zona: blank(c.zona),
        volta: blank(c.volta),
        email: blank(c.email),
        telefone: blank(c.phone),
        estado,
        comercial: blank(c.comercial),
        plafond: typeof c.plafond === "number" ? c.plafond : null,
        morada: blank(c.address),
        codPostal: blank(c.postalCode),
        localidade: blank(c.city),
        notas: blank(c.notes),
      },
    });
    idMap.set(c.id, row.id);
    nc++;
  }
  for (const v of data.visits ?? []) {
    const clienteId = v.clientId ? idMap.get(v.clientId) : undefined;
    if (!clienteId || !/^\d{4}-\d{2}-\d{2}/.test(v.date)) continue;
    await prisma.comercialVisita.upsert({
      where: { origemId: v.id },
      update: {},
      create: {
        origemId: v.id,
        clienteId,
        data: toDate(v.date.slice(0, 10)),
        objetivo: blank(v.purpose),
        estado: v.status === "realizada" ? "realizada" : v.status === "cancelada" ? "cancelada" : "planeada",
        notas: blank(v.notes),
        resultado: blank(v.result),
        proxima: v.nextVisit && /^\d{4}-\d{2}-\d{2}/.test(v.nextVisit) ? toDate(v.nextVisit.slice(0, 10)) : null,
      },
    });
    nv++;
  }
  for (const l of data.leads ?? []) {
    const estado = ["prospecao", "conversas", "cliente", "concorrente", "sem_interesse"].includes(l.estado ?? "") ? l.estado! : "prospecao";
    await prisma.comercialLead.upsert({
      where: { origemId: l.id },
      update: {},
      create: {
        origemId: l.id,
        mercado: l.mercado === "ES" ? "ES" : "PT",
        nif: blank(l.nif),
        nome: l.name,
        distrito: blank(l.distrito),
        email: blank(l.email),
        telefone: blank(l.phone),
        estado,
        newsletter: !!l.newsletter,
        whatsapp: !!l.whatsapp,
        emailApresentacao: blank(l.emailApresentacao),
        campanhas: blank(l.campanhas),
        conversas: blank(l.conversas),
        notas: blank(l.notes),
      },
    });
    nl++;
  }
  return { clientes: nc, visitas: nv, leads: nl };
}

comercialRouter.post(
  "/importar",
  asyncHandler(async (req, res) => {
    if (req.user?.role !== "ADMINISTRADOR") return res.status(403).json({ error: "Só o administrador pode importar." });
    const body = req.body as { clients?: OldClient[]; visits?: OldVisit[]; leads?: OldLead[] };
    if (!body || (!Array.isArray(body.clients) && !Array.isArray(body.leads))) {
      return res.status(400).json({ error: "Ficheiro sem clientes nem prospeção." });
    }
    res.json(await importarCarteira(body));
  })
);
