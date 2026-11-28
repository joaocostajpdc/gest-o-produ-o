import { Router } from "express";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";

// ============================================================================
// Área administrativa — dashboard de apoio à gestão (2026-11-26).
// Só acessível ao ADMINISTRADOR.
// ============================================================================

export const adminRouter = Router();
adminRouter.use(requireAuth);

function requireAdmin(req: Parameters<typeof requireAuth>[0], res: Parameters<typeof requireAuth>[1], next: Parameters<typeof requireAuth>[2]) {
  if (req.user?.role === "ADMINISTRADOR") return next();
  return res.status(403).json({ error: "Só o administrador pode aceder a esta área." });
}

adminRouter.get(
  "/stats",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1);
    const inicioAno = new Date(now.getFullYear(), 0, 1);
    const ha12Meses = new Date(now.getFullYear() - 1, now.getMonth(), 1);

    const [
      osStatus,
      osMes,
      utilizadoresAtivos,
      totalClientes,
      totalImportacoes,
      vendasMensais,
      topClientes,
      importacoesRecentes,
      featuresStatus,
    ] = await Promise.all([
      // OS por status
      prisma.serviceOrder.groupBy({
        by: ["status"],
        _count: { id: true },
      }),

      // OS criadas este mês
      prisma.serviceOrder.count({ where: { createdAt: { gte: inicioMes } } }),

      // Utilizadores ativos
      prisma.user.count({ where: { active: true } }),

      // Total clientes
      prisma.client.count(),

      // Total importações
      prisma.salesImport.count(),

      // Vendas mensais dos últimos 12 meses
      prisma.$queryRaw<{ mes: Date; kind: string; num_docs: number; total: number }[]>`
        SELECT
          DATE_TRUNC('month', date) as mes,
          kind,
          COUNT(DISTINCT "docNumber")::int as num_docs,
          ROUND(SUM(net)::numeric, 2)::float as total
        FROM sales_documents
        WHERE date >= ${ha12Meses}
        GROUP BY mes, kind
        ORDER BY mes ASC, kind
      `,

      // Top 10 clientes por encomendas (últimos 12 meses)
      prisma.$queryRaw<{ cliente: string; num_docs: number; total: number }[]>`
        SELECT
          COALESCE("clientName", 'Sem nome') as cliente,
          COUNT(DISTINCT "docNumber")::int as num_docs,
          ROUND(SUM(net)::numeric, 2)::float as total
        FROM sales_documents
        WHERE kind = 'ENCOMENDAS'
          AND date >= ${ha12Meses}
        GROUP BY "clientName"
        ORDER BY total DESC
        LIMIT 10
      `,

      // Importações recentes
      prisma.salesImport.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          filename: true,
          kind: true,
          count: true,
          totalNet: true,
          createdAt: true,
        },
      }),

      // Features lançadas
      prisma.featureRelease.findMany({
        select: { key: true, released: true, releasedAt: true },
        orderBy: { key: "asc" },
      }),
    ]);

    // KPIs de OS
    const statusMap: Record<string, number> = {};
    for (const row of osStatus) {
      statusMap[row.status] = row._count.id;
    }
    const totalOS = Object.values(statusMap).reduce((a, b) => a + b, 0);

    // Totais de faturação este ano
    const faturacaoAnoRows = await prisma.$queryRaw<{ total: number }[]>`
      SELECT ROUND(SUM(net)::numeric, 2)::float as total
      FROM sales_documents
      WHERE kind = 'FATURACAO' AND date >= ${inicioAno}
    `;
    const encomendasAnoRows = await prisma.$queryRaw<{ total: number }[]>`
      SELECT ROUND(SUM(net)::numeric, 2)::float as total
      FROM sales_documents
      WHERE kind = 'ENCOMENDAS' AND date >= ${inicioAno}
    `;

    res.json({
      kpis: {
        totalOS,
        osEmCurso: (statusMap["EM_PRODUCAO"] ?? 0) + (statusMap["NAO_INICIADA"] ?? 0),
        osSuspensas: statusMap["SUSPENSA"] ?? 0,
        osMes,
        utilizadoresAtivos,
        totalClientes,
        totalImportacoes,
        faturacaoAno: faturacaoAnoRows[0]?.total ?? 0,
        encomendasAno: encomendasAnoRows[0]?.total ?? 0,
      },
      osStatus: statusMap,
      vendasMensais,
      topClientes,
      importacoesRecentes,
      featuresStatus,
    });
  })
);
