import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { MosquitoItem, MosquitoRules } from "../types";
import { osColor } from "./CutPlanView";
import { useFeature } from "../contexts/FeaturesContext";

// ============================================================================
// Mosquiteiras → peças a cortar (pedido do utilizador de 2026-10-16):
// "queria pôr uma ordem de serviço de mosquiteiras e ele dar o plano de corte.
//  Nas alturas desconta x; nas larguras, quando tem menos de 1400 desconta f e
//  quando tem mais de 1400 desconta y."
//
//  - Alturas: sempre o mesmo perfil, 2 por mosquiteira, medida = altura − x.
//  - Larguras: até 1400 (inclusive) é um perfil e desconta f; acima de 1400 é
//    outro perfil e desconta y. 2026-10-29: "larguras são duas" — passam a
//    2 por mosquiteira por omissão (o servidor devolve esse valor enquanto
//    ninguém gravar outras regras), e alturas/larguras nunca se juntam.
// Os valores x, f, y (e o limite, quantidades e nomes dos perfis) ficam
// guardados no programa e o administrador muda-os aqui.
// ============================================================================

export const EMPTY_RULES: MosquitoRules = {
  heightDeduct: null,
  widthLimit: 1400,
  widthDeductSmall: null,
  widthDeductLarge: null,
  heightsPerUnit: 2,
  widthsPerUnit: 1,
  heightProfile: "Guias (alturas)",
  widthSmallProfile: "Largura até 1400",
  widthLargeProfile: "Largura acima de 1400",
};

export interface MosquitoRow {
  width: string;
  height: string;
  qty: string;
  finish: string;
  os: string; // nº da OS de onde vem (para identificar as peças nas barras)
  client: string;
}

export const emptyMosquitoRow = (os = ""): MosquitoRow => ({ width: "", height: "", qty: "1", finish: "", os, client: "" });

export interface GeneratedPiece {
  ref: string;
  description: string;
  length: number;
  qty: number;
  profile: string;
  os: string | null;
}

const num = (s: string | number | null | undefined) => Number(String(s ?? "").replace(",", "."));
const r1 = (n: number) => Math.round(n * 10) / 10;
const fmt = (n: number) => n.toLocaleString("pt-PT", { maximumFractionDigits: 1 });

export function rowsToItems(rows: MosquitoRow[]): MosquitoItem[] {
  return rows
    .filter((r) => r.width.trim() || r.height.trim())
    .map((r) => ({
      width: num(r.width),
      height: num(r.height),
      qty: Math.max(1, Math.round(num(r.qty) || 1)),
      finish: r.finish.trim() || null,
      os: r.os.trim() || null,
      client: r.client.trim() || null,
    }));
}

/**
 * Nomes dos perfis sempre diferentes entre alturas, larguras até ao limite e
 * larguras acima (pedido do utilizador de 2026-10-29: "nas mosquiteiras não
 * pode juntar larguras com alturas" / "separar nas larguras até 1400 e
 * superior a 1400"). Se tiverem ficado com o mesmo nome nas regras, ganham um
 * acrescento — o otimizador corta cada perfil em barras à parte.
 */
function distinctProfiles(rules: MosquitoRules) {
  const h = rules.heightProfile.trim() || "Alturas";
  let s = rules.widthSmallProfile.trim() || `Larguras até ${rules.widthLimit}`;
  let l = rules.widthLargeProfile.trim() || `Larguras acima de ${rules.widthLimit}`;
  if (s.toLowerCase() === h.toLowerCase()) s = `${s} — larguras até ${rules.widthLimit}`;
  if (l.toLowerCase() === h.toLowerCase() || l.toLowerCase() === s.toLowerCase()) l = `${l} — larguras acima de ${rules.widthLimit}`;
  return { h, s, l };
}

