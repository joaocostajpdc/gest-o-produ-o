import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { requireFeature } from "../config/featureReleases";
import { asyncHandler } from "../utils/asyncHandler";

// ============================================================================
// Financeiro — Cheques passados (pedido de 2026-10-24, "apenas eu").
// Funcionalidade restrita: só o administrador e as pessoas que ele escolher
// (testerUserIds). 2026-10-25: o João abriu os cheques também à Alice Sousa.
// ============================================================================

export const financeiroRouter = Router();
financeiroRouter.use(requireAuth);
financeiroRouter.use(requireFeature("financeiro"));

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");
const toDate = (v: string) => new Date(`${v}T00:00:00Z`);
const ESTADOS = ["POR_DESCONTAR", "DESCONTADO", "ANULADO"] as const;

const chequeSchema = z.object({
  numero: z.string().trim().min(1, "Indica o nº do cheque.").max(40),
  banco: z.string().trim().min(1, "Indica o banco.").max(80),
  beneficiario: z.string().trim().min(1, "Indica a quem foi passado.").max(160),
  valor: z.coerce.number().positive("O valor tem de ser maior que zero.").max(10_000_000),
  dataEmissao: dateOnly,
  dataCheque: dateOnly,
  estado: z.enum(ESTADOS).default("POR_DESCONTAR"),
  descontadoEm: dateOnly.nullable().optional(),
  referencia: z.string().trim().max(200).nullable().optional(),
  notas: z.string().trim().max(1000).nullable().optional(),
});

function toData(d: Partial<z.infer<typeof chequeSchema>>) {
  const out: Record<string, unknown> = { ...d };
  if (d.dataEmissao) out.dataEmissao = toDate(d.dataEmissao);
  if (d.dataCheque) out.dataCheque = toDate(d.dataCheque);
  if (d.descontadoEm !== undefined) out.descontadoEm = d.descontadoEm ? toDate(d.descontadoEm) : null;
  if (d.estado && d.estado !== "DESCONTADO" && d.descontadoEm === undefined) out.descontadoEm = null;
  return out;
}

const present = (c: { valor: unknown } & Record<string, unknown>) => ({ ...c, valor: Number(c.valor) });

financeiroRouter.get(
  "/cheques",
  asyncHandler(async (_req, res) => {
    const list = await prisma.cheque.findMany({ orderBy: [{ dataCheque: "asc" }, { numero: "asc" }] });
    res.json(list.map(present));
  })
);

financeiroRouter.post(
  "/cheques",
  asyncHandler(async (req, res) => {
    const d = chequeSchema.parse(req.body);
    const row = await prisma.cheque.create({
      data: {
        numero: d.numero,
        banco: d.banco,
        beneficiario: d.beneficiario,
        valor: d.valor,
        dataEmissao: toDate(d.dataEmissao),
        dataCheque: toDate(d.dataCheque),
        estado: d.estado,
        descontadoEm: d.estado === "DESCONTADO" ? toDate(d.descontadoEm || d.dataCheque) : null,
        referencia: d.referencia ?? null,
        notas: d.notas ?? null,
        createdById: req.user!.id,
      },
    });
    res.status(201).json(present(row));
  })
);

financeiroRouter.put(
  "/cheques/:id",
  asyncHandler(async (req, res) => {
    const d = chequeSchema.partial().parse(req.body);
    const row = await prisma.cheque.update({ where: { id: req.params.id }, data: toData(d) });
    res.json(present(row));
  })
);

financeiroRouter.delete(
  "/cheques/:id",
  asyncHandler(async (req, res) => {
    await prisma.cheque.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  })
);

// ============================================================================
// Transferências programadas e pagamentos a fazer (pedido de 2026-10-26:
// "põe-me um calendário … e transferências programadas e pagamentos a fazer,
// nestes valores certo ou por exemplo IVA ± 5000"). Em teste só para o
// administrador (feature "financeiroAgenda", restrita como o Financeiro).
// ============================================================================

const TIPOS = ["TRANSFERENCIA", "PAGAMENTO"] as const;
const ESTADOS_MOV = ["POR_PAGAR", "PAGO", "ANULADO"] as const;

