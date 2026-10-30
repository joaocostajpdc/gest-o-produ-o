import express, { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { requireFeature } from "../config/featureReleases";
import { asyncHandler } from "../utils/asyncHandler";
import { getSummary, importSalesMap, listTargets, parseSalesMapPdf, setTarget } from "../services/objetivosService";

// ============================================================================
// Objetivos de negócio (2026-10-30). Ver objetivosService.ts. Em teste:
// "objetivos". Todos os que têm a funcionalidade veem os números; importar os
// mapas e definir os objetivos é só para o administrador.
// ============================================================================

export const objetivosRouter = Router();
objetivosRouter.use(requireAuth, requireFeature("objetivos"));

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.user?.role === "ADMINISTRADOR") return next();
  return res.status(403).json({ error: "Só o administrador pode fazer isto." });
}

const kindSchema = z.enum(["FATURACAO", "ENCOMENDAS"]);
const periodTypeSchema = z.enum(["MES", "TRIMESTRE", "ANO"]);

const summaryQuery = z.object({
  periodType: periodTypeSchema.default("MES"),
  year: z.coerce.number().int().min(2020).max(2100),
  period: z.coerce.number().int().min(1).max(12).default(1),
});
objetivosRouter.get(
  "/resumo",
  asyncHandler(async (req, res) => {
    const q = summaryQuery.parse(req.query);
    res.json(await getSummary(q.periodType, q.year, q.period));
  })
);

// Pré-visualização: lê o PDF e mostra o que encontrou, sem gravar.
objetivosRouter.post(
  "/ler-mapa",
  requireAdmin,
  express.raw({ type: "application/pdf", limit: "25mb" }),
  asyncHandler(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: "Nenhum PDF recebido." });
    const map = await parseSalesMapPdf(req.body);
    const dates = map.docs.map((d) => d.date).sort();
    res.json({
      detectedKind: map.detectedKind,
      from: map.from ?? dates[0] ?? null,
      to: map.to ?? dates[dates.length - 1] ?? null,
      count: map.docs.length,
      totalNet: Math.round(map.docs.reduce((a, d) => a + d.net, 0) * 100) / 100,
      reportedTotalNet: map.reportedTotalNet,
    });
  })
);

objetivosRouter.post(
  "/importar",
  requireAdmin,
  express.raw({ type: "application/pdf", limit: "25mb" }),
  asyncHandler(async (req, res) => {
    const kind = kindSchema.parse(req.query.kind);
    const filename = typeof req.query.filename === "string" ? req.query.filename.slice(0, 200) : null;
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: "Nenhum PDF recebido." });
    const map = await parseSalesMapPdf(req.body);
    if (map.detectedKind && map.detectedKind !== kind) {
      return res.status(400).json({
        error:
          map.detectedKind === "ENCOMENDAS"
            ? "Este PDF tem encomendas cliente, não faturas. Usa \"Importar encomendas\"."
            : "Este PDF tem faturas, não encomendas cliente. Usa \"Importar faturas\".",
      });
    }
    try {
      res.json(await importSalesMap(kind, map, filename, req.user?.id));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Não foi possível importar o mapa." });
    }
  })
);

objetivosRouter.get(
  "/metas",
  asyncHandler(async (req, res) => {
    const year = z.coerce.number().int().min(2020).max(2100).parse(req.query.year);
    res.json(await listTargets(year));
  })
);

const targetSchema = z.object({
  kind: kindSchema,
  periodType: periodTypeSchema,
  year: z.number().int().min(2020).max(2100),
  period: z.number().int().min(1).max(12),
  value: z.number().min(0).max(1e9).nullable(),
});
objetivosRouter.put(
  "/metas",
  requireAdmin,
  express.json(),
  asyncHandler(async (req, res) => {
    const t = targetSchema.parse(req.body);
    res.json(await setTarget(t.kind, t.periodType, t.year, t.period, t.value));
  })
);
