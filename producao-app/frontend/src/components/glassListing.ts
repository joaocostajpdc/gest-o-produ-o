import { downloadBlob } from "../api/client";
import { GLASS_ORDER_STATUS_LABELS, GlassOrder } from "../types";

// ============================================================================
// Listagem dos Pedidos de Vidros (pedido do utilizador de 2026-10-29: "quero
// poder tirar listagem disto"). Sai exatamente o que está na tabela com os
// filtros escolhidos: para imprimir (ou guardar em PDF a partir da janela de
// impressão) ou em CSV para o Excel.
// ============================================================================

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const day = (iso: string) => new Date(iso).toLocaleDateString("pt-PT", { timeZone: "UTC" });

function rows(items: GlassOrder[]) {
  return items.map((o) => ({
    data: day(o.date),
    nRef: o.nRef ?? "",
    cliente: o.serviceOrder?.client?.name ?? "",
    fornecedor: o.supplier?.name ?? "",
    medida: o.medida,
    caixa: o.caixa,
    quant: String(o.quantity),
    estado: GLASS_ORDER_STATUS_LABELS[o.status],
    encomenda: o.orderNumber ?? "",
    previsao: o.expectedDelivery ?? "",
    nota: o.notes ?? "",
    status: o.status,
  }));
}

const HEAD = ["Data", "N/Ref.", "Cliente", "Fornecedor", "Medida", "Caixa", "Quant.", "Estado", "Nº Encomenda", "Previsão", "Nota"];
const COLOR: Record<string, string> = { POR_ENCOMENDAR: "#fef2f2", ENCOMENDADO: "#fff7db", FINALIZADO: "#ecf7e6" };

export function printGlassListing(items: GlassOrder[], filtersSummary: string) {
  const r = rows(items);
  const totalQt = items.reduce((a, o) => a + o.quantity, 0);
  const now = new Date().toLocaleString("pt-PT");
  const html = `<!doctype html><html lang="pt"><head><meta charset="utf-8"><title>Listagem de Pedidos de Vidros</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #161b2c; margin: 0; font-size: 11px; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; background: #161b2c; color: #fff; padding: 12px 16px; border-radius: 6px; }
  .head h1 { font-size: 16px; margin: 0; } .head .sub { color: #9db4ff; font-size: 12px; margin-top: 2px; }
  .meta { text-align: right; font-size: 10px; color: #cfd6e6; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th { text-align: left; font-size: 9px; text-transform: uppercase; color: #667085; background: #f4f5f7; padding: 6px; border-bottom: 1px solid #e2e4e9; }
  td { padding: 6px; border-bottom: 1px solid #e2e4e9; vertical-align: top; }
  td.n { text-align: right; }
  tfoot td { font-weight: bold; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style></head><body>
<div class="head"><div><h1>Pedidos de Vidros</h1><div class="sub">Listagem</div></div>
<div class="meta">Gerado em ${esc(now)}<br>${r.length} pedido(s) · ${esc(filtersSummary)}</div></div>
<table><thead><tr>${HEAD.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>
${r
  .map(
    (x) => `<tr style="background:${COLOR[x.status]}"><td>${esc(x.data)}</td><td>${esc(x.nRef)}</td><td>${esc(x.cliente)}</td><td>${esc(
      x.fornecedor
    )}</td><td>${esc(x.medida)}</td><td>${esc(x.caixa)}</td><td class="n">${x.quant}</td><td>${esc(x.estado)}</td><td>${esc(
      x.encomenda
    )}</td><td>${esc(x.previsao)}</td><td>${esc(x.nota)}</td></tr>`
  )
  .join("")}
</tbody><tfoot><tr><td colspan="6">Total</td><td class="n">${totalQt}</td><td colspan="4"></td></tr></tfoot></table>
<script>window.onload = () => { window.print(); };</script>
</body></html>`;
  const w = window.open("", "_blank");
  if (!w) {
    downloadBlob(new Blob([html], { type: "text/html" }), "listagem-pedidos-vidros.html");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

export function exportGlassCsv(items: GlassOrder[]) {
  const r = rows(items);
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv = [
    HEAD.join(";"),
    ...r.map((x) => [x.data, x.nRef, x.cliente, x.fornecedor, x.medida, x.caixa, x.quant, x.estado, x.encomenda, x.previsao, x.nota].map(q).join(";")),
  ].join("\n");
  // BOM para o Excel abrir os acentos bem.
  downloadBlob(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), "listagem-pedidos-vidros.csv");
}
