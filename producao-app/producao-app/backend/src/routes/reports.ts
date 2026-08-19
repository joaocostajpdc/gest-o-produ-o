import { Router } from "express";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { asyncHandler } from "../utils/asyncHandler";
import { comparePriority, computePriority, PRIORITY_COLORS, PRIORITY_LABELS } from "../services/priorityService";
import { streamServiceOrdersPdf } from "../services/pdfReportService";

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
    const { status, stageId, supplierId, clientId, priority, format } = req.query;

    const where: any = {};
    if (status) where.status = String(status);
    if (clientId) where.clientId = String(clientId);
    if (stageId || supplierId) {
      where.currentStageInstance = {
        ...(stageId ? { stageId: String(stageId) } : {}),
        ...(supplierId ? { supplierId: String(supplierId) } : {}),
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

    const now = new Date();
    let rows = orders.map((o) => {
      const p = computePriority(o.deadlineAt, o.status, now);
      return {
        externalId: o.externalId,
        cliente: o.client.name,
        produto: o.product.name,
        estado: o.status,
        etapaAtual: o.currentStageInstance?.stage.name ?? "-",
        prazo: o.deadlineAt ? o.deadlineAt.toISOString() : "-",
        prioridade: p ? PRIORITY_LABELS[p] : "-",
        _priority: p,
        _deadline: o.deadlineAt,
      };
    });

    if (priority) rows = rows.filter((r) => r._priority === String(priority));
    rows.sort((a, b) => comparePriority({ priority: a._priority, deadlineAt: a._deadline }, { priority: b._priority, deadlineAt: b._deadline }));
    const cleanRows = rows.map(({ _priority, _deadline, ...rest }) => rest);

    if (format === "csv") {
      const header = Object.keys(cleanRows[0] ?? { externalId: "", cliente: "", produto: "", estado: "", etapaAtual: "", prazo: "", prioridade: "" });
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
      if (status) filterParts.push(`Estado: ${STATUS_LABELS[String(status)] ?? String(status)}`);
      if (priority) filterParts.push(`Prioridade: ${PRIORITY_LABELS[String(priority) as keyof typeof PRIORITY_LABELS]}`);
      const filtersSummary = filterParts.length ? filterParts.join(" · ") : "Sem filtros aplicados";

      const pdfRows = rows.map((r) => ({
        externalId: r.externalId,
        cliente: r.cliente,
        produto: r.produto,
        estado: STATUS_LABELS[r.estado] ?? r.estado,
        etapaAtual: r.etapaAtual,
        prazo: r.prazo,
        prioridade: r.prioridade,
        prioridadeNivel: r._priority,
      }));

      return streamServiceOrdersPdf(res, pdfRows, filtersSummary);
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
