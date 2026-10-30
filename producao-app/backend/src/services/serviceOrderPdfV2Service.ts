import PDFDocument from "pdfkit";
import bwipjs from "bwip-js";
import { Response } from "express";
import { PRIORITY_COLORS, PriorityLevel } from "./priorityService";
import type { TravelerData, TravelerObservation, TravelerStageRow } from "./serviceOrderPdfService";

// ============================================================================
// Ficha de Produção — layout novo (pedido do utilizador de 2026-10-30:
// "melhora o layout destas fichas de produção"). Em teste: só o
// administrador recebe esta versão até ser lançada (chave "fichaNova"); os
// restantes continuam com serviceOrderPdfService.ts.
//
// O que muda em relação à ficha antiga:
//  - código de barras maior, com o número legível por baixo e sem ficar
//    cortado (a imagem é encaixada na caixa com "fit");
//  - faixa "Etapa atual → próxima" logo abaixo do cabeçalho, para quem pega
//    na peça saber de imediato onde ela está;
//  - os dados (estado, prioridade, data-limite, entrada) numa só linha;
//  - características com a altura medida pelo texto (sem espaço vazio);
//  - etapas em ponto pequeno (uma fila de etiquetas);
//  - quadro de notas manuscritas a ocupar o espaço livre no fim da página;
//  - rodapé com a data de impressão (hora de Lisboa).
// ============================================================================

const C = {
  ink: "#111827",
  muted: "#6b7280",
  faint: "#9ca3af",
  border: "#e5e7eb",
  line: "#d1d5db",
  card: "#f9fafb",
  spec: "#eef2ff",
  note: "#fff7e6",
  primary: "#1f3fe0",
  primaryDark: "#16309e",
  primarySoft: "#eef1ff",
};

const STATUS_LABELS: Record<string, string> = {
  NAO_INICIADA: "Não iniciada",
  EM_PRODUCAO: "Em produção",
  SUSPENSA: "Suspensa",
  CONCLUIDA: "Concluída",
  CANCELADA: "Cancelada",
};

const PRIORITY_PILL: Record<PriorityLevel, string> = {
  PRAZO_ULTRAPASSADO: "Atrasado",
  URGENTE: "Urgente",
  PROXIMO: "Próximo",
  COM_MARGEM: "Com margem",
};

const STAGE_LABEL: Record<TravelerStageRow["status"], string> = {
  CONCLUIDA: "Concluída",
  ATIVA: "Etapa atual",
  PENDENTE: "Por fazer",
  OMITIDA: "Omitida",
};

const M = 36; // margem
const FOOTER_H = 22;

type Doc = PDFKit.PDFDocument;

export async function streamServiceOrderTravelerPdfV2(res: Response, data: TravelerData) {
  const barcode = await bwipjs.toBuffer({
    bcid: "code128",
    text: data.externalId,
    scale: 3,
    height: 14,
    includetext: true,
    textxalign: "center",
    textsize: 11,
    paddingwidth: 0,
    paddingheight: 0,
  });

  const doc = new PDFDocument({ size: "A4", margin: M, bufferPages: true });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Disposition", `attachment; filename="ficha-producao-${data.externalId.replace(/[^a-z0-9-_]+/gi, "-")}.pdf"`);
  doc.pipe(res);

  header(doc, data, barcode);
  currentStageBanner(doc, data.stages);
  infoRow(doc, data);
  if (data.specifications?.trim()) specifications(doc, data.specifications);
  stagesTable(doc, data.stages);
  if (data.generalObservations.length) generalObservations(doc, data.generalObservations);
  notesBox(doc);

  footer(doc, data.externalId);
  doc.end();
}

// ---------------------------------------------------------------------------

function W(doc: Doc) {
  return doc.page.width - M * 2;
}

function bottomLimit(doc: Doc) {
  return doc.page.height - M - FOOTER_H;
}

function ensure(doc: Doc, h: number) {
  if (doc.y + h > bottomLimit(doc)) doc.addPage();
}

function fmt(iso: string | null, withTime = true): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-PT", {
    timeZone: "Europe/Lisbon",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function sectionTitle(doc: Doc, title: string, right?: string) {
  ensure(doc, 40);
  const y = doc.y;
  doc.roundedRect(M, y + 2, 4, 13, 1.5).fill(C.primary);
  doc.font("Helvetica-Bold").fontSize(12).fillColor(C.ink).text(title, M + 11, y, { lineBreak: false });
  if (right) {
    doc.font("Helvetica").fontSize(8.5).fillColor(C.muted).text(right, M, y + 3, { width: W(doc), align: "right", lineBreak: false });
  }
  doc.y = y + 22;
}

