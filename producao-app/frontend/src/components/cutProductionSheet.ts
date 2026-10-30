import { CutPlan } from "../types";
import { osColor, planOrders } from "./CutPlanView";

// ============================================================================
// Folha de corte para a produção (pedido do utilizador de 2026-10-29: "um
// melhor imprimível para a produção"). Feita para levar para a máquina:
//  - sem números de gestão (aproveitamento, metros…), só o que o operador usa;
//  - por perfil: lista de corte (medida grande, quantidade, para que OS) com
//    quadrados para ir riscando, e as barras desenhadas pela ordem dos cortes
//    (barras iguais juntas, "× 3"), com a sobra a guardar;
//  - mosquiteiras: medidas da obra e medidas cortadas, para a montagem;
//  - descontos usados e campo para quem cortou.
// Abre numa janela própria e manda imprimir (A4 ao alto).
// ============================================================================

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const mm = (n: number) => n.toLocaleString("pt-PT", { maximumFractionDigits: 1 });

export function printCutProductionSheet(plan: CutPlan) {
  if (plan.input.mode !== "BARRAS" || plan.result.mode !== "BARRAS") return false;
  const input = plan.input;
  const result = plan.result;
  const settings = input.settings;
  const orders = planOrders(input);
  const allOs = [
    ...(plan.serviceOrder ? [{ os: plan.serviceOrder.externalId, client: plan.serviceOrder.client?.name ?? null }] : []),
    ...(plan.extraServiceOrders ?? []).map((o) => ({ os: o.externalId, client: o.client?.name ?? null })),
  ];
  orders.forEach((o) => !allOs.some((x) => x.os === o.os) && allOs.push({ os: o.os, client: o.client }));
  const osIdx = (os?: string | null) => orders.findIndex((o) => o.os === (os ?? "").trim());
  const osChip = (os?: string | null) => {
    const i = osIdx(os);
    if (!os || i < 0) return "";
    const c = osColor(i);
    return `<span class="os" style="background:${c.fill};color:${c.stroke};border-color:${c.stroke}">${esc(os.split("/").pop() || os)}</span>`;
  };

  const profiles = [...new Set(result.bars.map((b) => b.profile ?? ""))];
  if (!profiles.length) profiles.push("");

  const rules = input.mosquitoRules;
  const ded = (n: number | null | undefined) => (n == null ? "—" : `−${mm(n)} mm`);

  let sections = "";
  for (const profile of profiles) {
    const bars = result.bars.filter((b) => (b.profile ?? "") === profile);
    // Lista de corte: peças deste perfil, maiores primeiro
    const types = input.pieces
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => (p.profile ?? "") === profile)
      .sort((a, b) => b.p.length - a.p.length);
    const totalPieces = types.reduce((a, t) => a + t.p.qty, 0);

    const listRows = types
      .map(
        ({ p }) => `<tr>
          <td class="big">${mm(p.length)}</td>
          <td class="qty">${p.qty}</td>
          <td>${esc(p.ref)}</td>
          <td>${osChip(p.os)} ${esc(p.os ?? "")}</td>
          <td class="muted">${esc(p.description ?? "")}</td>
          <td class="ck">${"☐ ".repeat(Math.min(p.qty, 12)).trim()}${p.qty > 12 ? " …" : ""}</td>
        </tr>`
      )
      .join("");

    // Barras iguais juntas
    const groups: { key: string; bar: (typeof bars)[number]; count: number }[] = [];
    bars.forEach((b) => {
      const key = `${b.length}|${b.pieces.map((p) => `${p.typeIndex}:${p.length}`).join(";")}`;
      const g = groups.find((x) => x.key === key);
      if (g) g.count++;
      else groups.push({ key, bar: b, count: 1 });
    });
    const barRows = groups
      .map((g, gi) => {
        const b = g.bar;
        const segs = b.pieces
          .map((p) => {
            const piece = input.pieces[p.typeIndex];
            const i = osIdx(piece?.os);
            const c = i >= 0 ? osColor(i) : { fill: "#e5e7eb", stroke: "#374151" };
            const w = Math.max((p.length / b.length) * 100, 4);
            return `<div class="seg" style="width:${w}%;background:${c.fill};border-color:${c.stroke}"><b>${mm(p.length)}</b><small>${esc(p.ref)}</small></div>`;
          })
          .join("");
        const remW = Math.max((b.remnant / b.length) * 100, 0);
        const rem =
          b.remnant > 0
            ? `<div class="seg rem${b.reusable ? " keep" : ""}" style="width:${remW}%"><small>${b.reusable ? "guardar " : ""}${mm(b.remnant)}</small></div>`
            : "";
        const seq = b.pieces.map((p) => mm(p.length)).join(" · ");
        return `<div class="bar">
          <div class="bar-head"><span class="ck">${"☐ ".repeat(Math.min(g.count, 10)).trim()}</span>
            <b>Barra ${gi + 1}${g.count > 1 ? ` <span class="times">× ${g.count}</span>` : ""}</b>
            <span class="muted">${mm(b.length)} mm · cortar: ${seq}${b.remnant > 0 ? ` · sobra ${mm(b.remnant)}${b.reusable ? " (guardar)" : ""}` : ""}</span></div>
          <div class="track">${segs}${rem}</div>
        </div>`;
      })
      .join("");

    sections += `<section>
      <div class="keep"><h2>${esc(profile || "Peças")}<span>${totalPieces} peças · ${bars.length} barra(s)</span></h2>
      <table class="list"><thead><tr><th>Medida (mm)</th><th>Qt.</th><th>Ref.</th><th>OS</th><th>Origem</th><th>Cortado</th></tr></thead><tbody>${listRows}</tbody></table></div>
      <div class="bars">${barRows}</div>
    </section>`;
  }

  // Mosquiteiras (para a montagem)
  let mosq = "";
  if (input.mosquitos?.length) {
    const rows = input.mosquitos
      .map((m) => {
        const small = rules ? m.width <= rules.widthLimit : true;
        const wd = rules ? (small ? rules.widthDeductSmall : rules.widthDeductLarge) ?? 0 : 0;
        const hd = (small ? rules?.heightDeduct : rules?.heightDeductLarge ?? rules?.heightDeduct) ?? 0;
        return `<tr>
          <td>${osChip(m.os)} ${esc(m.os ?? "")}</td>
          <td>${esc(m.client ?? "")}</td>
          <td class="big">${mm(m.width)} × ${mm(m.height)}</td>
          <td class="qty">${m.qty}</td>
          <td>${esc(m.finish ?? "")}</td>
          <td>${mm(m.height - hd)} <span class="muted">× ${rules?.heightsPerUnit ?? 2}</span></td>
          <td>${mm(m.width - wd)} <span class="muted">× ${rules?.widthsPerUnit ?? 1}</span></td>
          <td class="ck">☐</td>
        </tr>`;
      })
      .join("");
    mosq = `<section class="keep">
      <h2>Mosquiteiras<span>${input.mosquitos.reduce((a, m) => a + m.qty, 0)} unid.</span></h2>
      <table class="list"><thead><tr><th>OS</th><th>Cliente</th><th>Larg. × Alt.</th><th>Qt.</th><th>Acabamento</th><th>Altura cortada</th><th>Largura cortada</th><th>Feito</th></tr></thead><tbody>${rows}</tbody></table>
    </section>`;
  }

  const unplaced = result.unplaced.length
    ? `<div class="warn">Atenção — peças que não couberam nas barras: ${result.unplaced.map((u) => `${esc(u.ref)} (${u.qty}× — ${esc(u.reason)})`).join("; ")}</div>`
    : "";

  const osLine = allOs
    .map((o) => `${osChip(o.os) || ""} <b>OS ${esc(o.os)}</b>${o.client ? ` — ${esc(o.client)}` : ""}`)
    .join("&nbsp;&nbsp;&nbsp;");
  const dedLine = rules
    ? `<div class="ded"><b>Descontos:</b> alturas ${ded(rules.heightDeduct)} com largura até ${mm(rules.widthLimit)} · ${ded(rules.heightDeductLarge ?? rules.heightDeduct)} acima (${rules.heightsPerUnit} por mosquiteira) · larguras até ${mm(rules.widthLimit)} ${ded(rules.widthDeductSmall)} · acima de ${mm(rules.widthLimit)} ${ded(rules.widthDeductLarge)} (${rules.widthsPerUnit} por mosquiteira)</div>`
    : "";
  const notes = (plan.notes ?? "").replace(/Descontos das mosquiteiras:[\s\S]*?(\n\n|$)/, "").trim();

  const html = `<!doctype html><html lang="pt"><head><meta charset="utf-8"><title>PC-${plan.number} — Folha de corte</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; font-size: 12px; }
  header { border: 2px solid #111; border-radius: 6px; padding: 10px 12px; display: grid; grid-template-columns: 1fr auto; gap: 4px 16px; }
  header h1 { margin: 0; font-size: 20px; }
  header .pc { font-size: 26px; font-weight: 800; text-align: right; }
  header .meta { color: #333; }
  header .meta, header .ded, header .notes { grid-column: 1 / -1; }
  .ded { background: #fff8e1; border: 1px solid #f1d27a; border-radius: 4px; padding: 4px 8px; }
  .notes { white-space: pre-wrap; }
  .os { display: inline-block; border: 1.5px solid; border-radius: 4px; padding: 0 5px; font-weight: 700; font-size: 11px; }
  section { margin-top: 12px; break-inside: auto; }
  .keep { break-inside: avoid; }
  h2 { break-after: avoid; font-size: 16px; margin: 0 0 6px; padding: 4px 8px; background: #111; color: #fff; border-radius: 4px; display: flex; justify-content: space-between; align-items: baseline; }
  h2 span { font-size: 12px; font-weight: 400; }
  table.list { width: 100%; border-collapse: collapse; }
  .list th { text-align: left; font-size: 10px; text-transform: uppercase; border-bottom: 2px solid #111; padding: 4px 6px; }
  .list td { border-bottom: 1px solid #bbb; padding: 5px 6px; vertical-align: middle; }
  .list tr { break-inside: avoid; }
  td.big { font-size: 18px; font-weight: 800; white-space: nowrap; }
  td.qty { font-size: 16px; font-weight: 700; text-align: center; }
  .ck { font-size: 15px; letter-spacing: 1px; white-space: nowrap; }
  .muted { color: #555; font-size: 11px; }
  .bars { margin-top: 8px; display: flex; flex-direction: column; gap: 7px; }
  .bar { break-inside: avoid; border: 1px solid #ccc; border-radius: 4px; padding: 5px 6px; }
  .bar-head { display: flex; gap: 8px; align-items: baseline; margin-bottom: 4px; flex-wrap: wrap; }
  .times { background: #111; color: #fff; border-radius: 3px; padding: 0 5px; }
  .track { display: flex; height: 34px; border: 1.5px solid #111; border-radius: 3px; overflow: hidden; }
  .seg { border-right: 2px solid; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; line-height: 1.05; }
  .seg b { font-size: 13px; } .seg small { font-size: 9px; }
  .seg.rem { background: repeating-linear-gradient(45deg, #eee, #eee 4px, #fff 4px, #fff 8px); border-right: none; color: #555; }
  .seg.rem.keep { background: repeating-linear-gradient(45deg, #dcfce7, #dcfce7 4px, #fff 4px, #fff 8px); color: #166534; font-weight: 700; }
  .warn { margin-top: 10px; border: 2px solid #b91c1c; color: #b91c1c; padding: 6px 8px; border-radius: 4px; font-weight: 700; }
  footer { margin-top: 16px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; font-size: 12px; }
  footer div { border-top: 1px solid #111; padding-top: 4px; }
</style></head><body>
<header>
  <div><h1>${esc(plan.name)}</h1></div>
  <div class="pc">PC-${plan.number}</div>
  <div class="meta">${osLine}</div>
  <div class="meta">${esc(plan.material ?? "")}${plan.material ? " · " : ""}Lâmina ${mm(settings.kerf)} mm · topo ${mm(settings.trim)} mm · guardar sobras ≥ ${mm(settings.minRemnant)} mm · ${new Date(plan.createdAt).toLocaleDateString("pt-PT")}${plan.createdBy ? ` · ${esc(plan.createdBy.name)}` : ""}</div>
  ${dedLine}
  ${notes ? `<div class="notes">${esc(notes)}</div>` : ""}
</header>
${unplaced}
${mosq}
${sections}
<footer><div>Cortado por</div><div>Data</div><div>Conferido por</div></footer>
<script>window.onload = () => setTimeout(() => window.print(), 150);</script>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
