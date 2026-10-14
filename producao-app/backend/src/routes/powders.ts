import { Router } from "express";
import { z } from "zod";
import { Prisma, PowderLocation, PowderMovementType } from "@prisma/client";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { requireFeature } from "../config/featureReleases";
import { asyncHandler } from "../utils/asyncHandler";
import { streamPowderLabelPdf } from "../services/labelPdfService";

// ============================================================================
// Pó em Stock — tintas em pó para lacagem (pedido do utilizador de
// 2026-10-13). Cada registo é uma referência de pó (Referência / Marca /
// Código / RAL / Quant. kg / Local). As entradas e saídas ficam registadas
// em PowderMovement e atualizam a quantidade em stock.
//
// Toda a área está atrás de requireFeature("powderStock"): enquanto o
// administrador não a aprovar, só ele a vê e usa (ver
// config/featureReleases.ts).
// ============================================================================

export const powdersRouter = Router();
powdersRouter.use(requireAuth);
powdersRouter.use(requireFeature("powderStock"));

const kg = z.coerce.number().finite().min(0).max(100000);

const createSchema = z.object({
  referencia: z.string().trim().min(1),
  marca: z.string().trim().min(1),
  codigo: z.string().trim().min(1).max(60),
  ral: z.string().trim().optional(),
  quantityKg: kg.optional(),
  location: z.nativeEnum(PowderLocation),
  supplierId: z.string().nullable().optional(),
  notes: z.string().trim().optional(),
});

const updateSchema = z.object({
  referencia: z.string().trim().min(1).optional(),
  marca: z.string().trim().min(1).optional(),
  codigo: z.string().trim().min(1).max(60).optional(),
  ral: z.string().trim().nullable().optional(),
  quantityKg: kg.optional(),
  location: z.nativeEnum(PowderLocation).optional(),
  supplierId: z.string().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
});

const movementSchema = z.object({
  type: z.enum(["ENTRADA", "SAIDA"]),
  quantityKg: z.coerce.number().finite().positive().max(100000),
  // Opcional: ao dar entrada/saída pode-se também mudar o local da caixa
  // (ex.: sai do Armazém e fica nas Lavagens).
  location: z.nativeEnum(PowderLocation).optional(),
  supplierId: z.string().nullable().optional(),
  notes: z.string().trim().optional(),
});

/**
 * Local do pó: Armazém (sem fornecedor) ou uma lavagem concreta (fornecedor
 * obrigatório). Garante que nunca fica "Lavagens" sem dizer qual, nem um
 * fornecedor esquecido quando o pó volta ao Armazém.
 */
async function resolveLocation(
  location: PowderLocation,
  supplierId: string | null | undefined
): Promise<{ location: PowderLocation; supplierId: string | null }> {
  if (location === "ARMAZEM") return { location, supplierId: null };
  if (!supplierId) throw new Error("Indica em que lavagem fica o pó.");
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) throw new Error("Lavagem (fornecedor) não encontrada.");
  return { location, supplierId };
}

const MOVEMENT_INCLUDE = { user: { select: { id: true, name: true } } } as const;
const SUPPLIER_INCLUDE = { select: { id: true, name: true } } as const;

type PowderWithMovements = Prisma.PowderStockGetPayload<{
  include: { movements: { include: typeof MOVEMENT_INCLUDE } };
}>;

// As quantidades são Decimal na base de dados (para não acumular erros de
// arredondamento em somas/subtrações de kg); a API devolve-as como número.
function serializePowder(p: Prisma.PowderStockGetPayload<object> | PowderWithMovements) {
  const base = {
    ...p,
    quantityKg: Number(p.quantityKg),
  };
  if ("movements" in p && Array.isArray(p.movements)) {
    return {
      ...base,
      movements: p.movements.map((m) => ({
        ...m,
        quantityKg: Number(m.quantityKg),
        balanceKg: Number(m.balanceKg),
      })),
    };
  }
  return base;
}

function isUniqueCodeError(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

const DUPLICATE_CODE_MSG = "Já existe um pó com este código. Cada caixa/etiqueta precisa de um código único.";

powdersRouter.get(
  "/",
  requirePermission("powderStock:read"),
  asyncHandler(async (req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const location = typeof req.query.location === "string" ? req.query.location : "";
    const where: Prisma.PowderStockWhereInput = {};
    if (location === "LAVAGENS" || location === "ARMAZEM") where.location = location;
    if (search) {
      where.OR = [
        { referencia: { contains: search, mode: "insensitive" } },
        { marca: { contains: search, mode: "insensitive" } },
        { codigo: { contains: search, mode: "insensitive" } },
        { ral: { contains: search, mode: "insensitive" } },
      ];
    }
    const items = await prisma.powderStock.findMany({
      where,
      include: { supplier: SUPPLIER_INCLUDE },
      orderBy: [{ marca: "asc" }, { referencia: "asc" }],
    });
    res.json(items.map(serializePowder));
  })
);

// Procura pelo código lido na etiqueta (código de barras ou QR).
powdersRouter.get(
  "/by-code/:code",
  requirePermission("powderStock:read"),
  asyncHandler(async (req, res) => {
    const code = req.params.code.trim();
    const item = await prisma.powderStock.findFirst({
      where: { codigo: { equals: code, mode: "insensitive" } },
      include: { supplier: SUPPLIER_INCLUDE },
    });
    if (!item) {
      return res.status(404).json({ error: `Não foi encontrado nenhum pó com o código "${code}".` });
    }
    res.json(serializePowder(item));
  })
);

powdersRouter.get(
  "/:id",
  requirePermission("powderStock:read"),
  asyncHandler(async (req, res) => {
    const item = await prisma.powderStock.findUnique({
      where: { id: req.params.id },
      include: {
        supplier: SUPPLIER_INCLUDE,
        movements: { include: MOVEMENT_INCLUDE, orderBy: { createdAt: "desc" }, take: 50 },
      },
    });
    if (!item) throw new Error("Pó não encontrado.");
    res.json(serializePowder(item));
  })
);

powdersRouter.post(
  "/",
  requirePermission("powderStock:write"),
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const qty = data.quantityKg ?? 0;
    const loc = await resolveLocation(data.location, data.supplierId);
    try {
      const item = await prisma.$transaction(async (tx) => {
        const created = await tx.powderStock.create({
          data: {
            referencia: data.referencia,
            marca: data.marca,
            codigo: data.codigo,
            ral: data.ral || null,
            quantityKg: qty,
            location: loc.location,
            supplierId: loc.supplierId,
            notes: data.notes || null,
          },
          include: { supplier: SUPPLIER_INCLUDE },
        });
        if (qty > 0) {
          await tx.powderMovement.create({
            data: {
              powderId: created.id,
              type: "ENTRADA",
              quantityKg: qty,
              balanceKg: qty,
              notes: "Stock inicial",
              userId: req.user?.id,
            },
          });
        }
        return created;
      });
      res.status(201).json(serializePowder(item));
    } catch (err) {
      if (isUniqueCodeError(err)) throw new Error(DUPLICATE_CODE_MSG);
      throw err;
    }
  })
);