// ---------------------------------------------------------------------------

function header(doc: Doc, data: TravelerData, barcode: Buffer) {
  doc.rect(0, 0, doc.page.width, 7).fill(C.primary);

  const top = M - 6;
  const boxW = 210;
  const boxH = 104;
  const boxX = doc.page.width - M - boxW;
  const textW = boxX - M - 16;

  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.primary)
    .text("FICHA DE PRODUÇÃO", M, top, { characterSpacing: 1, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(34).fillColor(C.ink).text(data.externalId, M, top + 14, { width: textW, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(13).fillColor(C.ink)
    .text(data.clienteName, M, top + 56, { width: textW, height: 17, ellipsis: true, lineBreak: false });
  doc.font("Helvetica").fontSize(11).fillColor(C.muted)
    .text(data.produtoName, M, top + 75, { width: textW, height: 15, ellipsis: true, lineBreak: false });

  doc.roundedRect(boxX, top, boxW, boxH, 8).lineWidth(1).fillAndStroke("#ffffff", C.border);
  doc.image(barcode, boxX + 12, top + 10, { fit: [boxW - 24, boxH - 32], align: "center", valign: "center" });
  doc.font("Helvetica").fontSize(7.5).fillColor(C.muted)
    .text("Ler na Central para ver e passar de etapa", boxX, top + boxH - 16, { width: boxW, align: "center", lineBreak: false });

  doc.y = top + boxH + 14;
}

function currentStageBanner(doc: Doc, stages: TravelerStageRow[]) {
  const idx = stages.findIndex((s) => s.status === "ATIVA");
  const current = idx >= 0 ? stages[idx] : null;
  const next = stages.slice(idx + 1).find((s) => s.status === "PENDENTE") ?? (idx < 0 ? stages.find((s) => s.status === "PENDENTE") : undefined);
  const allDone = stages.length > 0 && stages.every((s) => s.status === "CONCLUIDA" || s.status === "OMITIDA");

  const h = 50;
  const y = doc.y;
  const w = W(doc);
  doc.roundedRect(M, y, w, h, 8).fill(C.primarySoft);
  doc.roundedRect(M, y, 5, h, 2.5).fill(C.primary);

  const half = w * 0.58;
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C.primaryDark).text("ETAPA ATUAL", M + 16, y + 9, { characterSpacing: 0.6, lineBreak: false });
  const curLabel = current ? current.stageName : allDone ? "Todas as etapas concluídas" : "Produção ainda não iniciada";
  doc.font("Helvetica-Bold").fontSize(17).fillColor(C.ink).text(curLabel, M + 16, y + 21, { width: half - 24, height: 22, ellipsis: true, lineBreak: false });
  if (current?.supplierName) {
    const lw = doc.widthOfString(curLabel);
    doc.font("Helvetica").fontSize(10).fillColor(C.muted).text(`· ${current.supplierName}`, M + 22 + Math.min(lw, half - 120), y + 27, { lineBreak: false });
  }

  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C.muted).text("A SEGUIR", M + half, y + 9, { characterSpacing: 0.6, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(13).fillColor(next ? C.ink : C.muted)
    .text(next ? next.stageName : allDone ? "—" : "Concluir a OS", M + half, y + 23, { width: w - half - 14, height: 18, ellipsis: true, lineBreak: false });

  doc.y = y + h + 12;
}

function infoRow(doc: Doc, data: TravelerData) {
  const gap = 8;
  const w = W(doc);
  const tw = (w - gap * 3) / 4;
  const th = 46;
  const y = doc.y;

  const tiles: { label: string; value: string; sub?: string; pill?: string }[] = [
    { label: "ESTADO", value: STATUS_LABELS[data.status] ?? data.status, sub: data.startedAt ? `Início ${fmt(data.startedAt, false)}` : undefined },
    {
      label: "PRIORIDADE",
      value: data.priorityNivel ? PRIORITY_PILL[data.priorityNivel] : "—",
      pill: data.priorityNivel ? PRIORITY_COLORS[data.priorityNivel] : undefined,
    },
    { label: "DATA-LIMITE", value: fmt(data.deadlineAt, false), sub: data.deadlineAt ? fmt(data.deadlineAt).split(" ").pop() : undefined },
    { label: "ENTRADA", value: fmt(data.createdAt, false) },
  ];

  tiles.forEach((t, i) => {
    const x = M + i * (tw + gap);
    doc.roundedRect(x, y, tw, th, 7).lineWidth(1).fillAndStroke(C.card, C.border);
    doc.font("Helvetica-Bold").fontSize(7).fillColor(C.muted).text(t.label, x + 10, y + 8, { characterSpacing: 0.5, lineBreak: false });
    if (t.pill) {
      doc.font("Helvetica-Bold").fontSize(9.5);
      const pw = Math.min(tw - 20, doc.widthOfString(t.value) + 16);
      doc.roundedRect(x + 10, y + 21, pw, 17, 8.5).fill(t.pill);
      doc.fillColor("#ffffff").text(t.value, x + 10, y + 25.5, { width: pw, align: "center", lineBreak: false });
    } else {
      doc.font("Helvetica-Bold").fontSize(12).fillColor(C.ink).text(t.value, x + 10, y + 20, { width: tw - 20, lineBreak: false, ellipsis: true });
      if (t.sub) doc.font("Helvetica").fontSize(7.5).fillColor(C.muted).text(t.sub, x + 10, y + 34, { width: tw - 20, lineBreak: false });
    }
  });

  doc.y = y + th + 14;
}

function specifications(doc: Doc, text: string) {
  const w = W(doc);
  const pad = 12;
  const inner = w - pad * 2;
  const lines = text.split("\n").map((l) => l.replace(/\s+$/g, "")).filter((l) => l.trim().length > 0);

  const isArticle = (l: string) => /^Artigo \d+\s*—/.test(l);
  const isRef = (l: string) => /^Referente a:/i.test(l);
  const fontFor = (l: string): [string, number] => (isArticle(l) ? ["Helvetica-Bold", 8.5] : isRef(l) ? ["Helvetica", 9.5] : ["Helvetica-Bold", 11]);

  const heights = lines.map((l, i) => {
    const [f, s] = fontFor(l);
    doc.font(f).fontSize(s);
    return doc.heightOfString(isArticle(l) ? l.toUpperCase() : l, { width: inner }) + (isArticle(l) ? 3 + (i > 0 ? 8 : 0) : 1.5);
  });
  const contentH = heights.reduce((a, b) => a + b, 0);
  const h = pad + 16 + contentH + pad - 4;

  ensure(doc, Math.min(h, 300) + 12);
  const x = M;
  const y = doc.y;
  doc.roundedRect(x, y, w, h, 8).lineWidth(1).fillAndStroke(C.spec, C.border);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(C.primaryDark).text("CARACTERÍSTICAS DO PRODUTO", x + pad, y + pad, { characterSpacing: 0.5, lineBreak: false });

  let ly = y + pad + 16;
  lines.forEach((l, i) => {
    const [f, s] = fontFor(l);
    if (isArticle(l) && i > 0) {
      doc.moveTo(x + pad, ly + 2).lineTo(x + w - pad, ly + 2).dash(2, { space: 2 }).strokeColor(C.line).lineWidth(0.8).stroke();
      doc.undash();
    }
    const ty = isArticle(l) && i > 0 ? ly + 8 : ly;
    doc.font(f).fontSize(s).fillColor(isArticle(l) ? C.primaryDark : isRef(l) ? C.muted : C.ink)
      .text(isArticle(l) ? l.toUpperCase() : l, x + pad, ty, { width: inner });
    ly += heights[i];
  });

  doc.y = y + h + 14;
}

function stageIcon(doc: Doc, status: TravelerStageRow["status"], x: number, y: number) {
  const s = 13;
  doc.save();
  if (status === "CONCLUIDA") {
    doc.roundedRect(x, y, s, s, 2.5).fill(C.primary);
    doc.moveTo(x + 3, y + 7).lineTo(x + 5.6, y + 9.8).lineTo(x + 10.2, y + 3.4).lineWidth(1.6).strokeColor("#fff").stroke();
  } else if (status === "ATIVA") {
    doc.circle(x + s / 2, y + s / 2, s / 2).fill(C.primary);
    doc.polygon([x + 4.8, y + 3.4], [x + 4.8, y + 9.6], [x + 10, y + 6.5]).fill("#fff");
  } else {
    doc.roundedRect(x, y, s, s, 2.5).lineWidth(1.2).strokeColor(C.faint).stroke();
    if (status === "OMITIDA") doc.moveTo(x + 2.5, y + 2.5).lineTo(x + s - 2.5, y + s - 2.5).lineWidth(1.2).strokeColor(C.faint).stroke();
  }
  doc.restore();
}

// Etapas em ponto pequeno (pedido do utilizador de 2026-10-30: "na ficha de
// produção basta ter as etapas a pequeno"): uma fila de etiquetas com o
// visto/etapa atual, que passa para a linha seguinte se não couber. As notas
// associadas a uma etapa saem por baixo, com o nome da etapa à frente.
function stagesTable(doc: Doc, stages: TravelerStageRow[]) {
  const done = stages.filter((s) => s.status === "CONCLUIDA").length;
  const total = stages.filter((s) => s.status !== "OMITIDA").length;
  sectionTitle(doc, "Etapas", total ? `${done} de ${total} concluídas` : undefined);

  const w = W(doc);
  const chipH = 22;
  const gap = 6;
  let x = M;
  let y = doc.y;
  ensure(doc, chipH + 4);

  stages.forEach((st) => {
    const label = st.supplierName ? `${st.stageName} · ${st.supplierName}` : st.stageName;
    const active = st.status === "ATIVA";
    const muted = st.status === "OMITIDA" || st.status === "PENDENTE";
    doc.font(active ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);
    const cw = Math.min(w, doc.widthOfString(label) + 32);
    if (x + cw > M + w) {
      x = M;
      y += chipH + gap;
    }
    if (active) doc.roundedRect(x, y, cw, chipH, 11).fill(C.primarySoft);
    doc.roundedRect(x, y, cw, chipH, 11).lineWidth(active ? 1.2 : 0.8).strokeColor(active ? C.primary : C.border).stroke();
    doc.save();
    doc.translate(x + 7, y + 5.5);
    doc.scale(11 / 13);
    stageIcon(doc, st.status, 0, 0);
    doc.restore();
    doc.font(active ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(active ? C.primaryDark : muted ? C.muted : C.ink)
      .text(label, x + 23, y + 7, { lineBreak: false });
    x += cw + gap;
  });
  doc.y = y + chipH + 10;

  const notes = stages.flatMap((st) => st.observations.map((o) => ({ ...o, stage: st.stageName })));
  notes.forEach((o) => {
    doc.font("Helvetica").fontSize(8.5);
    const th = doc.heightOfString(o.text, { width: w - 20 });
    ensure(doc, th + 22);
    const ny = doc.y;
    doc.roundedRect(M, ny, w, th + 16, 4).fill(C.note);
    doc.font("Helvetica-Bold").fontSize(7).fillColor(C.muted).text(`${o.stage} · ${o.userName} · ${fmt(o.createdAt)}`, M + 10, ny + 4, { lineBreak: false });
    doc.font("Helvetica").fontSize(8.5).fillColor(C.ink).text(o.text, M + 10, ny + 12, { width: w - 20 });
    doc.y = ny + th + 20;
  });
  doc.y += 6;
}

function generalObservations(doc: Doc, list: TravelerObservation[]) {
  sectionTitle(doc, "Observações");
  const w = W(doc);
  list.forEach((o) => {
    doc.font("Helvetica").fontSize(9);
    const th = doc.heightOfString(o.text, { width: w - 20 });
    ensure(doc, th + 26);
    const y = doc.y;
    doc.roundedRect(M, y, w, th + 20, 5).fill(C.note);
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C.muted).text(`${o.userName} · ${fmt(o.createdAt)}`, M + 10, y + 5, { lineBreak: false });
    doc.font("Helvetica").fontSize(9).fillColor(C.ink).text(o.text, M + 10, y + 15, { width: w - 20 });
    doc.y = y + th + 26;
  });
}

/** Quadro para notas à mão, a ocupar o espaço livre no fim da página (se houver pelo menos ~80pt). */
function notesBox(doc: Doc) {
  const free = bottomLimit(doc) - doc.y - 6;
  if (free < 60) return;
  const h = Math.min(free, 220);
  const y = doc.y;
  const w = W(doc);
  doc.roundedRect(M, y, w, h, 8).lineWidth(1).strokeColor(C.border).stroke();
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C.muted).text("NOTAS", M + 12, y + 9, { characterSpacing: 0.6, lineBreak: false });
  for (let ly = y + 40; ly < y + h - 10; ly += 22) {
    doc.moveTo(M + 12, ly).lineTo(M + w - 12, ly).strokeColor(C.border).lineWidth(0.7).stroke();
  }
  doc.y = y + h;
}

function footer(doc: Doc, externalId: string) {
  const range = doc.bufferedPageRange();
  const printed = fmt(new Date().toISOString());
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - M - 12;
    doc.moveTo(M, y - 6).lineTo(doc.page.width - M, y - 6).strokeColor(C.border).lineWidth(1).stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(C.muted);
    doc.text(`Central Minho Ferragens · Ficha de Produção ${externalId}`, M, y, { lineBreak: false });
    doc.text(`Impressa a ${printed} · Página ${i - range.start + 1} de ${range.count}`, M, y, { width: W(doc), align: "right", lineBreak: false });
  }
}