/** Aplica as regras e devolve as peças por perfil (medidas iguais juntas). */
export function generatePieces(items: MosquitoItem[], rules: MosquitoRules, opts: { separate?: boolean } = {}): GeneratedPiece[] {
  if (opts.separate) {
    const p = distinctProfiles(rules);
    rules = { ...rules, heightProfile: p.h, widthSmallProfile: p.s, widthLargeProfile: p.l };
  }
  const missing: string[] = [];
  if (rules.heightsPerUnit > 0 && rules.heightDeduct == null) missing.push("x (alturas)");
  const needSmall = items.some((i) => i.width <= rules.widthLimit);
  const needLarge = items.some((i) => i.width > rules.widthLimit);
  if (rules.widthsPerUnit > 0 && needSmall && rules.widthDeductSmall == null) missing.push(`f (larguras até ${rules.widthLimit})`);
  if (rules.widthsPerUnit > 0 && needLarge && rules.widthDeductLarge == null) missing.push(`y (larguras acima de ${rules.widthLimit})`);
  if (missing.length) throw new Error(`Preenche o desconto ${missing.join(", ")} antes de gerar as peças.`);

  const bad = items.find((i) => !(i.width > 0 && i.height > 0));
  if (bad) throw new Error("Há mosquiteiras sem largura ou altura.");

  // Medidas iguais juntam-se numa só linha, mas só dentro da mesma OS — para
  // cada peça continuar identificada com a sua obra.
  type Acc = { profile: string; prefix: string; length: number; qty: number; from: Set<string>; os: string | null };
  const acc = new Map<string, Acc>();
  const osOrder: string[] = [];
  let os: string | null = null;
  const add = (profile: string, prefix: string, length: number, qty: number, from: string) => {
    if (qty <= 0) return;
    if (!(length > 0)) throw new Error(`Medida final inválida (${fmt(length)} mm) — confirma os descontos.`);
    // Alturas e larguras nunca se juntam na mesma linha, mesmo com a mesma medida.
    const key = opts.separate ? `${prefix}|${profile}|${length}|${os ?? ""}` : `${profile}|${length}|${os ?? ""}`;
    const e = acc.get(key) ?? { profile, prefix, length, qty: 0, from: new Set<string>(), os };
    e.qty += qty;
    e.from.add(from);
    acc.set(key, e);
  };

  for (const it of items) {
    os = it.os?.trim() || null;
    if (!osOrder.includes(os ?? "")) osOrder.push(os ?? "");
    add(rules.heightProfile, "G", r1(it.height - (rules.heightDeduct ?? 0)), it.qty * rules.heightsPerUnit, `Alt. ${fmt(it.height)}`);
    const small = it.width <= rules.widthLimit;
    add(
      small ? rules.widthSmallProfile : rules.widthLargeProfile,
      small ? "L" : "M",
      r1(it.width - ((small ? rules.widthDeductSmall : rules.widthDeductLarge) ?? 0)),
      it.qty * rules.widthsPerUnit,
      `Larg. ${fmt(it.width)}`
    );
  }

  const order = [rules.heightProfile, rules.widthSmallProfile, rules.widthLargeProfile];
  const list = [...acc.values()].sort(
    (a, b) =>
      order.indexOf(a.profile) - order.indexOf(b.profile) ||
      osOrder.indexOf(a.os ?? "") - osOrder.indexOf(b.os ?? "") ||
      b.length - a.length
  );
  const counters: Record<string, number> = {};
  return list.map((e) => {
    counters[e.prefix] = (counters[e.prefix] ?? 0) + 1;
    return {
      ref: `${e.prefix}${counters[e.prefix]}`,
      description: [...e.from].join(", "),
      length: e.length,
      qty: e.qty,
      profile: e.profile,
      os: e.os,
    };
  });
}

