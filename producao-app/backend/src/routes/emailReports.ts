import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { getTelegramSettings } from "../services/telegramService";
import {
  buildReport,
  buildReportPdf,
  emailSettingsSchema,
  getEmailLog,
  getEmailSettings,
  isReportKey,
  REPORTS,
  saveEmailSettings,
  sendReport,
  sendTestEmail,
} from "../services/emailReportsService";

// ============================================================================
// Emails automáticos (2026-10-20) — configuração só para o ADMINISTRADOR.
// Ver services/emailReportsService.ts.
// ============================================================================

export const emailReportsRouter = Router();
emailReportsRouter.use(requireAuth);
emailReportsRouter.use((req, res, next) => {
  if (req.user?.role !== "ADMINISTRADOR") {
    return res.status(403).json({ error: "Só o administrador configura os emails automáticos." });
  }
  next();
});

async function present() {
  const s = await getEmailSettings();
  const { pass, ...smtp } = s.smtp;
  return {
    smtp: { ...smtp, hasPass: !!pass },
    reports: s.reports,
    reportNames: REPORTS,
    telegramChats: (await getTelegramSettings()).chats,
    log: await getEmailLog(),
  };
}

emailReportsRouter.get("/", asyncHandler(async (_req, res) => res.json(await present())));

// Grava a configuração. A palavra-passe só muda quando vem preenchida.
emailReportsRouter.put(
  "/",
  asyncHandler(async (req, res) => {
    const current = await getEmailSettings();
    const body = (req.body ?? {}) as { smtp?: Record<string, unknown>; reports?: unknown };
    const pass = typeof body.smtp?.pass === "string" && body.smtp.pass !== "" ? body.smtp.pass : current.smtp.pass;
    const next = emailSettingsSchema.parse({ ...body, smtp: { ...(body.smtp ?? {}), pass } });
    await saveEmailSettings(next, req.user!.id);
    res.json(await present());
  })
);

emailReportsRouter.post(
  "/test",
  asyncHandler(async (req, res) => {
    const { to } = z.object({ to: z.string().trim().email("Email inválido.") }).parse(req.body);
    try {
      await sendTestEmail(to);
    } catch (err) {
      return res.status(400).json({ error: "Não foi possível enviar: " + (err instanceof Error ? err.message : String(err)) });
    }
    res.json({ ok: true });
  })
);

// Pré-visualização (HTML) do email desta semana.
emailReportsRouter.get(
  "/:key/preview",
  asyncHandler(async (req, res) => {
    if (!isReportKey(req.params.key)) throw new Error("Email não encontrado.");
    const r = await buildReport(req.params.key);
    res.json({ subject: r.subject, html: r.html, tg: r.tg, count: r.count });
  })
);

// O PDF desta semana (é o que segue no Telegram e em anexo no email).
emailReportsRouter.get(
  "/:key/pdf",
  asyncHandler(async (req, res) => {
    if (!isReportKey(req.params.key)) throw new Error("Email não encontrado.");
    const { r, pdf } = await buildReportPdf(req.params.key);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${r.file}"`);
    res.send(pdf);
  })
);

// Enviar já (para os destinatários configurados ou para um email indicado).
emailReportsRouter.post(
  "/:key/send",
  asyncHandler(async (req, res) => {
    if (!isReportKey(req.params.key)) throw new Error("Email não encontrado.");
    const { to, canal } = z
      .object({ to: z.string().trim().email().optional(), canal: z.enum(["email", "telegram", "ambos"]).optional() })
      .parse(req.body ?? {});
    try {
      const r = await sendReport(req.params.key, { ...(to ? { to: [to] } : {}), ...(canal ? { canal } : {}) });
      res.json({ ok: true, count: r.count });
    } catch (err) {
      return res.status(400).json({ error: "Não foi possível enviar: " + (err instanceof Error ? err.message : String(err)) });
    }
  })
);
