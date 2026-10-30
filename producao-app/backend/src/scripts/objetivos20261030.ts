import { prisma } from "../config/prisma";

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
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[objetivos 2026-10-30] falhou", err);
  }
}
