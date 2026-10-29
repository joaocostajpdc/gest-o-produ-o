import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { canUseFeature, requireFeature } from "../config/featureReleases";
import { readSpecBlocks } from "../services/specMeasures";
import { asyncHandler } from "../utils/asyncHandler";
import { logHistoryEvent } from "../services/historyService";
import { CutResult, optimizeBars, optimizeSheets } from "../services/cutOptimizer";

// ============================================================================
// Otimização de Corte (pedido do utilizador de 2026-10-16) — planos de corte
// de chapas (2D) e de barras (1D), opcionalmente ligados a uma Ordem de
// Serviço. O cálculo é sempre feito aqui no servidor (services/cutOptimizer),
// tanto na pré-visualização como ao gravar, para o plano guardado bater certo
// com as medidas.
//
// Em teste: só o administrador vê/usa enquanto não for aprovado (ver
// config/featureReleases.ts).
// ============================================================================

export const cutPlansRouter = Router();
cutPlansRouter.use(requireAuth);
cutPlansRouter.use(requireFeature("cutPlans"));

const MAX_SHEET_UNITS = 600;
const MAX_BAR_UNITS = 5000;

const mm = z.coerce.number().positive().max(20000);
const optionalText = z.string().trim().max(500).nullable().optional();
const stockQty = z.coerce.number().int().min(1).max(10000).nullable().optional();

// ---------------------------------------------------------------------------
// Mosquiteiras (2026-10-16): medidas Largura × Altura × Quant. (lidas da OS ou
// escritas à mão) e regras de desconto — alturas descontam "x"; larguras até
// 1400 descontam "f" (perfil próprio) e acima de 1400 descontam "y" (outro
// perfil). Os valores são preenchidos pelo administrador no programa.
// ---------------------------------------------------------------------------

const mosquitoItem = z.object({
  width: mm,
  height: mm,
  qty: z.coerce.number().int().min(1).max(1000),
  finish: optionalText,
  os: z.string().trim().max(40).nullable().optional(), // nº da OS de onde vem
  client: optionalText,
});

const deduct = z.coerce.number().min(-500).max(2000).nullable();
const mosquitoRulesSchema = z.object({
  heightDeduct: deduct, // x
  widthLimit: z.coerce.number().positive().max(10000).default(1400),
  widthDeductSmall: deduct, // f (até ao limite, inclusive)
  widthDeductLarge: deduct, // y (acima do limite)
  heightsPerUnit: z.coerce.number().int().min(0).max(10).default(2),
  widthsPerUnit: z.coerce.number().int().min(0).max(10).default(1),
  heightProfile: z.string().trim().min(1).max(60).default("Guias (alturas)"),
  widthSmallProfile: z.string().trim().min(1).max(60).default("Largura até 1400"),
  widthLargeProfile: z.string().trim().min(1).max(60).default("Largura acima de 1400"),
});

const sheetInput = z.object({
  mode: z.literal("CHAPAS"),
  pieces: z
    .array(
      z.object({
        ref: z.string().trim().min(1).max(40),
        description: optionalText,
        width: mm,
        length: mm,
        qty: z.coerce.number().int().min(1).max(1000),
        rotate: z.boolean().default(true),
        bends: z.coerce.number().int().min(0).max(50).nullable().optional(),
        cornerCuts: z.coerce.number().int().min(0).max(50).nullable().optional(),
      })
    )
    .min(1, "Indica pelo menos uma peça.")
    .max(200),
  stock: z
    .array(z.object({ length: mm, width: mm, qty: stockQty }))
    .min(1, "Indica pelo menos um formato de chapa.")
    .max(20),
  settings: z.object({
    kerf: z.coerce.number().min(0).max(20).default(0),
    trim: z.coerce.number().min(0).max(100).default(0),
  }),
});

const barInput = z.object({
  mode: z.literal("BARRAS"),
  pieces: z
    .array(
      z.object({
        ref: z.string().trim().min(1).max(40),
        description: optionalText,
        length: mm,
        qty: z.coerce.number().int().min(1).max(5000),
        profile: z.string().trim().max(60).nullable().optional(),
        os: z.string().trim().max(40).nullable().optional(), // OS a que a peça pertence
      })
    )
    .min(1, "Indica pelo menos uma peça.")
    .max(200),
  stock: z
    .array(z.object({ length: mm, qty: stockQty }))
    .min(1, "Indica pelo menos um comprimento de barra.")
    .max(20),
  settings: z.object({
    kerf: z.coerce.number().min(0).max(20).default(3),
    trim: z.coerce.number().min(0).max(500).default(0),
    minRemnant: z.coerce.number().min(0).max(20000).default(500),
  }),
  // Mosquiteiras de onde saíram as peças (para se poder voltar a editar)
  mosquitos: z.array(mosquitoItem).max(300).optional(),
  mosquitoRules: z.lazy(() => mosquitoRulesSchema).optional(),
});

