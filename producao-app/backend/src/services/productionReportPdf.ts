import { PUBLIC_APP_URL } from "../config/publicUrl";
import { ProductionReport, buildProductionReport, fmtPT } from "./productionReportService";
import { ReportKpi, ReportSection, renderReportPdf } from "./weeklyReportPdf";

// ============================================================================
// PDF do relatório de produção (2026-10-26). Usado no botão "Tirar PDF" da
// página Relatórios e nos envios automáticos semanal e mensal.
// ============================================================================

const n1 = (v: number | null) => (v === null ? "—" : v.toLocaleString("pt-PT", { maximumFractionDigits: 1 }));
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

export function reportKpis(r: ProductionReport): ReportKpi[] {
  const k = r.numeros;
  return [
    { label: "OS entradas", value: String(k.entradas) },
    { label: "OS concluídas", value: String(k.concluidas) },
    {
      label: "Prazo cumprido",
      value: k.prazoCumprido === null ? "—" : `${k.prazoCumprido}%`,
      sub: k.concluidasComPrazo ? `${k.concluidasNoPrazo} de ${k.concluidasComPrazo} com prazo` : "sem OS com prazo",
      tone: k.prazoCumprido === null ? undefined : k.prazoCumprido >= 85 ? "good" : k.prazoCumprido < 70 ? "danger" : undefined,
    },
    { label: "Tempo médio", value: k.diasMedios === null ? "—" : `${n1(k.diasMedios)} dias`, sub: "da entrada à conclusão" },
    { label: "Em curso agora", value: String(k.emCurso), sub: `${k.porEstado.EM_PRODUCAO} em produção · ${k.porEstado.SUSPENSA} suspensas` },
    { label: "Atrasadas agora", value: String(k.atrasadas), tone: k.atrasadas ? "danger" : "good" },
    { label: "Paragens", value: String(r.paragens.total), sub: `${n1(r.paragens.horas)} h paradas${r.paragens.abertas ? ` · ${r.paragens.abertas} em curso` : ""}` },
    { label: "Atividade registada", value: String(r.atividadeTotal), sub: "movimentos no histórico" },
  ];
}

export function reportSections(r: ProductionReport, opts: { atividade?: number } = {}): ReportSection[] {
  const S: ReportSection[] = [];
  S.push({
    title: `Atrasadas agora (${r.atrasadas.length})`,
    tone: r.atrasadas.length ? "danger" : undefined,
    headers: ["OS", "Cliente", "Produto", "Etapa", "Estado", "Prazo", "Dias de atraso"],
    widths: [70, 170, 150, 110, 90, 70, 80],
    rows: r.atrasadas.map((o) => [o.os, o.cliente, o.produto, o.etapa, o.estado, fmtPT(o.prazo), String(o.diasAtraso)]),
    empty: "Nenhuma OS com o prazo ultrapassado.",
  });
  S.push({
    title: "Etapas — tempo médio no período e trabalho que está agora em cada uma",
    headers: ["Etapa", "Passagens concluídas", "Tempo médio (h)", "OS agora na etapa", "Mais antiga (dias)"],
    widths: [200, 120, 110, 120, 110],
    rows: r.etapas.map((e) => [e.etapa, String(e.passagens), n1(e.horasMedias), String(e.agora), n1(e.maisAntigaDias)]),
    empty: "Sem movimentos nas etapas.",
  });
  S.push({
    title: "Onde está parado há mais tempo",
    headers: ["OS", "Cliente", "Produto", "Etapa atual", "Dias na etapa", "Prazo"],
    widths: [70, 180, 160, 170, 80, 80],
    rows: r.paradas.map((o) => [o.os, o.cliente, o.produto, o.etapa, n1(o.dias), o.prazo ? fmtPT(o.prazo) : "—"]),
    lateRows: r.paradas.map((o) => !!o.prazo && o.prazo < r.geradoEm.slice(0, 10)),
    empty: "Nenhuma OS em curso.",
  });
  S.push({
    title: `Paragens (${r.paragens.total}) · ${n1(r.paragens.horas)} h`,
    headers: ["Motivo", "Nº", "Horas paradas"],
    widths: [400, 100, 120],
    rows: r.paragens.porMotivo.map((m) => [m.motivo, String(m.n), n1(m.horas)]),
    empty: "Sem paragens no período.",
  });
  if (r.paragens.lista.length) {
    S.push({
      title: "Paragens — detalhe",
      tone: "muted",
      headers: ["OS", "Cliente", "Motivo", "Início", "Fim", "Horas", "Quem"],
      widths: [65, 150, 210, 80, 80, 55, 110],
      rows: r.paragens.lista.map((p) => [p.os, p.cliente, p.motivo, p.inicio, p.fim ?? "em curso", n1(p.horas), p.quem]),
    });
  }
  S.push({
    title: `Concluídas no período (${r.concluidas.length})`,
    headers: ["OS", "Cliente", "Produto", "Entrou", "Concluída", "Dias", "No prazo"],
    widths: [70, 180, 160, 75, 75, 55, 70],
    rows: r.concluidas.map((o) => [o.os, o.cliente, o.produto, fmtPT(o.entrada), fmtPT(o.concluida), n1(o.dias), o.noPrazo === null ? "—" : o.noPrazo ? "Sim" : "Não"]),
    lateRows: r.concluidas.map((o) => o.noPrazo === false),
    empty: "Nenhuma OS concluída no período.",
  });
  if (r.porProduto.length) {
    S.push({
      title: "Por produto",
      headers: ["Produto", "Entradas", "Concluídas"],
      widths: [400, 110, 110],
      rows: r.porProduto.map((p) => [p.produto, String(p.entradas), String(p.concluidas)]),
    });
  }
  S.push({
    title: "Por pessoa — o que cada um registou no programa",
    headers: ["Pessoa", "Etapas concluídas", "Entradas em etapa", "Observações", "Paragens", "OS criadas", "Total"],
    widths: [190, 100, 100, 90, 80, 80, 70],
    rows: r.porUtilizador.map((u) => [u.nome, String(u.etapasConcluidas), String(u.entradasEtapa), String(u.observacoes), String(u.paragens), String(u.criadas), String(u.total)]),
    empty: "Sem atividade registada.",
  });
  if (r.horas.length) {
    S.push({
      title: "Horas dos colaboradores",
      headers: ["Colaborador", "Dias", "Horas", "Horas extra", "Faltas", "Férias", "Baixa"],
      widths: [210, 70, 80, 90, 70, 70, 70],
      rows: r.horas.map((h) => [h.nome, String(h.dias), n1(h.horas), n1(h.extra), String(h.faltas), String(h.ferias), String(h.baixa)]),
    });
  }
  const o = r.outras;
  S.push({
    title: "Outras áreas",
    headers: ["Área", "No período", "Situação agora"],
    widths: [260, 220, 220],
    rows: [
      ["Material a pedir", `${o.materialPedido} pedidos · ${o.materialRecebido} recebidos`, `${o.materialPorPedir} por pedir`],
      ["Pó (lacagem)", `${n1(o.poEntradaKg)} kg entrada · ${n1(o.poSaidaKg)} kg saída`, ""],
      ["Vidros", `${o.vidrosRegistados} registados`, `${o.vidrosPorEncomendar} por encomendar`],
      [
        "Orçamentos",
        `${o.orcamentosCriados} criados`,
        Object.entries(o.orcamentosPorEstado)
          .map(([e, n]) => `${n} ${e.toLowerCase()}`)
          .join(" · "),
      ],
    ],
  });
  const max = opts.atividade ?? 150;
  S.push({
    title: `Registo de atividade (${r.atividadeTotal}${r.atividadeTotal > max ? `, últimos ${max}` : ""})`,
    tone: "muted",
    headers: ["Quando", "OS", "Cliente", "O quê", "Detalhe", "Quem"],
    widths: [70, 60, 140, 110, 260, 110],
    rows: r.atividade.slice(0, max).map((a) => [a.hora, a.os, a.cliente, a.tipoLabel, a.descricao, a.quem]),
    empty: "Nada registado no período.",
  });
  return S;
}

