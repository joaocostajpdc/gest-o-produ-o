import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { requireFeature } from "../config/featureReleases";
import { asyncHandler } from "../utils/asyncHandler";
import { computePriority, PRIORITY_COLORS, PRIORITY_LABELS } from "../services/priorityService";

// ============================================================================
// Planeamento semanal (pedido do utilizador de 2026-10-29: "prepara uma parte
// para planeamento semanal"). Planeia-se por dia: OS a trabalhar, entregas,
// envios e recolhas da lacagem e outras tarefas, com os colaboradores, a
// carrinha e o condutor de cada uma. Escolhas do utilizador: "todos veem,
// admin edita". Além do que é marcado à mão, a semana mostra sozinha os
// prazos das OS e as voltas da lacagem previstas.
//
// Em teste: "planeamento" (só o administrador até aprovar).
// ============================================================================

export const planeamentoRouter = Router();
planeamentoRouter.use(requireAuth);
planeamentoRouter.use(requireFeature("planeamento"));

const KINDS = ["OS", "ENTREGA", "ENVIO_LACAGEM", "RECOLHA_LACAGEM", "OUTRO"] as const;
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (AAAA-MM-DD).");
const toDate = (v: string) => new Date(`${v}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const optText = z.string().trim().max(1000).nullable().optional();

function adminOnly(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role === "ADMINISTRADOR") return next();
  res.status(403).json({ error: "Só o administrador pode alterar o planeamento." });
}

/** Segunda-feira da semana de uma data (AAAA-MM-DD). */
function mondayOf(d: Date) {
  const day = d.getUTCDay(); // 0 domingo
  const m = new Date(d);
  m.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
  return m;
}

const LACAGEM = "Lacagem";
const finishOf = (spec: string | null) =>
  [...(spec ?? "").matchAll(/^Acabamento:\s*(.+)$/gim)].map((m) => m[1].trim().replace(/[;,]\s*$/, ""))[0] ?? null;

planeamentoRouter.get(
  "/week",
  asyncHandler(async (req, res) => {
    const startParam = typeof req.query.start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.start) ? req.query.start : iso(new Date());
    const monday = mondayOf(toDate(startParam));
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);

    const [items, openOrders, colaboradores, vehicles, suppliers] = await Promise.all([
      prisma.planItem.findMany({
        where: { date: { gte: monday, lte: sunday } },
        orderBy: [{ date: "asc" }, { position: "asc" }, { createdAt: "asc" }],
      }),
      prisma.serviceOrder.findMany({
        where: { status: { in: ["NAO_INICIADA", "EM_PRODUCAO", "SUSPENSA"] } },
        include: {
          client: { select: { name: true } },
          product: { select: { name: true, category: true } },
          currentStageInstance: { include: { stage: true, supplier: { include: { leadTimes: true } } } },
        },
        orderBy: [{ deadlineAt: "asc" }],
      }),
      prisma.colaborador.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, funcao: true } }),
      prisma.vehicle.findMany({
        where: { active: true },
        orderBy: { plate: "asc" },
        select: { id: true, plate: true, name: true, defaultDriverId: true },
      }),
      prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ]);

    const now = new Date();
    const orders = openOrders.map((o: (typeof openOrders)[number]) => {
      const csi = o.currentStageInstance;
      let expectedReturnAt: string | null = null;
      if (csi && csi.stage.name === LACAGEM && csi.supplier && csi.enteredAt) {
        const lt = csi.supplier.leadTimes.find((l: { category: string | null; leadDays: number }) => l.category === o.product.category);
        if (lt) expectedReturnAt = new Date(csi.enteredAt.getTime() + lt.leadDays * 86400000).toISOString();
      }
      const p = computePriority(o.deadlineAt, o.status, now);
      return {
        id: o.id,
        externalId: o.externalId,
        status: o.status,
        client: o.client.name,
        product: o.product.name,
        category: o.product.category,
        finish: finishOf(o.specifications),
        stage: csi?.stage.name ?? null,
        stageSupplier: csi?.supplier?.name ?? null,
        stageSupplierId: csi?.supplier?.id ?? null,
        deadlineAt: o.deadlineAt?.toISOString() ?? null,
        expectedReturnAt,
        priority: p,
        priorityLabel: p ? PRIORITY_LABELS[p] : null,
        priorityColor: p ? PRIORITY_COLORS[p] : null,
      };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byId = new Map<string, any>(orders.map((o: (typeof orders)[number]) => [o.id, o]));

    // OS já fechadas que estejam marcadas nesta semana (para o cartão continuar a mostrar o nº)
    const missing = items.filter((i: (typeof items)[number]) => i.serviceOrderId && !byId.has(i.serviceOrderId)).map((i: (typeof items)[number]) => i.serviceOrderId!);
    const closed = missing.length
      ? await prisma.serviceOrder.findMany({
          where: { id: { in: missing } },
          include: { client: { select: { name: true } }, product: { select: { name: true } } },
        })
      : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const closedById = new Map<string, any>(closed.map((o: (typeof closed)[number]) => [o.id, o]));

    res.json({
      weekStart: iso(monday),
      canEdit: req.user?.role === "ADMINISTRADOR",
      items: items.map((i: (typeof items)[number]) => {
        const o = i.serviceOrderId ? byId.get(i.serviceOrderId) : null;
        const c = i.serviceOrderId && !o ? closedById.get(i.serviceOrderId) : null;
        return {
          ...i,
          date: iso(i.date),
          serviceOrder: o
            ? { id: o.id, externalId: o.externalId, client: o.client, product: o.product, stage: o.stage, finish: o.finish, status: o.status, priorityColor: o.priorityColor, deadlineAt: o.deadlineAt }
            : c
              ? { id: c.id, externalId: c.externalId, client: c.client.name, product: c.product.name, stage: null, finish: null, status: c.status, priorityColor: null, deadlineAt: c.deadlineAt?.toISOString() ?? null }
              : null,
        };
      }),
      openOrders: orders,
      colaboradores,
      vehicles,
      suppliers,
    });
  })
);

const itemSchema = z.object({
  date: dateOnly,
  kind: z.enum(KINDS),
  title: optText,
  serviceOrderId: z.string().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  colaboradorIds: z.array(z.string()).max(30).default([]),
  vehicleId: z.string().nullable().optional(),
  driverId: z.string().nullable().optional(),
  period: z.string().trim().max(40).nullable().optional(),
  notes: optText,
  done: z.boolean().optional(),
});

function check(data: z.infer<typeof itemSchema>) {
  if (data.kind === "OS" && !data.serviceOrderId) throw new Error("Escolhe a OS.");
  if (data.kind === "OUTRO" && !data.title?.trim()) throw new Error("Escreve o que é para fazer.");
  if (data.kind !== "OS" && data.kind !== "OUTRO" && !data.serviceOrderId && !data.title?.trim())
    throw new Error("Escolhe a OS ou escreve uma descrição.");
}

planeamentoRouter.post(
  "/items",
  adminOnly,
  asyncHandler(async (req, res) => {
    const data = itemSchema.parse(req.body);
    check(data);
    const last = await prisma.planItem.findFirst({ where: { date: toDate(data.date) }, orderBy: { position: "desc" } });
    const item = await prisma.planItem.create({
      data: { ...data, date: toDate(data.date), position: (last?.position ?? 0) + 1, createdById: req.user?.id },
    });
    res.json(item);
  })
);

planeamentoRouter.put(
  "/items/:id",
  adminOnly,
  asyncHandler(async (req, res) => {
    const data = itemSchema.parse(req.body);
    check(data);
    const item = await prisma.planItem.update({ where: { id: req.params.id }, data: { ...data, date: toDate(data.date) } });
    res.json(item);
  })
);

// Mover (arrastar para outro dia / mudar a ordem) e marcar como feito.
planeamentoRouter.post(
  "/items/:id/move",
  adminOnly,
  asyncHandler(async (req, res) => {
    const body = z
      .object({ date: dateOnly.optional(), position: z.number().int().optional(), done: z.boolean().optional() })
      .parse(req.body);
    const item = await prisma.planItem.update({
      where: { id: req.params.id },
      data: {
        ...(body.date ? { date: toDate(body.date) } : {}),
        ...(body.position != null ? { position: body.position } : {}),
        ...(body.done != null ? { done: body.done } : {}),
      },
    });
    res.json(item);
  })
);

planeamentoRouter.delete(
  "/items/:id",
  adminOnly,
  asyncHandler(async (req, res) => {
    await prisma.planItem.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  })
);

// Copiar a semana para a seguinte (o que se repete: voltas, equipas…)
planeamentoRouter.post(
  "/copy-week",
  adminOnly,
  asyncHandler(async (req, res) => {
    const { from } = z.object({ from: dateOnly }).parse(req.body);
    const monday = mondayOf(toDate(from));
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    const items = await prisma.planItem.findMany({ where: { date: { gte: monday, lte: sunday } } });
    for (const i of items) {
      const d = new Date(i.date);
      d.setUTCDate(d.getUTCDate() + 7);
      await prisma.planItem.create({
        data: {
          date: d,
          kind: i.kind,
          title: i.title,
          serviceOrderId: i.serviceOrderId,
          supplierId: i.supplierId,
          colaboradorIds: i.colaboradorIds,
          vehicleId: i.vehicleId,
          driverId: i.driverId,
          period: i.period,
          notes: i.notes,
          position: i.position,
          createdById: req.user?.id,
        },
      });
    }
    res.json({ copied: items.length });
  })
);

// Acrescentar depressa um colaborador ou uma carrinha a partir do planeamento.
planeamentoRouter.post(
  "/colaboradores",
  adminOnly,
  asyncHandler(async (req, res) => {
    const { name } = z.object({ name: z.string().trim().min(1, "Indica o nome.").max(120) }).parse(req.body);
    const c = await prisma.colaborador.create({ data: { name } });
    res.json({ id: c.id, name: c.name, funcao: c.funcao });
  })
);

planeamentoRouter.post(
  "/viaturas",
  adminOnly,
  asyncHandler(async (req, res) => {
    const body = z
      .object({ plate: z.string().trim().min(1, "Indica a matrícula.").max(20), name: z.string().trim().max(60).nullable().optional() })
      .parse(req.body);
    const v = await prisma.vehicle.create({ data: { plate: body.plate.toUpperCase(), name: body.name || null } });
    res.json({ id: v.id, plate: v.plate, name: v.name, defaultDriverId: v.defaultDriverId });
  })
);