const inputSchema = z.discriminatedUnion("mode", [sheetInput, barInput]);
type CutInput = z.infer<typeof inputSchema>;

const planSchema = z.object({
  name: z.string().trim().min(1, "Dá um nome ao plano.").max(120),
  material: optionalText,
  notes: optionalText,
  serviceOrderId: z.string().nullable().optional(),
  serviceOrderRef: optionalText, // nº da OS escrito à mão
  input: inputSchema,
});

function compute(input: CutInput): CutResult {
  const units = input.pieces.reduce((a, p) => a + p.qty, 0);
  if (input.mode === "CHAPAS") {
    if (units > MAX_SHEET_UNITS) throw new Error(`Máximo de ${MAX_SHEET_UNITS} peças por plano de chapas.`);
    return optimizeSheets(input.pieces, input.stock, input.settings);
  }
  if (units > MAX_BAR_UNITS) throw new Error(`Máximo de ${MAX_BAR_UNITS} peças por plano de barras.`);
  return optimizeBars(input.pieces, input.stock, input.settings);
}

/** OS pelo nº completo ("2026/515") ou só pelo número ("515", a mais recente). */
async function findOrderByRef(ref: string) {
  const so = await prisma.serviceOrder.findFirst({ where: { externalId: { equals: ref, mode: "insensitive" } } });
  if (so || !/^\d+$/.test(ref)) return so;
  return prisma.serviceOrder.findFirst({ where: { externalId: { endsWith: `/${ref}` } }, orderBy: { createdAt: "desc" } });
}

async function resolveServiceOrder(id: string | null | undefined, ref: string | null | undefined) {
  if (id) {
    const so = await prisma.serviceOrder.findUnique({ where: { id } });
    if (!so) throw new Error("Ordem de Serviço não encontrada.");
    return so.id;
  }
  const r = ref?.trim();
  if (!r) return null;
  const so = await findOrderByRef(r);
  if (!so) throw new Error(`Não encontrei a OS "${r}".`);
  return so.id;
}

/**
 * OS ligadas ao plano: a principal (escolhida ou escrita) e as outras OS
 * indicadas nas peças/mosquiteiras (planos que juntam várias obras).
 */
async function linkedOrders(
  data: { serviceOrderId?: string | null; serviceOrderRef?: string | null; input: CutInput }
): Promise<{ mainId: string | null; extraIds: string[] }> {
  let mainId = await resolveServiceOrder(data.serviceOrderId, data.serviceOrderRef);
  const refs = new Set<string>();
  if (data.input.mode === "BARRAS") {
    data.input.pieces.forEach((p) => p.os?.trim() && refs.add(p.os.trim()));
    (data.input.mosquitos ?? []).forEach((m) => m.os?.trim() && refs.add(m.os.trim()));
  }
  const ids: string[] = [];
  for (const ref of refs) {
    const so = await findOrderByRef(ref);
    if (so && !ids.includes(so.id)) ids.push(so.id);
  }
  if (!mainId && ids.length) mainId = ids[0];
  return { mainId, extraIds: ids.filter((id) => id !== mainId) };
}

type PlanRow = { extraServiceOrderIds: string[] };

/** Junta a cada plano os dados das OS extra (nº e cliente). */
async function withExtras<T extends PlanRow>(plans: T[]) {
  const all = [...new Set(plans.flatMap((p) => p.extraServiceOrderIds))];
  const orders = all.length
    ? await prisma.serviceOrder.findMany({
        where: { id: { in: all } },
        select: { id: true, externalId: true, client: { select: { name: true } } },
      })
    : [];
  return plans.map((p) => ({
    ...p,
    extraServiceOrders: p.extraServiceOrderIds.map((id) => orders.find((o) => o.id === id)).filter(Boolean),
  }));
}

const INCLUDE = {
  serviceOrder: { select: { id: true, externalId: true, client: { select: { name: true } } } },
  createdBy: { select: { id: true, name: true } },
} as const;

function summary(totals: CutResult["totals"], mode: string) {
  return mode === "CHAPAS"
    ? `${(totals as { sheetsCount: number }).sheetsCount} chapa(s), aproveitamento ${totals.yieldPct}%`
    : `${(totals as { barsCount: number }).barsCount} barra(s), aproveitamento ${totals.yieldPct}%`;
}

