import { z } from "zod";
import { prisma } from "../config/prisma";
import { PUBLIC_APP_URL } from "../config/publicUrl";

// ============================================================================
// Avisos por Telegram (pedido do utilizador de 2026-10-17: "quero que quando
// seja lançada uma ordem de serviço seja enviada uma mensagem por telegram, e
// terminada também").
//
// Um bot do Telegram (criado no @BotFather) envia uma mensagem para as
// conversas escolhidas — pessoas que escreveram ao bot ou grupos onde o bot
// foi adicionado — quando:
//   - uma OS é lançada (importada do Goldylocks / PDF);
//   - uma OS é concluída (saída da última etapa);
//   - (opcional, desligado por omissão) a produção de uma OS é iniciada.
//
// A configuração fica em app_settings (chave "telegram") e só o administrador
// a vê e muda. O token do bot nunca é devolvido inteiro ao browser.
// Os avisos são enviados depois de a operação estar gravada e nunca a fazem
// falhar: se o Telegram não responder, fica só um registo no log do servidor.
// ============================================================================

export const TELEGRAM_KEY = "telegram";

export const telegramSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().trim().max(200).default(""),
  botName: z.string().trim().max(100).nullable().optional(),
  chats: z
    .array(z.object({ id: z.string().trim().min(1).max(40), title: z.string().trim().max(120) }))
    .max(20)
    .default([]),
  events: z
    .object({
      created: z.boolean().default(true),
      started: z.boolean().default(false),
      completed: z.boolean().default(true),
    })
    .prefault({}),
});

export type TelegramSettings = z.infer<typeof telegramSettingsSchema>;

export async function getTelegramSettings(): Promise<TelegramSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: TELEGRAM_KEY } });
  return telegramSettingsSchema.parse(row?.value ?? {});
}

export async function saveTelegramSettings(value: TelegramSettings, userId?: string) {
  await prisma.appSetting.upsert({
    where: { key: TELEGRAM_KEY },
    create: { key: TELEGRAM_KEY, value, updatedById: userId },
    update: { value, updatedById: userId },
  });
}

/** Token escondido para mostrar no ecrã (ex.: "123456:••••••wxyz"). */
export function maskToken(token: string) {
  if (!token) return "";
  const [id, secret = ""] = token.split(":");
  return `${id}:••••••${secret.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// API do Telegram
// ---------------------------------------------------------------------------

async function callTelegram<T>(token: string, method: string, body?: Record<string, unknown>): Promise<T> {
  if (!token) throw new Error("Falta o token do bot.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as { ok: boolean; result?: T; description?: string } | null;
    if (!data?.ok) {
      const d = data?.description ?? `HTTP ${res.status}`;
      if (res.status === 401 || /unauthorized/i.test(d)) throw new Error("Token do bot inválido.");
      if (/chat not found/i.test(d)) throw new Error("Conversa não encontrada — a pessoa tem de escrever primeiro ao bot.");
      if (/bot was blocked/i.test(d)) throw new Error("O bot foi bloqueado nessa conversa.");
      if (/bot was kicked|not a member/i.test(d)) throw new Error("O bot já não está nesse grupo.");
      throw new Error(`Telegram: ${d}`);
    }
    return data.result as T;
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new Error("O Telegram não respondeu a tempo.");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function getBotInfo(token: string) {
  return callTelegram<{ id: number; username: string; first_name: string }>(token, "getMe");
}

/**
 * Conversas que falaram com o bot recentemente (pessoas que lhe enviaram uma
 * mensagem, ou grupos onde foi adicionado). O Telegram só guarda as
 * últimas ~24 h de mensagens por ler.
 */
export async function discoverChats(token: string) {
  type Chat = { id: number; type: string; title?: string; first_name?: string; last_name?: string; username?: string };
  type Update = Record<string, { chat?: Chat } | undefined> & { my_chat_member?: { chat: Chat } };
  const updates = await callTelegram<Update[]>(token, "getUpdates", { limit: 100, timeout: 0 });
  const found = new Map<string, { id: string; title: string; type: string }>();
  for (const u of updates) {
    const chat =
      u.message?.chat ?? u.channel_post?.chat ?? u.my_chat_member?.chat ?? u.edited_message?.chat ?? u.chat_member?.chat;
    if (!chat) continue;
    const title =
      chat.title ?? ([chat.first_name, chat.last_name].filter(Boolean).join(" ") || (chat.username ? `@${chat.username}` : String(chat.id)));
    found.set(String(chat.id), { id: String(chat.id), title, type: chat.type });
  }
  return [...found.values()];
}

/** Envia um ficheiro (ex.: PDF) para uma conversa, com uma legenda curta em HTML. */
export async function sendTelegramDocument(token: string, chatId: string, file: Buffer, filename: string, caption: string) {
  if (!token) throw new Error("Falta o token do bot.");
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption.slice(0, 1000));
  form.append("parse_mode", "HTML");
  form.append("document", new Blob([new Uint8Array(file)], { type: "application/pdf" }), filename);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form, signal: controller.signal });
    const data = (await res.json().catch(() => null)) as { ok: boolean; description?: string } | null;
    if (!data?.ok) {
      const d = data?.description ?? `HTTP ${res.status}`;
      if (res.status === 401 || /unauthorized/i.test(d)) throw new Error("Token do bot inválido.");
      if (/chat not found/i.test(d)) throw new Error("Conversa não encontrada — a pessoa tem de escrever primeiro ao bot.");
      throw new Error(`Telegram: ${d}`);
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new Error("O Telegram não respondeu a tempo.");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function sendTelegramMessage(token: string, chatId: string, html: string) {
  await callTelegram(token, "sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

// ---------------------------------------------------------------------------
// Avisos das Ordens de Serviço
// ---------------------------------------------------------------------------

export type OrderEvent = "created" | "started" | "completed";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const fmtDate = (d: Date) =>
  d.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Lisbon" });

function fmtMinutes(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d} d ${rh} h` : `${d} d`;
}

