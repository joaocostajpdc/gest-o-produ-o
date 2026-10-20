import nodemailer from "nodemailer";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { PUBLIC_APP_URL } from "../config/publicUrl";
import { getTelegramSettings, sendTelegramMessage } from "./telegramService";

// ============================================================================
// Emails automáticos semanais (pedido do utilizador de 2026-10-20: "quero que
// saiam de um email para outro; um deles à segunda-feira com as ordens de
// serviço que têm de ser terminadas esta semana; outro com o material que as
// lacagens têm de entregar esta semana").
//
// - A conta de envio (SMTP) e os destinatários são configurados pelo
//   administrador em Administração → Emails Automáticos (app_settings,
//   chave "emailReports"). A palavra-passe nunca volta inteira ao browser.
// - Cada relatório tem dia da semana e hora (hora de Portugal). O servidor
//   verifica a cada 5 minutos; se nessa semana ainda não enviou e a hora já
//   passou, envia (assim, se o servidor estiver a dormir à hora marcada,
//   envia assim que acordar, na mesma semana). O registo do último envio fica
//   em app_settings ("emailReportsLog").
// ============================================================================

export const EMAIL_KEY = "emailReports";
const LOG_KEY = "emailReportsLog";
const TZ = "Europe/Lisbon";

export const REPORTS = {
  osSemana: "Ordens de Serviço a terminar esta semana",
  lacagemSemana: "Material que as lacagens têm de entregar esta semana",
} as const;
export type ReportKey = keyof typeof REPORTS;
export function isReportKey(k: string): k is ReportKey {
  return Object.prototype.hasOwnProperty.call(REPORTS, k);
}

const reportSchema = z.object({
  enabled: z.boolean().default(false),
  to: z.array(z.string().trim().email()).max(20).default([]),
  weekday: z.number().int().min(1).max(7).default(1), // 1 = segunda … 7 = domingo
  hour: z.number().int().min(0).max(23).default(8),
  // Por onde sai: email, Telegram (conversas configuradas em Avisos Telegram)
  // ou os dois. O Render gratuito bloqueia o envio de email (portas SMTP),
  // por isso o Telegram é a alternativa sem custos (2026-10-20).
  canal: z.enum(["email", "telegram", "ambos"]).default("email"),
  // Conversas do Telegram que recebem este aviso (ids); vazio = todas.
  tgChats: z.array(z.string().trim().max(40)).max(20).default([]),
});

export const emailSettingsSchema = z.object({
  smtp: z
    .object({
      host: z.string().trim().max(200).default(""),
      port: z.number().int().min(1).max(65535).default(465),
      secure: z.boolean().default(true),
      user: z.string().trim().max(200).default(""),
      pass: z.string().max(300).default(""),
      fromName: z.string().trim().max(120).default("Minho Ferragens"),
      fromEmail: z.string().trim().max(200).default(""),
    })
    .default({}),
  reports: z
    .object({
      osSemana: reportSchema.default({}),
      lacagemSemana: reportSchema.default({}),
    })
    .default({}),
});
export type EmailSettings = z.infer<typeof emailSettingsSchema>;

export async function getEmailSettings(): Promise<EmailSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: EMAIL_KEY } });
  return emailSettingsSchema.parse(row?.value ?? {});
}
export async function saveEmailSettings(value: EmailSettings, userId?: string) {
  await prisma.appSetting.upsert({
    where: { key: EMAIL_KEY },
    create: { key: EMAIL_KEY, value, updatedById: userId },
    update: { value, updatedById: userId },
  });
}

async function getLog(): Promise<Record<string, { week: string; at: string; ok: boolean; info: string }>> {
  const row = await prisma.appSetting.findUnique({ where: { key: LOG_KEY } });
  return (row?.value as Record<string, { week: string; at: string; ok: boolean; info: string }>) ?? {};
}
async function writeLog(key: ReportKey, entry: { week: string; at: string; ok: boolean; info: string }) {
  const log = await getLog();
  log[key] = entry;
  await prisma.appSetting.upsert({
    where: { key: LOG_KEY },
    create: { key: LOG_KEY, value: log },
    update: { value: log },
  });
}
export { getLog as getEmailLog };

// ---------------------------------------------------------------------------
// Datas em hora de Portugal
// ---------------------------------------------------------------------------
function lisbonParts(d: Date) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday")) + 1;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), weekday: wd };
}
function addDays(iso: string, n: number) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Segunda e domingo (AAAA-MM-DD) da semana de `now`, em Portugal. */
export function currentWeek(now = new Date()) {
  const { date, weekday } = lisbonParts(now);
  const monday = addDays(date, -(weekday - 1));
  return { monday, sunday: addDays(monday, 6) };
}
const lisbonDate = (d: Date) => lisbonParts(d).date;
const fmtPT = (iso: string) => iso.split("-").reverse().join("/");