export function MosquitoPanel({
  osRef,
  rules,
  setRules,
  rows,
  setRows,
  onGenerate,
  onServiceOrderFound,
  autoImport,
}: {
  osRef: string;
  rules: MosquitoRules;
  setRules: (r: MosquitoRules) => void;
  rows: MosquitoRow[];
  setRows: (r: MosquitoRow[]) => void;
  onGenerate: (pieces: GeneratedPiece[]) => void;
  onServiceOrderFound: (externalId: string, client?: string, isMain?: boolean) => void;
  autoImport?: boolean;
}) {
  // 2026-10-29 (em teste, "medidasOS"): alturas e larguras sempre separadas.
  const separate = useFeature("medidasOS").available;
  const [busy, setBusy] = useState<"import" | "rules" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const setRule = (patch: Partial<MosquitoRules>) => setRules({ ...rules, ...patch });
  const numOrNull = (v: string) => (v.trim() === "" ? null : num(v));
  const updateRow = (i: number, patch: Partial<MosquitoRow>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const [joinRef, setJoinRef] = useState("");

  async function importOs(refArg?: string) {
    const ref = (refArg ?? osRef).trim();
    if (!ref) {
      setMsg({ ok: false, text: "Escreve o nº da OS (no campo Ordem de Serviço lá em cima ou em Juntar OS)." });
      return;
    }
    setBusy("import");
    setMsg(null);
    try {
      const res = await api.get<{
        serviceOrder: { externalId: string; client?: { name: string } | null; product?: { name: string } | null };
        items: MosquitoItem[];
        missing: string[];
      }>(`/cut-plans/os-measures?ref=${encodeURIComponent(ref)}`);
      onServiceOrderFound(res.serviceOrder.externalId, res.serviceOrder.client?.name, ref === osRef.trim());
      if (!res.items.length) {
        setMsg({ ok: false, text: `A OS ${res.serviceOrder.externalId} não tem medidas (Larg. × Alt.) nos artigos. Escreve-as à mão abaixo.` });
        return;
      }
      // Junta às mosquiteiras que já lá estão (substitui as desta mesma OS).
      const os = res.serviceOrder.externalId;
      const client = res.serviceOrder.client?.name ?? "";
      const kept = rows.filter((r) => (r.width.trim() || r.height.trim()) && r.os.trim().toLowerCase() !== os.toLowerCase());
      setRows([
        ...kept,
        ...res.items.map((i) => ({ width: String(i.width), height: String(i.height), qty: String(i.qty), finish: i.finish ?? "", os, client })),
      ]);
      setJoinRef("");
      const total = res.items.reduce((a, i) => a + i.qty, 0);
      setMsg({
        ok: res.missing.length === 0,
        text:
          `OS ${res.serviceOrder.externalId}${res.serviceOrder.client ? ` — ${res.serviceOrder.client.name}` : ""}: ${total} mosquiteira(s) lida(s).` +
          (res.missing.length ? ` Sem medidas: ${res.missing.join("; ")}.` : ""),
      });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Erro ao ler a OS." });
    } finally {
      setBusy(null);
    }
  }

  async function saveRules() {
    setBusy("rules");
    setMsg(null);
    try {
      const saved = await api.put<MosquitoRules>("/cut-plans/mosquito-rules", rules);
      setRules(saved);
      setMsg({ ok: true, text: "Regras guardadas — passam a ser usadas por omissão." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Erro ao guardar as regras." });
    } finally {
      setBusy(null);
    }
  }

  function generate() {
    setMsg(null);
    try {
      const items = rowsToItems(rows);
      if (!items.length) throw new Error("Não há mosquiteiras — importa da OS ou escreve as medidas.");
      onGenerate(generatePieces(items, rules, { separate }));
      setMsg({ ok: true, text: "Peças geradas na lista abaixo. Carrega em Otimizar." });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  }

  // Vindo de uma OS de mosquiteiras: ler logo as medidas.
  const autoDone = useRef(false);
  useEffect(() => {
    if (autoImport && !autoDone.current) {
      autoDone.current = true;
      importOs(osRef);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoImport]);

  // OS presentes nas mosquiteiras (pela ordem em que foram juntadas)
  const osList: { os: string; client: string; units: number; index: number }[] = [];
  rows.forEach((r) => {
    const os = r.os.trim();
    if (!os || !(r.width.trim() || r.height.trim())) return;
    const e = osList.find((x) => x.os === os);
    if (e) e.units += num(r.qty) || 0;
    else osList.push({ os, client: r.client, units: num(r.qty) || 0, index: osList.length });
  });

  const totalUnits = rows.reduce((a, r) => a + (num(r.qty) || 0), 0);

  return (
    <div className="card">
      <div className="cut-section-head">
        <h3>Mosquiteiras</h3>
        <span className="muted">{totalUnits} unid.</span>
        <button type="button" className="btn secondary" onClick={() => importOs(osRef)} disabled={busy !== null}>
          {busy === "import" ? "A ler..." : "Importar medidas da OS"}
        </button>
      </div>

      <div className="cut-join-row">
        <input
          type="text"
          value={joinRef}
          onChange={(e) => setJoinRef(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (joinRef.trim()) importOs(joinRef);
            }
          }}
          placeholder="nº de outra OS (ex.: 2026/515 ou 515)"
        />
        <button type="button" className="btn secondary" disabled={busy !== null || !joinRef.trim()} onClick={() => importOs(joinRef)}>
          + Juntar OS
        </button>
        {osList.map((o) => (
          <span key={o.os} className="cut-os-chip" style={{ background: osColor(o.index).fill, borderColor: osColor(o.index).stroke, color: osColor(o.index).stroke }}>
            OS {o.os}
            {o.client ? ` — ${o.client}` : ""} · {o.units} un.
            <button
              type="button"
              title={`Tirar a OS ${o.os}`}
              onClick={() => {
                const left = rows.filter((r) => r.os.trim() !== o.os);
                setRows(left.length ? left : [emptyMosquitoRow()]);
              }}
            >
              ✕
            </button>
          </span>
        ))}
      </div>

      <div style={{ fontWeight: 600, margin: "4px 0 6px" }}>
        Descontos <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>— ficam escritos nas Notas do plano</span>
      </div>
      <div className="cut-rules">
        <label className="field">
          Alturas ({rules.heightsPerUnit} por mosquiteira): descontar <b>x</b> (mm)
          <input type="number" step="0.1" value={rules.heightDeduct ?? ""} onChange={(e) => setRule({ heightDeduct: numOrNull(e.target.value) })} />
        </label>
        <label className="field">
          Larguras até {rules.widthLimit} ({rules.widthsPerUnit} por mosquiteira): descontar <b>f</b> (mm)
          <input type="number" step="0.1" value={rules.widthDeductSmall ?? ""} onChange={(e) => setRule({ widthDeductSmall: numOrNull(e.target.value) })} />
        </label>
        <label className="field">
          Larguras acima de {rules.widthLimit} ({rules.widthsPerUnit} por mosquiteira): descontar <b>y</b> (mm)
          <input type="number" step="0.1" value={rules.widthDeductLarge ?? ""} onChange={(e) => setRule({ widthDeductLarge: numOrNull(e.target.value) })} />
        </label>
      </div>
      <details className="cut-rules-more">
        <summary>Mais regras (limite, quantidades, nomes dos perfis)</summary>
        <div className="cut-rules">
          <label className="field">
            Limite das larguras (mm)
            <input type="number" value={rules.widthLimit} onChange={(e) => setRule({ widthLimit: num(e.target.value) || 1400 })} />
          </label>
          <label className="field">
            Alturas por mosquiteira
            <input type="number" min={0} value={rules.heightsPerUnit} onChange={(e) => setRule({ heightsPerUnit: Math.max(0, Math.round(num(e.target.value) || 0)) })} />
          </label>
          <label className="field">
            Larguras por mosquiteira
            <input type="number" min={0} value={rules.widthsPerUnit} onChange={(e) => setRule({ widthsPerUnit: Math.max(0, Math.round(num(e.target.value) || 0)) })} />
          </label>
          <label className="field">
            Perfil das alturas
            <input type="text" value={rules.heightProfile} onChange={(e) => setRule({ heightProfile: e.target.value })} />
          </label>
          <label className="field">
            Perfil larguras até {rules.widthLimit}
            <input type="text" value={rules.widthSmallProfile} onChange={(e) => setRule({ widthSmallProfile: e.target.value })} />
          </label>
          <label className="field">
            Perfil larguras acima de {rules.widthLimit}
            <input type="text" value={rules.widthLargeProfile} onChange={(e) => setRule({ widthLargeProfile: e.target.value })} />
          </label>
        </div>
      </details>
      <button type="button" className="btn secondary" onClick={saveRules} disabled={busy !== null} style={{ marginBottom: 14 }}>
        {busy === "rules" ? "A guardar..." : "Guardar regras"}
      </button>

      <div className="cut-table-wrap">
        <table className="cut-input-table">
          <thead>
            <tr>
              <th>OS</th>
              <th>Largura</th>
              <th>Altura</th>
              <th>Quant.</th>
              <th>Acabamento</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <input type="text" value={r.os} onChange={(e) => updateRow(i, { os: e.target.value })} placeholder="—" style={{ width: 96 }} />
                </td>
                <td>
                  <input type="number" min={0} value={r.width} onChange={(e) => updateRow(i, { width: e.target.value })} style={{ width: 90 }} />
                </td>
                <td>
                  <input type="number" min={0} value={r.height} onChange={(e) => updateRow(i, { height: e.target.value })} style={{ width: 90 }} />
                </td>
                <td>
                  <input type="number" min={1} value={r.qty} onChange={(e) => updateRow(i, { qty: e.target.value })} style={{ width: 70 }} />
                </td>
                <td>
                  <input type="text" value={r.finish} onChange={(e) => updateRow(i, { finish: e.target.value })} />
                </td>
                <td>
                  <button
                    type="button"
                    className="link-button"
                    title="Remover"
                    onClick={() => setRows(rows.length > 1 ? rows.filter((_, k) => k !== i) : [emptyMosquitoRow()])}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <button type="button" className="btn secondary" onClick={() => setRows([...rows, emptyMosquitoRow(rows[rows.length - 1]?.os ?? "")])}>
          + Mosquiteira
        </button>
        <button type="button" className="btn" onClick={generate}>
          Gerar peças
        </button>
      </div>
      {msg && (
        <p style={{ margin: "10px 0 0", fontSize: 13, color: msg.ok ? "#067647" : "#b42318", fontWeight: 600 }}>{msg.text}</p>
      )}
    </div>
  );
}