// Pré-visualização: calcula sem gravar.
cutPlansRouter.post(
  "/optimize",
  requirePermission("cutPlans:read"),
  asyncHandler(async (req, res) => {
    res.json(compute(inputSchema.parse(req.body)));
  })
);

cutPlansRouter.get(
  "/",
  requirePermission("cutPlans:read"),
  asyncHandler(async (req, res) => {
    const where: Prisma.CutPlanWhereInput = {};
    if (typeof req.query.serviceOrderId === "string") {
      const id = req.query.serviceOrderId;
      where.OR = [{ serviceOrderId: id }, { extraServiceOrderIds: { has: id } }];
    }
    const plans = await withExtras(
      await prisma.cutPlan.findMany({ where, include: INCLUDE, orderBy: { createdAt: "desc" }, take: 300 })
    );
    // Na lista só vão os totais, não o desenho completo.
    res.json(
      plans.map(({ result, input, ...p }) => ({
        ...p,
        piecesTypes: (input as { pieces?: unknown[] })?.pieces?.length ?? 0,
        totals: (result as unknown as CutResult)?.totals ?? null,
        unplacedCount: ((result as unknown as CutResult)?.unplaced ?? []).reduce((a, u) => a + u.qty, 0),
      }))
    );
  })
);

const MOSQUITO_RULES_KEY = "mosquitoRules";

cutPlansRouter.get(
  "/mosquito-rules",
  requirePermission("cutPlans:read"),
  asyncHandler(async (req, res) => {
    const row = await prisma.appSetting.findUnique({ where: { key: MOSQUITO_RULES_KEY } });
    // Por mosquiteira: 2 alturas e 1 largura (corrigido pelo utilizador em
    // 2026-10-29: "largura é só uma unidade, as alturas é que é x2").
    const twoWidths = false;
    res.json(
      mosquitoRulesSchema.parse(
        row?.value ?? { heightDeduct: null, widthDeductSmall: null, widthDeductLarge: null, widthsPerUnit: twoWidths ? 2 : 1 }
      )
    );
  })
);

cutPlansRouter.put(
  "/mosquito-rules",
  requirePermission("cutPlans:write"),
  asyncHandler(async (req, res) => {
    const value = mosquitoRulesSchema.parse(req.body);
    await prisma.appSetting.upsert({
      where: { key: MOSQUITO_RULES_KEY },
      create: { key: MOSQUITO_RULES_KEY, value, updatedById: req.user?.id },
      update: { value, updatedById: req.user?.id },
    });
    res.json(value);
  })
);

/**
 * Lê as medidas das mosquiteiras de uma OS, a partir das características
 * vindas do Goldylocks ("Dimensões: Larg. 1393 x Alt. 1100" / "Quant.: 2,00").
 */
