import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { requireFeature } from "../config/featureReleases";
import { asyncHandler } from "../utils/asyncHandler";

// ============================================================================
// Chat interno (pedido do utilizador de 2026-10-24). Canal "geral" para toda
// a equipa e conversas diretas entre duas pessoas ("dm:<idA>:<idB>", ids por
// ordem alfabética). O ecrã pergunta por mensagens novas de poucos em poucos
// segundos. Em teste: só o administrador até ser aprovado.
// ============================================================================

export const chatRouter = Router();
chatRouter.use(requireAuth);
chatRouter.use(requireFeature("chat"));

const GERAL = "geral";

function dmChannel(a: string, b: string) {
  return "dm:" + [a, b].sort().join(":");
}

/** O utilizador pode ver este canal? (geral: todos; dm: só os dois participantes) */
function canSee(channel: string, userId: string) {
  if (channel === GERAL) return true;
  const m = /^dm:([^:]+):([^:]+)$/.exec(channel);
  return !!m && (m[1] === userId || m[2] === userId);
}

// Lista de conversas: geral + uma por colega ativo, com não lidas e última mensagem.
chatRouter.get(
  "/channels",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const users = await prisma.user.findMany({
      where: { active: true, NOT: { id: me } },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    });
    const channels = [GERAL, ...users.map((u: { id: string }) => dmChannel(me, u.id))];
    const [reads, lasts] = await Promise.all([
      prisma.chatRead.findMany({ where: { userId: me, channel: { in: channels } } }),
      Promise.all(
        channels.map((c) =>
          prisma.chatMessage.findFirst({ where: { channel: c }, orderBy: { createdAt: "desc" } })
        )
      ),
    ]);
    const unread = await Promise.all(
      channels.map((c) => {
        const r = reads.find((x: { channel: string }) => x.channel === c);
        return prisma.chatMessage.count({
          where: { channel: c, NOT: { userId: me }, ...(r ? { createdAt: { gt: r.lastReadAt } } : {}) },
        });
      })
    );
    const out = channels.map((c, i) => {
      const u = i === 0 ? null : users[i - 1];
      const last = lasts[i];
      return {
        channel: c,
        nome: u ? u.name : "Geral",
        tipo: u ? "dm" : "geral",
        unread: unread[i],
        last: last ? { text: last.text, createdAt: last.createdAt, mine: last.userId === me } : null,
      };
    });
    res.json(out);
  })
);

// Total de mensagens por ler (para o contador no menu).
chatRouter.get(
  "/unread",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const users = await prisma.user.findMany({ where: { active: true, NOT: { id: me } }, select: { id: true } });
    const channels = [GERAL, ...users.map((u: { id: string }) => dmChannel(me, u.id))];
    const reads = await prisma.chatRead.findMany({ where: { userId: me, channel: { in: channels } } });
    let total = 0;
    for (const c of channels) {
      const r = reads.find((x: { channel: string }) => x.channel === c);
      total += await prisma.chatMessage.count({
        where: { channel: c, NOT: { userId: me }, ...(r ? { createdAt: { gt: r.lastReadAt } } : {}) },
      });
    }
    res.json({ total });
  })
);

chatRouter.get(
  "/messages",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const channel = String(req.query.channel || GERAL);
    if (!canSee(channel, me)) return res.status(403).json({ error: "Sem acesso a esta conversa." });
    const after = typeof req.query.after === "string" && req.query.after ? new Date(req.query.after) : null;
    const rows = await prisma.chatMessage.findMany({
      where: { channel, ...(after && !isNaN(after.getTime()) ? { createdAt: { gt: after } } : {}) },
      orderBy: { createdAt: after ? "asc" : "desc" },
      take: after ? 200 : 100,
    });
    const list = after ? rows : rows.reverse();
    const ids = [...new Set(list.map((m: { userId: string }) => m.userId))] as string[];
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    res.json(
      list.map((m: { id: string; userId: string; text: string; createdAt: Date }) => ({
        id: m.id,
        text: m.text,
        createdAt: m.createdAt,
        userId: m.userId,
        userName: users.find((u: { id: string }) => u.id === m.userId)?.name ?? "—",
        mine: m.userId === me,
      }))
    );
  })
);

const sendSchema = z.object({
  channel: z.string().min(1),
  text: z.string().trim().min(1, "Mensagem vazia.").max(4000),
});

chatRouter.post(
  "/messages",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const { channel, text } = sendSchema.parse(req.body);
    if (!canSee(channel, me)) return res.status(403).json({ error: "Sem acesso a esta conversa." });
    const m = await prisma.chatMessage.create({ data: { channel, text, userId: me } });
    await prisma.chatRead.upsert({
      where: { userId_channel: { userId: me, channel } },
      create: { userId: me, channel, lastReadAt: m.createdAt },
      update: { lastReadAt: m.createdAt },
    });
    res.status(201).json({ id: m.id, text: m.text, createdAt: m.createdAt, userId: me, userName: req.user!.name, mine: true });
  })
);

chatRouter.post(
  "/read",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const channel = String((req.body && req.body.channel) || "");
    if (!canSee(channel, me)) return res.status(403).json({ error: "Sem acesso a esta conversa." });
    const now = new Date();
    await prisma.chatRead.upsert({
      where: { userId_channel: { userId: me, channel } },
      create: { userId: me, channel, lastReadAt: now },
      update: { lastReadAt: now },
    });
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------------
// Ficheiros no chat (pedido de 2026-10-24: "todo o tipo de documentos").
// O ficheiro vai em bruto no corpo do pedido; o nome vem em ?name=.
// ---------------------------------------------------------------------------
const CHAT_FILE_LIMIT = 20 * 1024 * 1024;

chatRouter.post(
  "/files",
  express.raw({ type: () => true, limit: CHAT_FILE_LIMIT }),
  asyncHandler(async (req, res) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length) return res.status(400).json({ error: "Ficheiro vazio." });
    const name = String(req.query.name || "ficheiro").slice(0, 200);
    const mimeType = String(req.query.type || req.headers["content-type"] || "application/octet-stream").slice(0, 120);
    const f = await prisma.chatFile.create({
      data: { name, mimeType, size: body.length, data: body, userId: req.user!.id },
      select: { id: true, name: true, mimeType: true, size: true },
    });
    res.status(201).json(f);
  })
);

chatRouter.get(
  "/files/:id",
  asyncHandler(async (req, res) => {
    const f = await prisma.chatFile.findUnique({ where: { id: req.params.id } });
    if (!f) return res.status(404).json({ error: "Ficheiro não encontrado." });
    res.setHeader("Content-Type", f.mimeType);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(Buffer.from(f.data));
  })
);
