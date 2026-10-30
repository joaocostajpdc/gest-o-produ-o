import { prisma } from "../config/prisma";
import { logHistoryEvent } from "../services/historyService";
import { GUIA_2026_171_PDF } from "./guia20261030bPdf";

// ============================================================================
// Guia 2026/171 (Alumiasas), pedido do utilizador de 2026-10-30: "põe esta na
// lacagem". As OS 2026/505, 2026/559 e 2026/560 já foram passadas para a
// Lacagem (Alumiasas) nesse dia; aqui só se anexa o PDF da guia a cada uma.
// Corre no arranque e é seguro repetir: uma OS que já tenha o anexo não é
// tocada.
// ============================================================================

const ORDERS = ["2026/505", "2026/559", "2026/560"];
const FILENAME = "Guia 2026-171.pdf";
const ADMIN_EMAIL = "joaocosta@minhoferragens.pt";

export async function attachGuia20261030b(): Promise<void> {
  try {
    const admin = await prisma.user.findFirst({ where: { email: ADMIN_EMAIL }, select: { id: true } });
    const data = Buffer.from(GUIA_2026_171_PDF, "base64");
    for (const externalId of ORDERS) {
      const order = await prisma.serviceOrder.findUnique({ where: { externalId }, select: { id: true } });
      if (!order) continue;
      const existing = await prisma.attachment.count({ where: { serviceOrderId: order.id, filename: FILENAME } });
      if (existing > 0) continue;
      await prisma.attachment.create({
        data: {
          serviceOrderId: order.id,
          filename: FILENAME,
          mimeType: "application/pdf",
          size: data.length,
          data,
          uploadedById: admin?.id,
        },
      });
      await logHistoryEvent({
        serviceOrderId: order.id,
        type: "OUTRA_ALTERACAO",
        description: "Anexada a guia 2026/171 da Lacagem (Alumiasas) — PDF.",
        userId: admin?.id,
      });
      // eslint-disable-next-line no-console
      console.log(`[guia 2026/171] anexada à OS ${externalId}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[guia 2026/171] falhou a anexar", err);
  }
}