cutPlansRouter.get(
  "/os-measures",
  requirePermission("cutPlans:read"),
  asyncHandler(async (req, res) => {
    const ref = String(req.query.ref ?? "").trim();
    if (!ref) throw new Error("Indica o nº da OS.");
    let so = await prisma.serviceOrder.findFirst({
      where: { externalId: { equals: ref, mode: "insensitive" } },
      include: { client: { select: { name: true } }, product: { select: { name: true } } },
    });
    if (!so && /^\d+$/.test(ref)) {
      // aceita só o número (ex.: "515" para "2026/515"), escolhendo a mais recente
      so = await prisma.serviceOrder.findFirst({
        where: { externalId: { endsWith: `/${ref}` } },
        orderBy: { createdAt: "desc" },
        include: { client: { select: { name: true } }, product: { select: { name: true } } },
      });
    }
    if (!so) throw new Error(`Não encontrei a OS "${ref}".`);

    const items: { width: number; height: number; qty: number; finish: string | null }[] = [];
    const missing: string[] = [];

    // Leitura nova (medidasOS): também OS com um só artigo (sem "Artigo N —")
    // e medidas escritas à mão na OS.
    if (await canUseFeature("medidasOS", req.user)) {
      const text = so.specifications ?? "";
      const finish = text.match(/Acabamento:\s*(.+)/i)?.[1]?.trim() ?? null;
      for (const b of readSpecBlocks(text)) {
        const title = b.title ?? `${so.product.name}`;
        if (b.width && b.height) {
          items.push({ width: b.width, height: b.height, qty: Math.max(1, Math.round(b.qty ?? 1)), finish });
        } else {
          missing.push(title);
        }
      }
      return res.json({
        serviceOrder: { id: so.id, externalId: so.externalId, client: so.client, product: so.product },
        items,
        missing,
      });
    }

    const blocks = (so.specifications ?? "").split(/\n\s*\n/);
    for (const block of blocks) {
      if (!/Artigo/i.test(block) || /Valor Total/i.test(block)) continue;
      const dim = block.match(/Larg\.?\s*([\d.,]+)\s*[x×]\s*Alt\.?\s*([\d.,]+)/i);
      const title = block.split("\n")[0].trim();
      if (!dim) {
        missing.push(title);
        continue;
      }
      const num = (v: string) => Number(v.replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
      const qty = block.match(/Quant\.?:\s*([\d.,]+)/i);
      const finish = block.match(/Acabamento:\s*(.+)/i);
      items.push({
        width: num(dim[1]),
        height: num(dim[2]),
        qty: Math.max(1, Math.round(qty ? num(qty[1]) : 1)),
        finish: finish ? finish[1].trim() : null,
      });
    }
    res.json({
      serviceOrder: { id: so.id, externalId: so.externalId, client: so.client, product: so.product },
      items,
      missing,
    });
  })
);

cutPlansRouter.get(
  "/:id",
  requirePermission("cutPlans:read"),
  asyncHandler(async (req, res) => {
    const plan = await prisma.cutPlan.findUnique({ where: { id: req.params.id }, include: INCLUDE });
    if (!plan) throw new Error("Plano de corte não encontrado.");
    res.json((await withExtras([plan]))[0]);
  })
);

cutPlansRouter.post(
  "/",
  requirePermission("cutPlans:write"),
  asyncHandler(async (req, res) => {
    const data = planSchema.parse(req.body);
    const { mainId: serviceOrderId, extraIds } = await linkedOrders(data);
    const result = compute(data.input);
    const plan = await prisma.$transaction(async (tx) => {
      const created = await tx.cutPlan.create({
        data: {
          name: data.name,
          mode: data.input.mode,
          material: data.material || null,
          notes: data.notes || null,
          serviceOrderId,
          extraServiceOrderIds: extraIds,
          input: data.input as unknown as Prisma.InputJsonValue,
          result: result as unknown as Prisma.InputJsonValue,
          createdById: req.user?.id,
        },
        include: INCLUDE,
      });
      for (const soId of [serviceOrderId, ...extraIds].filter((x): x is string => !!x)) {
        await logHistoryEvent({
          tx,
          serviceOrderId: soId,
          type: "OUTRA_ALTERACAO",
          description: `Plano de corte PC-${created.number} "${created.name}": ${summary(result.totals, created.mode)}${
            extraIds.length ? ` (junta ${extraIds.length + 1} OS)` : ""
          }`,
          userId: req.user?.id,
          metadata: { cutPlanId: created.id },
        });
      }
      return created;
    });
    res.status(201).json((await withExtras([plan]))[0]);
  })
);

cutPlansRouter.put(
  "/:id",
  requirePermission("cutPlans:write"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.cutPlan.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new Error("Plano de corte não encontrado.");
    const data = planSchema.parse(req.body);
    const { mainId: serviceOrderId, extraIds } = await linkedOrders(data);
    const result = compute(data.input);
    const before = new Set([existing.serviceOrderId, ...existing.extraServiceOrderIds].filter(Boolean));
    const plan = await prisma.$transaction(async (tx) => {
      const updated = await tx.cutPlan.update({
        where: { id: existing.id },
        data: {
          name: data.name,
          mode: data.input.mode,
          material: data.material || null,
          notes: data.notes || null,
          serviceOrderId,
          extraServiceOrderIds: extraIds,
          input: data.input as unknown as Prisma.InputJsonValue,
          result: result as unknown as Prisma.InputJsonValue,
        },
        include: INCLUDE,
      });
      for (const soId of [serviceOrderId, ...extraIds].filter((x): x is string => !!x)) {
        await logHistoryEvent({
          tx,
          serviceOrderId: soId,
          type: "OUTRA_ALTERACAO",
          description: `Plano de corte PC-${updated.number} "${updated.name}" ${
            before.has(soId) ? "alterado" : "ligado a esta OS"
          }: ${summary(result.totals, updated.mode)}`,
          userId: req.user?.id,
          metadata: { cutPlanId: updated.id },
        });
      }
      return updated;
    });
    res.json((await withExtras([plan]))[0]);
  })
);

cutPlansRouter.delete(
  "/:id",
  requirePermission("cutPlans:write"),
  asyncHandler(async (req, res) => {
    await prisma.cutPlan.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);
