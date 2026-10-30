import { prisma } from "../config/prisma";
import { importSalesMap, ParsedMap, SalesKind } from "../services/objetivosService";
import { ENCOMENDAS_2026_10, FATURAS_2026_10 } from "./objetivos20261030Dados";

// ============================================================================
// Objetivos de faturação indicados pelo utilizador a 2026-10-30: "objetivo
// este mês é de 35000, para o próximo é de 40000" (outubro e novembro de
// 2026). Corre no arranque; só cria o objetivo se ainda não existir, para não
// apagar um valor mudado depois na página.
// ============================================================================

const TARGETS = [
  { kind: "FATURACAO", periodType: "MES", year: 2026, period: 10, value: 35000 },
  { kind: "FATURACAO", periodType: "MES", year: 2026, period: 11, value: 40000 },
];

export async function objetivos20261030(): Promise<void> {
  try {
    for (const t of TARGETS) {
      const exists = await prisma.businessTarget.findUnique({
        where: { kind_periodType_year_period: { kind: t.kind, periodType: t.periodType, year: t.year, period: t.period } },
      });
      if (!exists) await prisma.businessTarget.create({ data: t });
    }
    // Mapas de outubro enviados nesse dia: carregados só se ainda não houver
    // nenhuma importação desse tipo (depois disso manda o botão Importar).
    const admin = await prisma.user.findFirst({ where: { email: "joaocosta@minhoferragens.pt" }, select: { id: true } });
    const maps: [SalesKind, { from: string; to: string; reportedTotalNet: number | null; docs: any[][] }, string][] = [
      ["FATURACAO", FATURAS_2026_10, "Totais de vendas por dia 2026-10 (faturas).pdf"],
      ["ENCOMENDAS", ENCOMENDAS_2026_10, "Relatório encomendas cliente 2026-10.pdf"],
    ];
    for (const [kind, data, filename] of maps) {
      if ((await prisma.salesImport.count({ where: { kind } })) > 0) continue;
      const map: ParsedMap = {
        title: filename,
        documentFilter: null,
        from: data.from,
        to: data.to,
        reportedTotalNet: data.reportedTotalNet,
        docs: data.docs.map((d: any[]) => ({
          date: d[0], docType: d[1], docNumber: d[2], clientCode: d[3], clientName: d[4],
          gross: d[5], net: d[6], tax: d[7], total: d[8],
        })),
      };
      const r = await importSalesMap(kind, map, filename, admin?.id);
      // eslint-disable-next-line no-console
      console.log(`[objetivos 2026-10-30] ${kind}: ${r.count} documentos, ${r.totalNet} € sem IVA`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[objetivos 2026-10-30] falhou", err);
  }
}
