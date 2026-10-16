import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { MosquitoItem, MosquitoRules } from "../types";

// ============================================================================
// Mosquiteiras → peças a cortar (pedido do utilizador de 2026-10-16):
// "queria pôr uma ordem de serviço de mosquiteiras e ele dar o plano de corte.
//  Nas alturas desconta x; nas larguras, quando tem menos de 1400 desconta f e
//  quando tem mais de 1400 desconta y."
//
//  - Alturas: sempre o mesmo perfil, 2 por mosquiteira, medida = altura − x.
//  - Larguras: 1 por mosquiteira; até 1400 (inclusive) é um perfil e desconta
//    f; acima de 1400 é outro perfil e desconta y.
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
}

export interface GeneratedPiece {
  ref: string;
  description: string;
  length: number;
  qty: number;
  profile: string;
}

const num = (s: string | number | null | undefined) => Number(String(s ?? "").replace(",", "."));
const r1 = (n: number) => Math.round(n * 10) / 10;
const fmt = (n: number) => n.toLocaleString("pt-PT", { maximumFractionDigits: 1 });

export function rowsToItems(rows: MosquitoRow[]): MosquitoItem[] {
  return rows
    .filter((r) => r.width.trim() || r.height.trim())
    .map((r) => ({ width: num(r.width), height: num(r.height), qty: Math.max(1, Math.round(num(r.qty) || 1)), finish: r.finish.trim() || null }));
}

/** Aplica as regras e devolve as peças por perfil (medidas iguais juntas). */
export function generatePieces(items: MosquitoItem[], rules: MosquitoRules): GeneratedPiece[] {
  const missing: string[] = [];
  if (rules.heightsPerUnit > 0 && rules.heightDeduct == null) missing.push("x (alturas)");
  const needSmall = items.some((i) => i.width <= rules.widthLimit);
  const needLarge = items.some((i) => i.width > rules.widthLimit);
  if (rules.widthsPerUnit > 0 && needSmall && rules.widthDeductSmall == null) missing.push(`f (larguras até ${rules.widthLimit})`);
  if (rules.widthsPerUnit > 0 && needLarge && rules.widthDeductLarge == null) missing.push(`y (larguras acima de ${rules.widthLimit})`);
  if (missing.length) throw new Error(`Preenche o desconto ${missing.join(", ")} antes de gerar as peças.`);

  const bad = items.find((i) => !(i.width > 0 && i.height > 0));
  if (bad) throw new Error("Há mosquiteiras sem largura ou altura.");

  type Acc = { profile: string; prefix: string; length: number; qty: number; from: Set<string> };
  const acc = new Map<string, Acc>();
  const add = (profile: string, prefix: string, length: number, qty: number, from: string) => {
    if (qty <= 0) return;
    if (!(length > 0)) throw new Error(`Medida final inválida (${fmt(length)} mm) — confirma os descontos.`);
    const key = `${profile}|${length}`;
    const e = acc.get(key) ?? { profile, prefix, length, qty: 0, from: new Set<string>() };
    e.qty += qty;
    e.from.add(from);
    acc.set(key, e);
  };

  for (const it of items) {
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
    (a, b) => order.indexOf(a.profile) - order.indexOf(b.profile) || b.length - a.length
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
  onServiceOrderFound: (externalId: string, client?: string) => void;
  autoImport?: boolean;
}) {
  const [busy, setBusy] = useState<"import" | "rules" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const setRule = (patch: Partial<MosquitoRules>) => setRules({ ...rules, ...patch });
  const numOrNull = (v: string) => (v.trim() === "" ? null : num(v));
  const updateRow = (i: number, patch: Partial<MosquitoRow>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  async function importOs() {
    if (!osRef.trim()) {
      setMsg({ ok: false, text: "Escreve primeiro o nº da OS no campo Ordem de Serviço (lá em cima)." });
      return;
    }
    setBusy("import");
    setMsg(null);
    try {
      const res = await api.get<{
        serviceOrder: { externalId: string; client?: { name: string } | null; product?: { name: string } | null };
        items: MosquitoItem[];
        missing: string[];
      }>(`/cut-plans/os-measures?ref=${encodeURIComponent(osRef.trim())}`);
      onServiceOrderFound(res.serviceOrder.externalId, res.serviceOrder.client?.name);
      if (!res.items.length) {
        setMsg({ ok: false, text: `A OS ${res.serviceOrder.externalId} não tem medidas (Larg. × Alt.) nos artigos. Escreve-as à mão abaixo.` });
        return;
      }
      setRows(res.items.map((i) => ({ width: String(i.width), height: String(i.height), qty: String(i.qty), finish: i.finish ?? "" })));
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
      onGenerate(generatePieces(items, rules));
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
      importOs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoImport]);

  const totalUnits = rows.reduce((a, r) => a + (num(r.qty) || 0), 0);

  return (
    <div className="card">
      <div className="cut-section-head">
        <h3>Mosquiteiras</h3>
        <span className="muted">{totalUnits} unid.</span>
        <button type="button" className="btn secondary" onClick={importOs} disabled={busy !== null}>
          {busy === "import" ? "A ler..." : "Importar medidas da OS"}
        </button>
      </div>

      <div className="cut-rules">
        <label className="field">
          Alturas: descontar <b>x</b> (mm)
          <input type="number" step="0.1" value={rules.heightDeduct ?? ""} onChange={(e) => setRule({ heightDeduct: numOrNull(e.target.value) })} />
        </label>
        <label className="field">
          Larguras até {rules.widthLimit}: descontar <b>f</b> (mm)
          <input type="number" step="0.1" value={rules.widthDeductSmall ?? ""} onChange={(e) => setRule({ widthDeductSmall: numOrNull(e.target.value) })} />
        </label>
        <label className="field">
          Larguras acima de {rules.widthLimit}: descontar <b>y</b> (mm)
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
                    onClick={() => setRows(rows.length > 1 ? rows.filter((_, k) => k !== i) : [{ width: "", height: "", qty: "1", finish: "" }])}
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
        <button type="button" className="btn secondary" onClick={() => setRows([...rows, { width: "", height: "", qty: "1", finish: "" }])}>
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