/** Dias de calendário entre duas datas (em Lisboa), positivos se b é depois de a. */
function dayDiff(a: Date, b: Date) {
  const day = (d: Date) => {
    const [y, m, dd] = d.toLocaleDateString("en-CA", { timeZone: "Europe/Lisbon" }).split("-").map(Number);
    return Date.UTC(y, m - 1, dd) / 86400000;
  };
  return day(b) - day(a);
}

/** Primeiras linhas úteis das características da OS (modelo, medidas, acabamento). */
function shortSpecs(specs: string | null) {
  if (!specs) return [];
  return specs
    .split("\n")
    .map((l) => l.trim())
    // as linhas "Artigo N — código + nome" repetem o produto; ficam as características
    .filter((l) => l && !/^Referente a/i.test(l) && !/Valor Total/i.test(l) && !/^Artigo\s+\d+/i.test(l))
    .filter((l, i, all) => all.indexOf(l) === i)
    .slice(0, 6);
}

export async function buildOrderMessage(serviceOrderId: string, event: OrderEvent, userId?: string | null) {
  const so = await prisma.serviceOrder.findUnique({
    where: { id: serviceOrderId },
    include: { client: true, product: true },
  });
  if (!so) return null;
  const user = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }) : null;
  const link = `${PUBLIC_APP_URL}/service-orders/${so.id}`;

  const lines: string[] = [];
  if (event === "created") {
    lines.push(`🆕 <b>Nova OS ${esc(so.externalId)}</b>`);
  } else if (event === "started") {
    lines.push(`▶️ <b>Produção iniciada — OS ${esc(so.externalId)}</b>`);
  } else {
    lines.push(`✅ <b>OS ${esc(so.externalId)} concluída</b>`);
  }
  lines.push(`👤 ${esc(so.client.name)}`);
  lines.push(`📦 ${esc(so.product.name)}`);

  if (event === "created") {
    shortSpecs(so.specifications).forEach((l) => lines.push(`   <i>${esc(l)}</i>`));
    if (so.deadlineAt) lines.push(`📅 Prazo: ${fmtDate(so.deadlineAt)}`);
    if (user) lines.push(`✍️ Lançada por ${esc(user.name)}`);
  } else if (event === "started") {
    if (so.deadlineAt) lines.push(`📅 Prazo: ${fmtDate(so.deadlineAt)}`);
    if (user) lines.push(`👷 ${esc(user.name)}`);
  } else {
    const done = so.completedAt ?? new Date();
    if (so.deadlineAt) {
      const late = dayDiff(so.deadlineAt, done);
      lines.push(
        late > 0
          ? `⚠️ Prazo ${fmtDate(so.deadlineAt)} — ${late} dia(s) de atraso`
          : `📅 Prazo ${fmtDate(so.deadlineAt)} — cumprido${late < 0 ? ` (${-late} dia(s) antes)` : ""}`
      );
    }
    if (so.productionMinutes > 0) lines.push(`⏱️ Tempo de produção: ${fmtMinutes(so.productionMinutes)}`);
    if (user) lines.push(`👷 Concluída por ${esc(user.name)}`);
  }
  lines.push(`🔗 <a href="${esc(link)}">Abrir no programa</a>`);
  return lines.join("\n");
}

/**
 * Envia o aviso de uma OS para as conversas configuradas. Nunca lança erro:
 * é chamado depois de a operação estar gravada e não a pode desfazer.
 */
export async function notifyOrderEvent(serviceOrderId: string, event: OrderEvent, userId?: string | null) {
  try {
    const s = await getTelegramSettings();
    if (!s.enabled || !s.botToken || !s.chats.length || !s.events[event]) return;
    const html = await buildOrderMessage(serviceOrderId, event, userId);
    if (!html) return;
    await Promise.all(
      s.chats.map((c) =>
        sendTelegramMessage(s.botToken, c.id, html).catch((err) =>
          // eslint-disable-next-line no-console
          console.error(`[telegram] falhou o envio para "${c.title}" (${c.id}):`, (err as Error).message)
        )
      )
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[telegram] aviso não enviado:", (err as Error).message);
  }
}

/** Versão "dispara e esquece" para usar nas rotas sem atrasar a resposta. */
export function notifyOrderEventLater(serviceOrderId: string, event: OrderEvent, userId?: string | null) {
  void notifyOrderEvent(serviceOrderId, event, userId);
}
