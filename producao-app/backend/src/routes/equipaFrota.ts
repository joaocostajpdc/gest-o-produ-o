import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { canUseFeature, requireFeature } from "../config/featureReleases";
import { asyncHandler } from "../utils/asyncHandler";

// ============================================================================
// Equipa e Frota — pedido do utilizador de 2026-10-20:
//  - Controlo de Horas dos colaboradores (feature "horas");
//  - Km das Carrinhas, com resumos por carrinha e por condutor (feature
//    "kmViaturas"). Cada registo de km guarda a carrinha E quem conduziu,
//    porque cada condutor tem a sua carrinha mas às vezes trocam.
// Os colaboradores são partilhados pelas duas partes (são também os
// condutores). Em teste: só o administrador, até ser aprovado.
// ============================================================================

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (AAAA-MM-DD).");
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:MM).")
  .nullable()
  .optional();
const optionalText = z.string().trim().max(500).nullable().optional();

const toDate = (v: string) => new Date(`${v}T00:00:00Z`);

function rangeWhere(req: Request) {
  const from = typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : null;
  const to = typeof req.query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : null;
  if (!from && !to) return undefined;
  return { ...(from ? { gte: toDate(from) } : {}), ...(to ? { lte: toDate(to) } : {}) };
}

// ---------------------------------------------------------------------------
// Colaboradores (usados pelas horas e pelos km)
// ---------------------------------------------------------------------------
export const colaboradoresRouter = Router();
colaboradoresRouter.use(requireAuth);
colaboradoresRouter.use(
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    if ((await canUseFeature("horas", req.user)) || (await canUseFeature("kmViaturas", req.user))) return next();
    res.status(404).json({ error: "Funcionalidade ainda não disponível." });
  })
);

const colaboradorSchema = z.object({
  name: z.string().trim().min(1, "Indica o nome.").max(120),
  funcao: optionalText,
  dailyHours: z.coerce.number().min(0).max(24).default(8),
  active: z.boolean().default(true),
  notes: optionalText,
});

colaboradoresRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await prisma.colaborador.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }));
  })
);

colaboradoresRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = colaboradorSchema.parse(req.body);
    res.status(201).json(await prisma.colaborador.create({ data }));
  })
);

colaboradoresRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = colaboradorSchema.partial().parse(req.body);
    res.json(await prisma.colaborador.update({ where: { id: req.params.id }, data }));
  })
);

// ---------------------------------------------------------------------------
// Controlo de Horas
// ---------------------------------------------------------------------------
export const horasRouter = Router();
horasRouter.use(requireAuth);
horasRouter.use(requireFeature("horas"));

const TIPOS = ["TRABALHO", "FALTA", "FERIAS", "BAIXA", "FERIADO"] as const;

const timeEntrySchema = z
  .object({
    colaboradorId: z.string().min(1, "Escolhe o colaborador."),
    date: dateOnly,
    tipo: z.enum(TIPOS).default("TRABALHO"),
    startTime: time,
    endTime: time,
    breakMinutes: z.coerce.number().int().min(0).max(600).default(0),
    notes: optionalText,
  })
  .refine((d) => d.tipo !== "TRABALHO" || (d.startTime && d.endTime), {
    message: "Indica a hora de entrada e de saída.",
  });

horasRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const colaboradorId = typeof req.query.colaboradorId === "string" ? req.query.colaboradorId : undefined;
    const rows = await prisma.timeEntry.findMany({
      where: { date: rangeWhere(req), ...(colaboradorId ? { colaboradorId } : {}) },
      orderBy: [{ date: "desc" }, { startTime: "asc" }],
      include: { colaborador: { select: { id: true, name: true, dailyHours: true } } },
    });
    res.json(rows);
  })
);

horasRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const d = timeEntrySchema.parse(req.body);
    const work = d.tipo === "TRABALHO";
    const row = await prisma.timeEntry.create({
      data: {
        colaboradorId: d.colaboradorId,
        date: toDate(d.date),
        tipo: d.tipo,
        startTime: work ? d.startTime ?? null : null,
        endTime: work ? d.endTime ?? null : null,
        breakMinutes: work ? d.breakMinutes : 0,
        notes: d.notes ?? null,
        createdById: req.user?.id ?? null,
      },
      include: { colaborador: { select: { id: true, name: true, dailyHours: true } } },
    });
    res.status(201).json(row);
  })
);

horasRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const d = timeEntrySchema.parse(req.body);
    const work = d.tipo === "TRABALHO";
    const row = await prisma.timeEntry.update({
      where: { id: req.params.id },
      data: {
        colaboradorId: d.colaboradorId,
        date: toDate(d.date),
        tipo: d.tipo,
        startTime: work ? d.startTime ?? null : null,
        endTime: work ? d.endTime ?? null : null,
        breakMinutes: work ? d.breakMinutes : 0,
        notes: d.notes ?? null,
      },
      include: { colaborador: { select: { id: true, name: true, dailyHours: true } } },
    });
    res.json(row);
  })
);

horasRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.timeEntry.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);

// ---------------------------------------------------------------------------
// Km das Carrinhas
// ---------------------------------------------------------------------------
export const viaturasRouter = Router();
viaturasRouter.use(requireAuth);
viaturasRouter.use(requireFeature("kmViaturas"));

const vehicleSchema = z.object({
  plate: z
    .string()
    .trim()
    .min(1, "Indica a matrícula.")
    .max(20)
    .transform((v) => v.toUpperCase()),
  name: optionalText,
  defaultDriverId: z.string().nullable().optional(),
  initialKm: z.coerce.number().int().min(0).default(0),
  active: z.boolean().default(true),
  notes: optionalText,
});

viaturasRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const [vehicles, last] = await Promise.all([
      prisma.vehicle.findMany({
        orderBy: [{ active: "desc" }, { plate: "asc" }],
        include: { defaultDriver: { select: { id: true, name: true } } },
      }),
      prisma.vehicleTrip.groupBy({ by: ["vehicleId"], _max: { kmEnd: true } }),
    ]);
    res.json(
      vehicles.map((v: (typeof vehicles)[number]) => ({
        ...v,
        currentKm: Math.max(v.initialKm, last.find((l: { vehicleId: string; _max: { kmEnd: number | null } }) => l.vehicleId === v.id)?._max.kmEnd ?? 0),
      }))
    );
  })
);

viaturasRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = vehicleSchema.parse(req.body);
    const exists = await prisma.vehicle.findUnique({ where: { plate: data.plate } });
    if (exists) return res.status(400).json({ error: "Já existe uma carrinha com essa matrícula." });
    res.status(201).json(await prisma.vehicle.create({ data: { ...data, defaultDriverId: data.defaultDriverId || null } }));
  })
);

viaturasRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = vehicleSchema.partial().parse(req.body);
    if (data.plate) {
      const other = await prisma.vehicle.findFirst({ where: { plate: data.plate, NOT: { id: req.params.id } } });
      if (other) return res.status(400).json({ error: "Já existe uma carrinha com essa matrícula." });
    }
    res.json(
      await prisma.vehicle.update({
        where: { id: req.params.id },
        data: { ...data, ...(data.defaultDriverId !== undefined ? { defaultDriverId: data.defaultDriverId || null } : {}) },
      })
    );
  })
);

const tripSchema = z
  .object({
    vehicleId: z.string().min(1, "Escolhe a carrinha."),
    driverId: z.string().nullable().optional(),
    date: dateOnly,
    kmStart: z.coerce.number().int().min(0),
    kmEnd: z.coerce.number().int().min(0),
    destination: optionalText,
    notes: optionalText,
  })
  .refine((d) => d.kmEnd >= d.kmStart, { message: "Os km finais não podem ser menores que os iniciais." })
  .refine((d) => d.kmEnd - d.kmStart <= 5000, { message: "Mais de 5000 km num registo — confirma os valores." });

const TRIP_INCLUDE = {
  vehicle: { select: { id: true, plate: true, name: true, defaultDriverId: true } },
  driver: { select: { id: true, name: true } },
} as const;

viaturasRouter.get(
  "/viagens",
  asyncHandler(async (req, res) => {
    const vehicleId = typeof req.query.vehicleId === "string" ? req.query.vehicleId : undefined;
    const driverId = typeof req.query.driverId === "string" ? req.query.driverId : undefined;
    res.json(
      await prisma.vehicleTrip.findMany({
        where: { date: rangeWhere(req), ...(vehicleId ? { vehicleId } : {}), ...(driverId ? { driverId } : {}) },
        orderBy: [{ date: "desc" }, { kmEnd: "desc" }],
        include: TRIP_INCLUDE,
      })
    );
  })
);

viaturasRouter.post(
  "/viagens",
  asyncHandler(async (req, res) => {
    const d = tripSchema.parse(req.body);
    const row = await prisma.vehicleTrip.create({
      data: {
        vehicleId: d.vehicleId,
        driverId: d.driverId || null,
        date: toDate(d.date),
        kmStart: d.kmStart,
        kmEnd: d.kmEnd,
        destination: d.destination ?? null,
        notes: d.notes ?? null,
        createdById: req.user?.id ?? null,
      },
      include: TRIP_INCLUDE,
    });
    res.status(201).json(row);
  })
);

viaturasRouter.put(
  "/viagens/:id",
  asyncHandler(async (req, res) => {
    const d = tripSchema.parse(req.body);
    const row = await prisma.vehicleTrip.update({
      where: { id: req.params.id },
      data: {
        vehicleId: d.vehicleId,
        driverId: d.driverId || null,
        date: toDate(d.date),
        kmStart: d.kmStart,
        kmEnd: d.kmEnd,
        destination: d.destination ?? null,
        notes: d.notes ?? null,
      },
      include: TRIP_INCLUDE,
    });
    res.json(row);
  })
);

viaturasRouter.delete(
  "/viagens/:id",
  asyncHandler(async (req, res) => {
    await prisma.vehicleTrip.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);