export async function productionReportPdf(from: string, to: string, kindLabel = "Central · relatório de produção") {
  const r = await buildProductionReport(from, to);
  const pdf = await renderReportPdf({
    title: "Relatório de produção",
    subtitle: r.label,
    kind: kindLabel,
    kpis: reportKpis(r),
    sections: reportSections(r),
    link: PUBLIC_APP_URL,
  });
  return { r, pdf, file: `relatorio-producao-${from}${from === to ? "" : `-a-${to}`}.pdf` };
}

/** Resumo curto para a legenda do Telegram e o corpo do email. */
export function reportCaption(r: ProductionReport) {
  const k = r.numeros;
  return (
    `📊 <b>Relatório de produção</b>\n${esc(r.label)}\n` +
    `${k.entradas} entradas · ${k.concluidas} concluídas` +
    (k.prazoCumprido !== null ? ` · ${k.prazoCumprido}% no prazo` : "") +
    `\n${k.emCurso} em curso` +
    (k.atrasadas ? ` · 🔴 ${k.atrasadas} atrasadas` : "") +
    (r.paragens.total ? ` · ${r.paragens.total} paragens (${n1(r.paragens.horas)} h)` : "")
  );
}

export function reportHtml(r: ProductionReport) {
  const k = r.numeros;
  const li = (a: string, b: string) => `<tr><td style="padding:6px 10px;color:#667085">${esc(a)}</td><td style="padding:6px 10px;font-weight:bold">${esc(b)}</td></tr>`;
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1b2033;max-width:700px">
<h2 style="margin:0 0 4px;color:#1f3fe0">Relatório de produção</h2>
<p style="margin:0 0 16px;color:#667085">${esc(r.label)}</p>
<table cellspacing="0" style="border-collapse:collapse;border:1px solid #e4e6ed">
${li("OS entradas", String(k.entradas))}${li("OS concluídas", String(k.concluidas))}
${li("Prazo cumprido", k.prazoCumprido === null ? "—" : `${k.prazoCumprido}%`)}${li("Tempo médio", k.diasMedios === null ? "—" : `${n1(k.diasMedios)} dias`)}
${li("Em curso agora", String(k.emCurso))}${li("Atrasadas agora", String(k.atrasadas))}
${li("Paragens", `${r.paragens.total} (${n1(r.paragens.horas)} h)`)}
</table>
<p style="margin-top:14px">O relatório completo vai em PDF, em anexo.</p>
<p style="margin-top:20px;font-size:12px;color:#667085">Enviado automaticamente pela Central Minho Ferragens — <a href="${PUBLIC_APP_URL}/relatorios">${PUBLIC_APP_URL}/relatorios</a></p></div>`;
}