powdersRouter.put(
  "/:id",
  requirePermission("powderStock:write"),
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    try {
      const item = await prisma.$transaction(async (tx) => {
        const existing = await tx.powderStock.findUnique({ where: { id: req.params.id } });
        if (!existing) throw new Error("Pó não encontrado.");

        const { location: newLocation, supplierId: newSupplierId, ...rest } = data;
        const loc =
          newLocation !== undefined || newSupplierId !== undefined
            ? await resolveLocation(newLocation ?? existing.location, newSupplierId ?? existing.supplierId)
            : {};

        const updated = await tx.powderStock.update({
          where: { id: existing.id },
          include: { supplier: SUPPLIER_INCLUDE },
          data: {
            ...rest,
            ...loc,
            ral: data.ral === undefined ? undefined : data.ral || null,
            notes: data.notes === undefined ? undefined : data.notes || null,
          },
        });

        // Corrigir a quantidade à mão fica registado como "Acerto", com a
        // diferença, para o histórico de movimentos bater sempre certo.
        if (data.quantityKg !== undefined) {
          const diff = new Prisma.Decimal(data.quantityKg).minus(existing.quantityKg);
          if (!diff.isZero()) {
            await tx.powderMovement.create({
              data: {
                powderId: existing.id,
                type: "ACERTO",
                quantityKg: diff,
                balanceKg: data.quantityKg,
                notes: "Acerto manual de stock",
                userId: req.user?.id,
              },
            });
          }
        }
        return updated;
      });
      res.json(serializePowder(item));
    } catch (err) {
      if (isUniqueCodeError(err)) throw new Error(DUPLICATE_CODE_MSG);
      throw err;
    }
  })
);

powdersRouter.delete(
  "/:id",
  requirePermission("powderStock:write"),
  asyncHandler(async (req, res) => {
    await prisma.powderStock.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);

// Entrada ou saída de pó — o que se faz ao ler a etiqueta da caixa.
powdersRouter.post(
  "/:id/movements",
  requirePermission("powderStock:move"),
  asyncHandler(async (req, res) => {
    const data = movementSchema.parse(req.body);
    const item = await prisma.$transaction(async (tx) => {
      const existing = await tx.powderStock.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new Error("Pó não encontrado.");
      const loc = data.location ? await resolveLocation(data.location, data.supplierId) : {};

      const qty = new Prisma.Decimal(data.quantityKg);
      const balance =
        data.type === "ENTRADA" ? existing.quantityKg.plus(qty) : existing.quantityKg.minus(qty);
      if (balance.isNegative()) {
        throw new Error(
          `Não há pó suficiente: o stock atual é ${Number(existing.quantityKg)} kg e pediste uma saída de ${data.quantityKg} kg.`
        );
      }

      await tx.powderMovement.create({
        data: {
          powderId: existing.id,
          type: data.type as PowderMovementType,
          quantityKg: qty,
          balanceKg: balance,
          notes: data.notes || null,
          userId: req.user?.id,
        },
      });
      return tx.powderStock.update({
        where: { id: existing.id },
        data: { quantityKg: balance, ...loc },
        include: {
        supplier: SUPPLIER_INCLUDE,
        movements: { include: MOVEMENT_INCLUDE, orderBy: { createdAt: "desc" }, take: 50 },
      },
      });
    });
    res.status(201).json(serializePowder(item));
  })
);

// Etiqueta para colar na caixa — ?copies=N imprime N etiquetas iguais (uma
// por caixa da mesma referência).
powdersRouter.get(
  "/:id/label",
  requirePermission("powderStock:read"),
  asyncHandler(async (req, res) => {
    const item = await prisma.powderStock.findUnique({ where: { id: req.params.id } });
    if (!item) throw new Error("Pó não encontrado.");
    const copiesRaw = parseInt(String(req.query.copies ?? "1"), 10);
    const copies = Number.isFinite(copiesRaw) ? Math.min(Math.max(copiesRaw, 1), 50) : 1;
    await streamPowderLabelPdf(
      res,
      { referencia: item.referencia, marca: item.marca, codigo: item.codigo, ral: item.ral },
      copies
    );
  })
);