const movSchema = z.object({
  tipo: z.enum(TIPOS),
  descricao: z.string().trim().min(1, "Indica o que é (ex.: IVA, renda, ordenados).").max(160),
  entidade: z.string().trim().max(160).nullable().optional(),
  banco: z.string().trim().max(80).nullable().optional(),
  valor: z.coerce.number().positive("O valor tem de ser maior que zero.").max(10_000_000),
  estimado: z.boolean().default(false),
  data: dateOnly,
  estado: z.enum(ESTADOS_MOV).default("POR_PAGAR"),
  pagoEm: dateOnly.nullable().optional(),
  valorPago: z.coerce.number().nonnegative().max(10_000_000).nullable().optional(),
  notas: z.string().trim().max(1000).nullable().optional(),
});

function movData(d: Partial<z.infer<typeof movSchema>>) {
  const out: Record<string, unknown> = { ...d };
  if (d.data) out.data = toDate(d.data);
  if (d.pagoEm !== undefined) out.pagoEm = d.pagoEm ? toDate(d.pagoEm) : null;
  if (d.estado && d.estado !== "PAGO" && d.pagoEm === undefined) {
    out.pagoEm = null;
    if (d.valorPago === undefined) out.valorPago = null;
  }
  return out;
}

const presentMov = (m: { valor: unknown; valorPago: unknown } & Record<string, unknown>) => ({
  ...m,
  valor: Number(m.valor),
  valorPago: m.valorPago === null || m.valorPago === undefined ? null : Number(m.valorPago),
});

const addMonths = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
};

financeiroRouter.get(
  "/movimentos",
  requireFeature("financeiroAgenda"),
  asyncHandler(async (_req, res) => {
    const list = await prisma.movimentoFinanceiro.findMany({ orderBy: [{ data: "asc" }, { createdAt: "asc" }] });
    res.json(list.map(presentMov));
  })
);

financeiroRouter.post(
  "/movimentos",
  requireFeature("financeiroAgenda"),
  asyncHandler(async (req, res) => {
    const d = movSchema.parse(req.body);
    const meses = Math.min(36, Math.max(1, Math.floor(Number((req.body as { repetirMeses?: unknown })?.repetirMeses) || 1)));
    const grupoId = meses > 1 ? `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` : null;
    const rows = [];
    for (let i = 0; i < meses; i++) {
      rows.push(
        await prisma.movimentoFinanceiro.create({
          data: {
            ...(movData({ ...d, data: addMonths(d.data, i) }) as z.infer<typeof movSchema> & { data: Date }),
            ...(i > 0 ? { estado: "POR_PAGAR", pagoEm: null, valorPago: null } : {}),
            grupoId,
            createdById: req.user?.id ?? null,
          } as never,
        })
      );
    }
    res.status(201).json(rows.map(presentMov));
  })
);

financeiroRouter.put(
  "/movimentos/:id",
  requireFeature("financeiroAgenda"),
  asyncHandler(async (req, res) => {
    const d = movSchema.partial().parse(req.body);
    const row = await prisma.movimentoFinanceiro.update({ where: { id: req.params.id }, data: movData(d) as never });
    res.json(presentMov(row));
  })
);

financeiroRouter.delete(
  "/movimentos/:id",
  requireFeature("financeiroAgenda"),
  asyncHandler(async (req, res) => {
    const todos = (req.query.grupo as string) === "1";
    const row = await prisma.movimentoFinanceiro.findUnique({ where: { id: req.params.id } });
    if (!row) return res.json({ ok: true });
    if (todos && row.grupoId) {
      // Apaga este e os seguintes do mesmo grupo que ainda estão por pagar.
      await prisma.movimentoFinanceiro.deleteMany({ where: { grupoId: row.grupoId, data: { gte: row.data }, estado: "POR_PAGAR" } });
      await prisma.movimentoFinanceiro.deleteMany({ where: { id: row.id } });
    } else {
      await prisma.movimentoFinanceiro.delete({ where: { id: row.id } });
    }
    res.json({ ok: true });
  })
);
