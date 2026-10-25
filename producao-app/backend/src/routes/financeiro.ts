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
