import { prisma } from "../config/prisma";
import { logHistoryEvent } from "../services/historyService";
import { GUIA_2026_170_P1, GUIA_2026_170_P2 } from "./guia20261030Images";

// ============================================================================
// Guia 2026/170 (Alumiasas), pedido do utilizador de 2026-10-30. As 7 OS já
// foram passadas para a Lacagem nesse dia; aqui só se anexa a guia (as duas
// fotografias) a cada uma. Corre no arranque e é seguro repetir: uma OS que
// já tenha o anexo não é tocada.
// ============================================================================

const ORDERS = ["2026/438", "2026/518", "2026/530", "2026/536", "2026/564", "2026/567", "2026/568"];
const FILES = [
  { filename: "Guia 2026-170 (1 de 2).jpg", data: GUIA_2026_170_P1 },
  { filename: "Guia 2026-170 (2 de 2).jpg", data: GUIA_2026_170_P2 },
];
const ADMIN_EMAIL = "joaocosta@minhoferragens.pt";

export async function attachGuia20261030(): Promise<void> {
  try {
    const admin = await prisma.user.findFirst({ where: { email: ADMIN_EMAIL }, select: { id: true } });
    for (const externalId of ORDERS) {
      const order = await prisma.serviceOrder.findUnique({ where: { externalId }, select: { id: true } });
      if (!order) continue;
      const existing = await prisma.attachment.count({
        where: { serviceOrderId: order.id, filename: FILES[0].filename },
      });
      if (existing > 0) continue;
      for (const f of FILES) {
        const data = Buffer.from(f.data, "base64");
        await prisma.attachment.create({
          data: {
            serviceOrderId: order.id,
            filename: f.filename,
            mimeType: "image/jpeg",
            size: data.length,
            data,
            uploadedById: admin?.id,
          },
        });
      }
      await logHistoryEvent({
        serviceOrderId: order.id,
        type: "OUTRA_ALTERACAO",
        description: "Anexada a guia 2026/170 da Lacagem (Alumiasas) — 2 fotografias.",
        userId: admin?.id,
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[guia 2026/170] falhou a anexar", err);
  }
}