// ---------------------------------------------------------------------------
// Conteúdo dos relatórios
// ---------------------------------------------------------------------------
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

function table(headers: string[], rows: string[][]) {
  const th = headers
    .map((h) => `<th style="text-align:left;padding:7px 9px;background:#1b2033;color:#fff;font-size:12px">${esc(h)}</th>`)
    .join("");
  const tr = rows
    .map(
      (r, i) =>
        `<tr style="background:${i % 2 ? "#f5f6fa" : "#fff"}">${r
          .map((c) => `<td style="padding:7px 9px;border-bottom:1px solid #e4e6ed;font-size:13px">${c}</td>`)
          .join("")}</tr>`
    )
    .join("");
  return `<table cellspacing="0" style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif">${th ? `<tr>${th}</tr>` : ""}${tr}</table>`;
}
function wrap(title: string, subtitle: string, body: string) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1b2033;max-width:900px">
<h2 style="margin:0 0 4px;color:#1f3fe0">${esc(title)}</h2>
<p style="margin:0 0 16px;color:#667085">${esc(subtitle)}</p>${body}
<p style="margin-top:20px;font-size:12px;color:#667085">Enviado automaticamente pela Gestão de Produção — <a href="${PUBLIC_APP_URL}">${PUBLIC_APP_URL}</a></p></div>`;
}
const osLink = (o: { id: string; externalId: string }) =>
  `<a href="${PUBLIC_APP_URL}/service-orders/${o.id}" style="color:#1f3fe0;font-weight:bold">${esc(o.externalId)}</a>`;

const OPEN = ["NAO_INICIADA", "EM_PRODUCAO", "SUSPENSA"] as const;
const STATUS_PT: Record<string, string> = { NAO_INICIADA: "Não iniciada", EM_PRODUCAO: "Em produção", SUSPENSA: "Suspensa" };

export async function buildReport(key: ReportKey, now = new Date()) {
  const { monday, sunday } = currentWeek(now);
  const semana = `Semana de ${fmtPT(monday)} a ${fmtPT(sunday)}`;

  if (key === "osSemana") {
    const orders = await prisma.serviceOrder.findMany({
      where: { status: { in: [...OPEN] }, deadlineAt: { not: null } },
      include: { client: true, product: true, currentStageInstance: { include: { stage: true } } },
      orderBy: { deadlineAt: "asc" },
    });
    const due = orders.filter((o) => o.deadlineAt && lisbonDate(o.deadlineAt) <= sunday);
    const late = due.filter((o) => lisbonDate(o.deadlineAt!) < monday);
    const week = due.filter((o) => lisbonDate(o.deadlineAt!) >= monday);
    const rows = (l: typeof due) =>
      l.map((o) => [
        osLink(o),
        esc(o.client.name),
        esc(o.product.name),
        esc(o.currentStageInstance?.stage.name ?? "—"),
        esc(STATUS_PT[o.status] ?? o.status),
        `<b>${fmtPT(lisbonDate(o.deadlineAt!))}</b>`,
      ]);
    const H = ["OS", "Cliente", "Produto", "Etapa atual", "Estado", "Data-limite"];
    let body = "";
    body += `<h3 style="margin:18px 0 8px">Para terminar esta semana (${week.length})</h3>`;
    body += week.length ? table(H, rows(week)) : `<p style="color:#667085">Nenhuma OS com data-limite esta semana.</p>`;
    if (late.length) {
      body += `<h3 style="margin:22px 0 8px;color:#dc2626">Já com o prazo ultrapassado (${late.length})</h3>` + table(H, rows(late));
    }
    const tgLine = (o: (typeof due)[number]) =>
      `• <a href="${PUBLIC_APP_URL}/service-orders/${o.id}"><b>${esc(o.externalId)}</b></a> · ${esc(o.client.name)} · ${esc(o.product.name)}` +
      ` — ${esc(o.currentStageInstance?.stage.name ?? STATUS_PT[o.status] ?? "")} · até <b>${fmtPT(lisbonDate(o.deadlineAt!)).slice(0, 5)}</b>`;
    const tg =
      `📋 <b>OS a terminar esta semana</b>\n${semana}\n\n` +
      (week.length ? week.map(tgLine).join("\n") : "Nenhuma OS com data-limite esta semana.") +
      (late.length ? `\n\n🔴 <b>Prazo ultrapassado (${late.length})</b>\n` + late.map(tgLine).join("\n") : "");
    return {
      tg,
      subject: `OS a terminar esta semana — ${fmtPT(monday)} a ${fmtPT(sunday)} (${week.length}${late.length ? ` + ${late.length} em atraso` : ""})`,
      html: wrap(REPORTS.osSemana, semana, body),
      count: due.length,
    };
  }

  // lacagemSemana: OS que estão agora na etapa "Lacagem" num fornecedor, com
  // a data prevista de devolução (entrada + prazo do fornecedor) até domingo.
  const orders = await prisma.serviceOrder.findMany({
    where: { status: { in: [...OPEN] }, currentStageInstance: { stage: { name: "Lacagem" } } },
    include: {
      client: true,
      product: true,
      currentStageInstance: { include: { stage: true, supplier: { include: { leadTimes: true } } } },
    },
  });
  type Row = { o: (typeof orders)[number]; expected: string | null; supplier: string };
  const items: Row[] = orders.map((o) => {
    const csi = o.currentStageInstance!;
    const lt = csi.supplier?.leadTimes.find((x) => x.category === o.product.category);
    const expected =
      csi.enteredAt && lt ? lisbonDate(new Date(new Date(csi.enteredAt).getTime() + lt.leadDays * 86400000)) : null;
    return { o, expected, supplier: csi.supplier?.name ?? "Sem fornecedor" };
  });
  const due = items.filter((i) => i.expected && i.expected <= sunday).sort((a, b) => a.expected!.localeCompare(b.expected!));
  const noDate = items.filter((i) => !i.expected);
  const finish = (spec: string | null) => {
    const m = (spec ?? "").split("\n").map((l) => /^acabamento:\s*(.+)$/i.exec(l.trim())).find(Boolean);
    return m ? m[1].replace(/,\s*$/, "") : "—";
  };
  const groups = new Map<string, Row[]>();
  for (const i of due) groups.set(i.supplier, [...(groups.get(i.supplier) ?? []), i]);
  const H = ["OS", "Cliente", "Produto", "Acabamento", "Entrou em", "Entrega prevista"];
  const toRow = (i: Row) => [
    osLink(i.o),
    esc(i.o.client.name),
    esc(i.o.product.name),
    esc(finish(i.o.specifications)),
    i.o.currentStageInstance?.enteredAt ? fmtPT(lisbonDate(new Date(i.o.currentStageInstance.enteredAt))) : "—",
    `<b style="color:${i.expected! < monday ? "#dc2626" : "#1b2033"}">${fmtPT(i.expected!)}${i.expected! < monday ? " (atrasado)" : ""}</b>`,
  ];
  let body = due.length ? "" : `<p style="color:#667085">Nenhum material com entrega prevista esta semana.</p>`;
  for (const [sup, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    body += `<h3 style="margin:18px 0 8px">${esc(sup)} (${list.length})</h3>` + table(H, list.map(toRow));
  }
  if (noDate.length) {
    body +=
      `<h3 style="margin:22px 0 8px;color:#667085">Em lacagem sem prazo configurado (${noDate.length})</h3>` +
      table(["OS", "Cliente", "Produto", "Fornecedor"], noDate.map((i) => [osLink(i.o), esc(i.o.client.name), esc(i.o.product.name), esc(i.supplier)]));
  }
  let tg = `🎨 <b>Lacagens — material a entregar esta semana</b>\n${semana}\n`;
  if (!due.length) tg += "\nNenhum material com entrega prevista esta semana.";
  for (const [sup, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    tg +=
      `\n<b>${esc(sup)}</b> (${list.length})\n` +
      list
        .map(
          (i) =>
            `• <a href="${PUBLIC_APP_URL}/service-orders/${i.o.id}"><b>${esc(i.o.externalId)}</b></a> · ${esc(i.o.client.name)} · ${esc(finish(i.o.specifications))} · ` +
            `${i.expected! < monday ? "🔴 atrasado, era " : "entrega "}<b>${fmtPT(i.expected!).slice(0, 5)}</b>`
        )
        .join("\n") +
      "\n";
  }
  if (noDate.length) tg += `\n⚪ Em lacagem sem prazo configurado: ${noDate.map((i) => esc(i.o.externalId)).join(", ")}`;
  return {
    tg,
    subject: `Lacagens — material a entregar esta semana (${fmtPT(monday)} a ${fmtPT(sunday)}): ${due.length}`,
    html: wrap(REPORTS.lacagemSemana, semana, body),
    count: due.length,
  };
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------
function transport(s: EmailSettings) {
  if (!s.smtp.host || !s.smtp.user || !s.smtp.pass) {
    throw new Error("Falta configurar a conta de envio (servidor SMTP, utilizador e palavra-passe).");
  }
  return nodemailer.createTransport({
    host: s.smtp.host,
    port: s.smtp.port,
    secure: s.smtp.secure,
    auth: { user: s.smtp.user, pass: s.smtp.pass },
  });
}
function fromAddr(s: EmailSettings) {
  const email = s.smtp.fromEmail || s.smtp.user;
  return s.smtp.fromName ? `"${s.smtp.fromName.replace(/"/g, "")}" <${email}>` : email;
}

export async function sendTestEmail(to: string) {
  const s = await getEmailSettings();
  await transport(s).sendMail({
    from: fromAddr(s),
    to,
    subject: "Teste — emails automáticos da Gestão de Produção",
    html: wrap("Teste de envio", "A conta de envio está a funcionar.", "<p>Se recebeu este email, os emails automáticos estão prontos.</p>"),
  });
}

/** Divide uma mensagem longa em partes de até ~3800 caracteres (limite do Telegram: 4096), cortando entre linhas. */
function splitTelegram(text: string) {
  const parts: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if ((cur + "\n" + line).length > 3800 && cur) {
      parts.push(cur);
      cur = line;
    } else cur = cur ? cur + "\n" + line : line;
  }
  if (cur) parts.push(cur);
  return parts;
}

async function sendToTelegram(text: string, only: string[]) {
  const t = await getTelegramSettings();
  const chats = only.length ? t.chats.filter((c) => only.includes(c.id)) : t.chats;
  if (!t.botToken || !chats.length) {
    throw new Error("O Telegram não está configurado (Administração → Avisos Telegram: bot e conversas).");
  }
  for (const c of chats) for (const part of splitTelegram(text)) await sendTelegramMessage(t.botToken, c.id, part);
  return chats.length;
}

export async function sendReport(key: ReportKey, opts: { to?: string[]; now?: Date; canal?: "email" | "telegram" | "ambos" } = {}) {
  const s = await getEmailSettings();
  const canal = opts.canal ?? s.reports[key].canal;
  const r = await buildReport(key, opts.now);
  if (canal === "telegram" || canal === "ambos") await sendToTelegram(r.tg, s.reports[key].tgChats);
  if (canal === "email" || canal === "ambos") {
    const to = opts.to ?? s.reports[key].to;
    if (!to.length) throw new Error("Este email não tem destinatários.");
    await transport(s).sendMail({ from: fromAddr(s), to: to.join(", "), subject: r.subject, html: r.html });
  }
  return r;
}

// ---------------------------------------------------------------------------
// Agendamento (verifica a cada 5 minutos)
// ---------------------------------------------------------------------------
let running = false;
export async function runDueReports(now = new Date()) {
  if (running) return;
  running = true;
  try {
    const s = await getEmailSettings();
    const log = await getLog();
    const { monday } = currentWeek(now);
    const { weekday, hour } = lisbonParts(now);
    for (const key of Object.keys(REPORTS) as ReportKey[]) {
      const cfg = s.reports[key];
      if (!cfg.enabled || (cfg.canal !== "telegram" && !cfg.to.length)) continue;
      if (log[key]?.week === monday) continue; // já enviado esta semana
      const due = weekday > cfg.weekday || (weekday === cfg.weekday && hour >= cfg.hour);
      if (!due) continue;
      try {
        const r = await sendReport(key, { now });
        await writeLog(key, { week: monday, at: now.toISOString(), ok: true, info: `${r.count} linha(s)` });
        // eslint-disable-next-line no-console
        console.log(`[emails] enviado ${key} (${r.count})`);
      } catch (err) {
        const info = err instanceof Error ? err.message : String(err);
        // não marca a semana como enviada: volta a tentar na próxima verificação
        await writeLog(key, { week: log[key]?.week ?? "", at: now.toISOString(), ok: false, info });
        // eslint-disable-next-line no-console
        console.error(`[emails] falhou ${key}: ${info}`);
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[emails] erro no agendamento", err);
  } finally {
    running = false;
  }
}

export function startEmailScheduler() {
  setTimeout(() => void runDueReports(), 60 * 1000);
  setInterval(() => void runDueReports(), 5 * 60 * 1000);
}
