import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import {
  buildOrderMessage,
  discoverChats,
  getBotInfo,
  getTelegramSettings,
  maskToken,
  saveTelegramSettings,
  sendTelegramMessage,
  telegramSettingsSchema,
} from "../services/telegramService";
import { prisma } from "../config/prisma";

// ============================================================================
// Configuração dos avisos por Telegram (2026-10-17) — só o ADMINISTRADOR.
// ============================================================================

export const telegramRouter = Router();
telegramRouter.use(requireAuth);
telegramRouter.use((req, res, next) => {
  if (req.user?.role !== "ADMINISTRADOR") {
    return res.status(403).json({ error: "Só o administrador configura os avisos por Telegram." });
  }
  next();
});

function present(s: Awaited<ReturnType<typeof getTelegramSettings>>) {
  const { botToken, ...rest } = s;
  return { ...rest, hasToken: !!botToken, tokenMasked: maskToken(botToken) };
}

telegramRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(present(await getTelegramSettings()));
  })
);

const updateSchema = telegramSettingsSchema.partial().extend({
  // token novo (vazio/omitido = manter o atual)
  botToken: z.string().trim().max(200).optional(),
});

telegramRouter.put(
  "/",
  asyncHandler(async (req, res) => {
    const current = await getTelegramSettings();
    const data = updateSchema.parse(req.body);
    const next = { ...current, ...data, events: { ...current.events, ...(data.events ?? {}) } };
    if (data.botToken !== undefined && data.botToken !== "") {
      // token novo: confirmar que funciona antes de gravar
      const bot = await getBotInfo(data.botToken);
      next.botToken = data.botToken;
      next.botName = bot.username;
      if (data.botToken !== current.botToken) next.chats = data.chats ?? [];
    } else {
      next.botToken = current.botToken;
    }
    if (next.enabled && !next.botToken) throw new Error("Indica o token do bot antes de ligar os avisos.");
    await saveTelegramSettings(telegramSettingsSchema.parse(next), req.user?.id);
    res.json(present(await getTelegramSettings()));
  })
);

telegramRouter.post(
  "/discover",
  asyncHandler(async (_req, res) => {
    const s = await getTelegramSettings();
    res.json(await discoverChats(s.botToken));
  })
);

telegramRouter.post(
  "/test",
  asyncHandler(async (req, res) => {
    const s = await getTelegramSettings();
    const { chatId } = z.object({ chatId: z.string().optional() }).parse(req.body ?? {});
    const chats = chatId ? s.chats.filter((c) => c.id === chatId) : s.chats;
    if (!chats.length) throw new Error("Escolhe pelo menos uma conversa.");

    // Exemplo com a OS mais recente, para se ver como fica a mensagem.
    const last = await prisma.serviceOrder.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } });
    const sample = last ? await buildOrderMessage(last.id, "created", req.user?.id) : null;
    const html = `🔔 <b>Teste dos avisos do programa de produção</b>\nOs avisos vão chegar assim:\n\n${sample ?? "(ainda não há OS)"}`;

    const results = await Promise.all(
      chats.map(async (c) => {
        try {
          await sendTelegramMessage(s.botToken, c.id, html);
          return { id: c.id, title: c.title, ok: true };
        } catch (err) {
          return { id: c.id, title: c.title, ok: false, error: (err as Error).message };
        }
      })
    );
    res.json(results);
  })
);
