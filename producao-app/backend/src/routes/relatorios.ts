import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireFeature } from "../config/featureReleases";
import { asyncHandler } from "../utils/asyncHandler";
import { buildProductionReport, currentMonthRange, currentWeekRange } from "../services/productionReportService";
import { productionReportPdf } from "../services/productionReportPdf";

// ============================================================================
// Relatórios de gestão (pedido de 2026-10-26: "para melhorar a gestão quero
// ter acesso a um relatório da produção e a tudo o que se passa").
// Acesso restrito: administrador e quem ele escolher (feature "relatorios").
// ============================================================================

export const relatoriosRouter = Router();
relatoriosRouter.use(requireAuth);
relatoriosRouter.use(requireFeature("relatorios"));

const isIso = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

function period(q: Record<string, unknown>) {
  if (isIso(q.from) && isIso(q.to)) {
    const [from, to] = q.from <= q.to ? [q.from, q.to] : [q.to, q.from];
    const days = (Date.parse(to) - Date.parse(from)) / 86400000;
    if (days > 400) throw new Error("Escolhe um período até um ano.");
    return { from, to };
  }
  return q.periodo === "mes" ? currentMonthRange() : currentWeekRange();
}

relatoriosRouter.get(
  "/producao",
  asyncHandler(async (req, res) => {
    const { from, to } = period(req.query);
    res.json(await buildProductionReport(from, to));
  })
);

relatoriosRouter.get(
  "/producao/pdf",
  asyncHandler(async (req, res) => {
    const { from, to } = period(req.query);
    const { pdf, file } = await productionReportPdf(from, to);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${file}"`);
    res.send(pdf);
  })
);
