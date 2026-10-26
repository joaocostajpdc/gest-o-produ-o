import crypto from "crypto";
import { prisma } from "../config/prisma";
import { getTelegramSettings, sendTelegramMessage } from "../services/telegramService";

// ============================================================================
// Aviso geral por Telegram — pedido do utilizador de 2026-10-26: "manda
// mensagem a todos no Telegram a avisar" (fim da atualização de segurança).
//
// Se a variável de ambiente TELEGRAM_ANNOUNCE tiver texto, no arranque envia
// esse texto (HTML do Telegram) a todas as conversas configuradas nos avisos.
// Cada texto só é enviado uma vez: fica guardado um registo, por isso
// reinícios ou novos deploys não repetem a mensagem.
// ============================================================================

const LAST_KEY = "telegram_announce_last";

export async function announceTelegram() {
  const text = process.env.TELEGRAM_ANNOUNCE?.trim();
  if (!text) return;
  try {
    const hash = crypto.createHash("sha256").update(text).digest("hex");
    const last = await prisma.appSetting.findUnique({ where: { key: LAST_KEY } });
    if ((last?.value as { hash?: string } | null)?.hash === hash) return;

    const s = await getTelegramSettings();
    if (!s.botToken || !s.chats.length) {
      // eslint-disable-next-line no-console
      console.warn("[aviso telegram] sem bot ou sem conversas configuradas — nada enviado");
      return;
    }

    const results = await Promise.all(
      s.chats.map(async (c) => {
        try {
          await sendTelegramMessage(s.botToken, c.id, text);
          return `${c.title}: ok`;
        } catch (err) {
          return `${c.title}: ERRO ${(err as Error).message}`;
        }
      })
    );
    // eslint-disable-next-line no-console
    console.log(`[aviso telegram] enviado — ${results.join(" | ")}`);

    const value = { hash, sentAt: new Date().toISOString() };
    await prisma.appSetting.upsert({
      where: { key: LAST_KEY },
      create: { key: LAST_KEY, value },
      update: { value },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[aviso telegram] falhou", err);
  }
}
