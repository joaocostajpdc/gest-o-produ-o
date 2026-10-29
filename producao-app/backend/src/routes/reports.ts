import { Router } from "express";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { asyncHandler } from "../utils/asyncHandler";
import { comparePriority, computePriority, PRIORITY_COLORS, PRIORITY_LABELS } from "../services/priorityService";
import { streamServiceOrdersPdf } from "../services/pdfReportService";
import { canUseFeature } from "../config/featureReleases";

// Acabamento(s) de uma OS, a partir das Características do Produto (uma linha
// "Acabamento:" por artigo; repetidos só aparecem uma vez).
function acabamentoOf(spec: string | null | undefined): string {
  const vals = [...(spec ?? "").matchAll(/^Acabamento:\s*(.+)$/gim)].map((m) => m[1].trim().replace(/[;,]\s*$/, "")).filter(Boolean);
  return [...new Set(vals)].join(", ") || "-";
}

// ============================================================================
// Listagens Imprimíveis
//
// Gera listagens de Ordens de Serviço com base nos filtros aplicados,
// devolvendo apenas a informação relevante para o contexto selecionado
// (reuniões de acompanhamento, planeamento diário, distribuição entre
// setores, consulta offline). Suporta JSON (para a UI) e CSV (para impressão
// / partilha fora da aplicação).
// ============================================================================

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

reportsRouter.get(
  "/service-orders",
  requirePermission("reports:printable"),
  asyncHandler(async (req, res) => {
    const { status, stageId, supplierId, clientId, priority, category, search, format } = req.query;

    // Vários valores no mesmo filtro, separados por vírgula (pedido do
    // utilizador de 2026-10-29: "selecionar dentro do mesmo filtro várias
    // coisas"). Um só valor continua a funcionar como antes.
    const list = (v: unknown): string[] =>
      v == null || v === "" ? [] : String(v).split(",").map((x) => x.trim()).filter(Boolean);
    const one = (vals: string[]) => (vals.length === 1 ? vals[0] : { in: vals });
    const statuses = list(status);
    const clientIds = list(clientId);
    const categories = list(category);
    const stageIds = list(stageId);
    const supplierIds = list(supplierId);
    const priorities = list(priority);

    const where: any = {};
    if (statuses.length) where.status = one(statuses);
    if (clientIds.length) where.clientId = one(clientIds);
    // Mesmos filtros de categoria e pesquisa livre (OS, cliente, número de
    // cliente, produto) da listagem principal de Ordens de Serviço, para que
    // esta listagem imprimível possa refletir exatamente a mesma seleção.
    if (categories.length) where.product = { category: one(categories) };
    if (search) {
      where.OR = [
        { externalId: { contains: String(search), mode: "insensitive" } },
        { client: { name: { contains: String(search), mode: "insensitive" } } },
        { client: { externalId: { contains: String(search), mode: "insensitive" } } },
        { product: { name: { contains: String(search), mode: "insensitive" } } },
      ];
    }
    if (stageIds.length || supplierIds.length) {
      where.currentStageInstance = {
        ...(stageIds.length ? { stageId: one(stageIds) } : {}),
        ...(supplierIds.length ? { supplierId: one(supplierIds) } : {}),
      };
    }

    const orders = await prisma.serviceOrder.findMany({
      where,
      include: {
        client: true,
        product: true,
        currentStageInstance: { include: { stage: true } },
      },
    });

    // Coluna Acabamento (pedido do utilizador de 2026-10-29) — em teste,
    // "listagemAcabamento" (só o administrador até ele aprovar).
    const withAcab = await canUseFeature("listagemAcabamento", req.user);
    const now = new Date();
    let rows = orders.map((o) => {
      const p = computePriority(o.deadlineAt, o.status, now);
      return {
        externalId: o.externalId,
        cliente: o.client.name,
        produto: o.product.name,
        ...(withAcab ? { acabamento: acabamentoOf(o.specifications) } : {}),
        estado: o.status,
        etapaAtual: o.currentStageInstance?.stage.name ?? "-",
        prazo: o.deadlineAt ? o.deadlineAt.toISOString() : "-",
        prioridade: p ? PRIORITY_LABELS[p] : "-",
        _priority: p,
        _deadline: o.deadlineAt,
      };
    });

    if (priorities.length) rows = rows.filter((r) => r._priority != null && priorities.includes(r._priority));
    rows.sort((a, b) => comparePriority({ priority: a._priority, deadlineAt: a._deadline }, { priority: b._priority, deadlineAt: b._deadline }));
    const cleanRows = rows.map(({ _priority, _deadline, ...rest }) => rest);

    if (format === "csv") {
      const header = Object.keys(cleanRows[0] ?? { externalId: "", cliente: "", produto: "", ...(withAcab ? { acabamento: "" } : {}), estado: "", etapaAtual: "", prazo: "", prioridade: "" });
      const csv = [
        header.join(";"),
        ...cleanRows.map((row) => header.map((h) => `"${String((row as any)[h] ?? "").replace(/"/g, '""')}"`).join(";")),
      ].join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="listagem-ordens-servico.csv"');
      return res.send(csv);
    }

    if (format === "pdf") {
      const STATUS_LABELS: Record<string, string> = {
        NAO_INICIADA: "Não iniciada",
        EM_PRODUCAO: "Em produção",
        SUSPENSA: "Suspensa",
        CONCLUIDA: "Concluída",
        CANCELADA: "Cancelada",
      };
      const filterParts: string[] = [];
      if (statuses.length) filterParts.push(`Estado: ${statuses.map((x) => STATUS_LABELS[x] ?? x).join(", ")}`);
      if (priorities.length)
        filterParts.push(`Prioridade: ${priorities.map((x) => PRIORITY_LABELS[x as keyof typeof PRIORITY_LABELS] ?? x).join(", ")}`);
      if (categories.length) filterParts.push(`Categoria: ${categories.join(", ")}`);
      if (search) filterParts.push(`Pesquisa: "${String(search)}"`);
      const filtersSummary = filterParts.length ? filterParts.join(" · ") : "Sem filtros aplicados";

      const pdfRows = rows.map((r) => ({
        externalId: r.externalId,
        cliente: r.cliente,
        produto: r.produto,
        acabamento: (r as { acabamento?: string }).acabamento,
        estado: STATUS_LABELS[r.estado] ?? r.estado,
        etapaAtual: r.etapaAtual,
        prazo: r.prazo,
        prioridade: r.prioridade,
        prioridadeNivel: r._priority,
      }));

      return streamServiceOrdersPdf(res, pdfRows, filtersSummary, { acabamento: withAcab });
    }

    // Resposta JSON (usada pela UI): inclui o nível e a cor de prioridade,
    // para desenhar o mesmo badge colorido usado no resto da aplicação.
    const jsonRows = rows.map(({ _priority, _deadline, ...rest }) => ({
      ...rest,
      prioridadeNivel: _priority,
      prioridadeCor: _priority ? PRIORITY_COLORS[_priority] : null,
    }));
    res.json(jsonRows);
  })
);
