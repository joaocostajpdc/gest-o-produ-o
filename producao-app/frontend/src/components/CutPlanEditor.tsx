import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import { CutPlan, CutPlanInput, CutPlanMode, CutResult, MosquitoRules } from "../types";
import { CutPlanView } from "./CutPlanView";
import { EMPTY_RULES, GeneratedPiece, MosquitoPanel, MosquitoRow, rowsToItems } from "./MosquitoPanel";

// ============================================================================
// Editor de um plano de corte (Otimização de Corte, 2026-10-16): medidas das
// peças, formatos de chapa / comprimentos de barra disponíveis e definições
// de corte. "Otimizar" mostra o resultado sem gravar; "Gravar plano" guarda-o
// (e liga-o à OS, se indicada).
// ============================================================================

// Formatos fixos de chapa da JPDC (desde out/2026) — podem misturar-se.
export const DEFAULT_SHEET_STOCK = [
  { length: "3000", width: "1250", qty: "" },
  { length: "3000", width: "1500", qty: "" },
  { length: "3000", width: "800", qty: "" },
  { length: "2500", width: "1250", qty: "" },
  { length: "2000", width: "1000", qty: "" },
  { length: "4000", width: "1250", qty: "" },
];
const DEFAULT_BAR_STOCK = [{ length: "6000", width: "", qty: "" }];

interface PieceRow {
  ref: string;
  description: string;
  width: string;
  length: string;
  qty: string;
  rotate: boolean;
  bends: string;
  cornerCuts: string;
  profile: string; // barras: perfil de onde sai a peça
}
interface StockRow {
  length: string;
  width: string;
  qty: string;
}

function refFor(i: number) {
  // A, B, ..., Z, AA, AB, ...
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

const emptyPiece = (i: number): PieceRow => ({
  ref: refFor(i),
  description: "",
  width: "",
  length: "",
  qty: "1",
  rotate: true,
  bends: "",
  cornerCuts: "",
  profile: "",
});

const num = (s: string) => Number(String(s).replace(",", "."));

export interface EditorInitial {
  name?: string;
  material?: string | null;
  notes?: string | null;
  serviceOrderRef?: string | null;
  input?: CutPlanInput;
  /** Abrir em barras com o painel de mosquiteiras e ler logo as medidas da OS. */
  startMosquito?: boolean;
}

function rowsFromInput(input?: CutPlanInput) {
  if (!input) return null;
  const pieces: PieceRow[] = input.pieces.map((p) => ({
    ref: p.ref,
    description: p.description ?? "",
    width: input.mode === "CHAPAS" ? String((p as { width: number }).width) : "",
    length: String(p.length),
    qty: String(p.qty),
    rotate: input.mode === "CHAPAS" ? (p as { rotate: boolean }).rotate : true,
    bends: input.mode === "CHAPAS" ? String((p as { bends?: number | null }).bends ?? "") : "",
    cornerCuts: input.mode === "CHAPAS" ? String((p as { cornerCuts?: number | null }).cornerCuts ?? "") : "",
    profile: input.mode === "BARRAS" ? (p as { profile?: string | null }).profile ?? "" : "",
  }));
  const stock: StockRow[] = input.stock.map((s) => ({
    length: String(s.length),
    width: "width" in s ? String(s.width) : "",
    qty: s.qty ? String(s.qty) : "",
  }));
  return { pieces, stock, settings: input.settings };
}

export function CutPlanEditor({
  initial,
  saving,
  onSave,
  onCancel,
  lockServiceOrder,
}: {
  initial?: EditorInitial;
  saving: boolean;
  onSave: (payload: {
    name: string;
    material: string | null;
    notes: string | null;
    serviceOrderRef: string | null;
    input: CutPlanInput;
  }) => void;
  onCancel?: () => void;
  lockServiceOrder?: boolean;
}) {
  const start = rowsFromInput(initial?.input);
  const [mode, setMode] = useState<CutPlanMode>(initial?.input?.mode ?? (initial?.startMosquito ? "BARRAS" : "CHAPAS"));
  const [name, setName] = useState(initial?.name ?? "");
  const [material, setMaterial] = useState(initial?.material ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [osRef, setOsRef] = useState(initial?.serviceOrderRef ?? "");
  const [pieces, setPieces] = useState<PieceRow[]>(start?.pieces ?? [emptyPiece(0)]);
  const [sheetStock, setSheetStock] = useState<StockRow[]>(
    initial?.input?.mode === "CHAPAS" && start ? start.stock : DEFAULT_SHEET_STOCK
  );
  const [barStock, setBarStock] = useState<StockRow[]>(
    initial?.input?.mode === "BARRAS" && start ? start.stock : DEFAULT_BAR_STOCK
  );
  const s0 = initial?.input?.settings as { kerf?: number; trim?: number; minRemnant?: number } | undefined;
  const [sheetKerf, setSheetKerf] = useState(initial?.input?.mode === "CHAPAS" ? String(s0?.kerf ?? 0) : "0");
  const [sheetTrim, setSheetTrim] = useState(initial?.input?.mode === "CHAPAS" ? String(s0?.trim ?? 0) : "0");
  const [barKerf, setBarKerf] = useState(initial?.input?.mode === "BARRAS" ? String(s0?.kerf ?? 3) : "3");
  const [barTrim, setBarTrim] = useState(initial?.input?.mode === "BARRAS" ? String(s0?.trim ?? 0) : "0");
  const [minRemnant, setMinRemnant] = useState(initial?.input?.mode === "BARRAS" ? String(s0?.minRemnant ?? 500) : "500");
  const initialBars = initial?.input?.mode === "BARRAS" ? initial.input : null;
  const [rules, setRules] = useState<MosquitoRules>(initialBars?.mosquitoRules ?? EMPTY_RULES);
  const [mosqRows, setMosqRows] = useState<MosquitoRow[]>(
    initialBars?.mosquitos?.length
      ? initialBars.mosquitos.map((m) => ({ width: String(m.width), height: String(m.height), qty: String(m.qty), finish: m.finish ?? "" }))
      : [{ width: "", height: "", qty: "1", finish: "" }]
  );
  const [showMosq, setShowMosq] = useState(!!initialBars?.mosquitos?.length || !!initial?.startMosquito);
  const [paste, setPaste] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [preview, setPreview] = useState<{ input: CutPlanInput; result: CutResult } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Regras das mosquiteiras guardadas no programa (x, f, y, ...).
  useEffect(() => {
    if (initialBars?.mosquitoRules) return;
    api
      .get<MosquitoRules>("/cut-plans/mosquito-rules")
      .then(setRules)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyGenerated(list: GeneratedPiece[]) {
    setPieces(
      list.map((g) => ({
        ...emptyPiece(0),
        ref: g.ref,
        description: g.description,
        length: String(g.length),
        qty: String(g.qty),
        profile: g.profile,
      }))
    );
    if (!name.trim() && osRef.trim()) setName(`Mosquiteiras OS ${osRef.trim()}`);
    setPreview(null);
  }

  const isSheet = mode === "CHAPAS";
  const stock = isSheet ? sheetStock : barStock;
  const setStock = isSheet ? setSheetStock : setBarStock;

  function updatePiece(i: number, patch: Partial<PieceRow>) {
    setPieces((prev) => prev.map((p, k) => (k === i ? { ...p, ...patch } : p)));
    setPreview(null);
  }
  function updateStock(i: number, patch: Partial<StockRow>) {
    setStock((prev) => prev.map((s, k) => (k === i ? { ...s, ...patch } : s)));
    setPreview(null);
  }

  function buildInput(): CutPlanInput {
    const rows = pieces.filter((p) => p.length.trim() || p.width.trim());
    if (!rows.length) throw new Error("Indica pelo menos uma peça.");
    rows.forEach((p, i) => {
      const line = `Linha ${i + 1} (${p.ref || "sem ref."})`;
      if (!(num(p.length) > 0)) throw new Error(`${line}: falta o comprimento.`);
      if (isSheet && !(num(p.width) > 0)) throw new Error(`${line}: falta a largura.`);
      if (!(num(p.qty) >= 1)) throw new Error(`${line}: quantidade inválida.`);
    });
    const refs = rows.map((p, i) => p.ref.trim() || refFor(i));
    const stockRows = stock.filter((s) => s.length.trim());
    if (!stockRows.length) throw new Error(isSheet ? "Indica pelo menos um formato de chapa." : "Indica pelo menos um comprimento de barra.");
    if (isSheet) {
      return {
        mode: "CHAPAS",
        pieces: rows.map((p, i) => ({
          ref: refs[i],
          description: p.description.trim() || null,
          width: num(p.width),
          length: num(p.length),
          qty: Math.round(num(p.qty)),
          rotate: p.rotate,
          bends: p.bends.trim() ? Math.round(num(p.bends)) : null,
          cornerCuts: p.cornerCuts.trim() ? Math.round(num(p.cornerCuts)) : null,
        })),
        stock: stockRows.map((s) => {
          if (!(num(s.length) > 0 && num(s.width) > 0)) throw new Error("Formato de chapa incompleto.");
          return { length: num(s.length), width: num(s.width), qty: s.qty.trim() ? Math.round(num(s.qty)) : null };
        }),
        settings: { kerf: num(sheetKerf) || 0, trim: num(sheetTrim) || 0 },
      };
    }
    return {
      mode: "BARRAS",
      pieces: rows.map((p, i) => ({
        ref: refs[i],
        description: p.description.trim() || null,
        length: num(p.length),
        qty: Math.round(num(p.qty)),
        profile: p.profile.trim() || null,
      })),
      stock: stockRows.map((s) => ({ length: num(s.length), qty: s.qty.trim() ? Math.round(num(s.qty)) : null })),
      settings: { kerf: num(barKerf) || 0, trim: num(barTrim) || 0, minRemnant: num(minRemnant) || 0 },
      ...(showMosq && rowsToItems(mosqRows).length ? { mosquitos: rowsToItems(mosqRows), mosquitoRules: rules } : {}),
    };
  }

  async function optimize() {
    setError(null);
    let input: CutPlanInput;
    try {
      input = buildInput();
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    setRunning(true);
    try {
      const result = await api.post<CutResult>("/cut-plans/optimize", input);
      setPreview({ input, result });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao otimizar.");
    } finally {
      setRunning(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const input = buildInput();
      if (!name.trim()) throw new Error("Dá um nome ao plano (ex.: obra ou cliente).");
      onSave({
        name: name.trim(),
        material: material.trim() || null,
        notes: notes.trim() || null,
        serviceOrderRef: osRef.trim() || null,
        input,
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Colar medidas do Excel/WhatsApp: uma peça por linha.
  //  Chapas: "320 x 2900 = 6"  ou  "Rufo 320 2900 6"  (largura, comprimento, quant.)
  //  Barras: "1450 = 12"  ou  "Travessa 1450 12"      (comprimento, quant.)
  function applyPaste() {
    const added: PieceRow[] = [];
    paste.split(/\r?\n/).forEach((line) => {
      const nums = (line.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", "."));
      const label = line
        .replace(/\d+(?:[.,]\d+)?/g, " ")
        .replace(/[×=*;:\t|]/g, " ")
        .replace(/(^|\s)[xX-](?=\s|$)/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (isSheet && nums.length >= 2) {
        added.push({ ...emptyPiece(0), description: label, width: nums[0], length: nums[1], qty: nums[2] ?? "1" });
      } else if (!isSheet && nums.length >= 1) {
        added.push({ ...emptyPiece(0), description: label, length: nums[0], qty: nums[1] ?? "1" });
      }
    });
    if (!added.length) {
      setError("Não encontrei medidas no texto colado.");
      return;
    }
    setPieces((prev) => {
      const kept = prev.filter((p) => p.length.trim() || p.width.trim());
      return [...kept, ...added].map((p, i) => ({ ...p, ref: p.ref && i < kept.length ? p.ref : refFor(i) }));
    });
    setPaste("");
    setShowPaste(false);
    setPreview(null);
  }

  const totalUnits = pieces.reduce((a, p) => a + (num(p.qty) || 0), 0);

  return (
    <form onSubmit={submit}>
      <div className="card">
        <div className="form-grid">
          <label className="field">
            Nome do plano *
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: Rufos obra Arcos" />
          </label>
          <label className="field">
            Material
            <input
              type="text"
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
              placeholder={isSheet ? "ex.: Alumínio 1,5 mm RAL 7016" : "ex.: Perfil guia mosquiteira"}
            />
          </label>
          <label className="field">
            Ordem de Serviço
            <input
              type="text"
              value={osRef}
              disabled={lockServiceOrder}
              onChange={(e) => setOsRef(e.target.value)}
              placeholder="nº da OS (opcional)"
            />
          </label>
        </div>

        <div className="cut-mode-toggle" role="tablist">
          {(["CHAPAS", "BARRAS"] as CutPlanMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={mode === m ? "active" : ""}
              onClick={() => {
                setMode(m);
                setPreview(null);
              }}
            >
              {m === "CHAPAS" ? "Chapas (2D)" : "Barras / perfis (1D)"}
            </button>
          ))}
        </div>
      </div>

      {!isSheet && !showMosq && (
        <button type="button" className="btn secondary" style={{ marginBottom: 14 }} onClick={() => setShowMosq(true)}>
          Calcular a partir de mosquiteiras (OS)
        </button>
      )}
      {!isSheet && showMosq && (
        <MosquitoPanel
          osRef={osRef}
          rules={rules}
          setRules={setRules}
          rows={mosqRows}
          setRows={setMosqRows}
          onGenerate={applyGenerated}
          autoImport={!!initial?.startMosquito && !!initial?.serviceOrderRef}
          onServiceOrderFound={(externalId) => {
            if (!lockServiceOrder) setOsRef(externalId);
          }}
        />
      )}

      <div className="card">
        <div className="cut-section-head">
          <h3>Peças</h3>
          <span className="muted">{totalUnits} unid.</span>
          <button type="button" className="btn secondary" onClick={() => setShowPaste((v) => !v)}>
            Colar lista
          </button>
        </div>
        {showPaste && (
          <div style={{ marginBottom: 12 }}>
            <textarea
              rows={5}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={
                isSheet
                  ? "Uma peça por linha: Largura × Comprimento = Quant.\n320 x 2900 = 6\n180 x 1450 = 10"
                  : "Uma peça por linha: Comprimento = Quant.\n1450 = 12\n980 = 20"
              }
              style={{ width: "100%" }}
            />
            <button type="button" className="btn" onClick={applyPaste} style={{ marginTop: 6 }}>
              Acrescentar peças
            </button>
          </div>
        )}
        <div className="cut-table-wrap">
          <table className="cut-input-table">
            <thead>
              <tr>
                <th>Ref.</th>
                <th>Descrição</th>
                {!isSheet && <th>Perfil</th>}
                {isSheet && <th>Largura</th>}
                <th>Comprimento</th>
                <th>Quant.</th>
                {isSheet && (
                  <>
                    <th title="Pode rodar 90° na chapa">Rodar</th>
                    <th>Quinag.</th>
                    <th>C.-cantos</th>
                  </>
                )}
                <th />
              </tr>
            </thead>
            <tbody>
              {pieces.map((p, i) => (
                <tr key={i}>
                  <td>
                    <input type="text" value={p.ref} onChange={(e) => updatePiece(i, { ref: e.target.value })} style={{ width: 56 }} />
                  </td>
                  <td>
                    <input type="text" value={p.description} onChange={(e) => updatePiece(i, { description: e.target.value })} />
                  </td>
                  {!isSheet && (
                    <td>
                      <input type="text" value={p.profile} onChange={(e) => updatePiece(i, { profile: e.target.value })} placeholder="—" style={{ width: 150 }} />
                    </td>
                  )}
                  {isSheet && (
                    <td>
                      <input type="number" inputMode="decimal" min={0} value={p.width} onChange={(e) => updatePiece(i, { width: e.target.value })} style={{ width: 90 }} />
                    </td>
                  )}
                  <td>
                    <input type="number" inputMode="decimal" min={0} value={p.length} onChange={(e) => updatePiece(i, { length: e.target.value })} style={{ width: 90 }} />
                  </td>
                  <td>
                    <input type="number" inputMode="numeric" min={1} value={p.qty} onChange={(e) => updatePiece(i, { qty: e.target.value })} style={{ width: 70 }} />
                  </td>
                  {isSheet && (
                    <>
                      <td style={{ textAlign: "center" }}>
                        <input type="checkbox" checked={p.rotate} onChange={(e) => updatePiece(i, { rotate: e.target.checked })} />
                      </td>
                      <td>
                        <input type="number" min={0} value={p.bends} onChange={(e) => updatePiece(i, { bends: e.target.value })} style={{ width: 60 }} />
                      </td>
                      <td>
                        <input type="number" min={0} value={p.cornerCuts} onChange={(e) => updatePiece(i, { cornerCuts: e.target.value })} style={{ width: 60 }} />
                      </td>
                    </>
                  )}
                  <td>
                    <button
                      type="button"
                      className="link-button"
                      title="Remover linha"
                      onClick={() => {
                        setPieces((prev) => (prev.length > 1 ? prev.filter((_, k) => k !== i) : [emptyPiece(0)]));
                        setPreview(null);
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className="btn secondary"
          style={{ marginTop: 8 }}
          onClick={() => setPieces((prev) => [...prev, emptyPiece(prev.length)])}
        >
          + Peça
        </button>
        {isSheet && (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            Medidas em mm. Para chapa quinada, a largura é o desenvolvimento. Desmarca "Rodar" quando o comprimento tem de
            ficar ao comprido da chapa. Corta-cantos só nas peças com abas nos topos (caixas/tabuleiros).
          </p>
        )}
      </div>

      <div className="card">
        <div className="cut-section-head">
          <h3>{isSheet ? "Formatos de chapa disponíveis" : "Barras disponíveis"}</h3>
          <span className="muted">Quant. vazia = sem limite</span>
        </div>
        <div className="cut-stock-list">
          {stock.map((s, i) => (
            <div className="cut-stock-row" key={i}>
              <input type="number" min={0} value={s.length} onChange={(e) => updateStock(i, { length: e.target.value })} placeholder="Comprimento" />
              {isSheet && (
                <>
                  <span>×</span>
                  <input type="number" min={0} value={s.width} onChange={(e) => updateStock(i, { width: e.target.value })} placeholder="Largura" />
                </>
              )}
              <span className="muted">mm · quant.</span>
              <input type="number" min={1} value={s.qty} onChange={(e) => updateStock(i, { qty: e.target.value })} placeholder="∞" style={{ width: 70 }} />
              <button
                type="button"
                className="link-button"
                title="Remover"
                onClick={() => {
                  setStock((prev) => prev.filter((_, k) => k !== i));
                  setPreview(null);
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn secondary" onClick={() => setStock((prev) => [...prev, { length: "", width: "", qty: "" }])}>
            + {isSheet ? "Formato" : "Comprimento"}
          </button>
          {isSheet && (
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setSheetStock(DEFAULT_SHEET_STOCK);
                setPreview(null);
              }}
            >
              Repor formatos standard
            </button>
          )}
        </div>

        <div className="form-grid" style={{ marginTop: 14, marginBottom: 0 }}>
          {isSheet ? (
            <>
              <label className="field">
                Espessura do corte (mm)
                <input type="number" min={0} step="0.1" value={sheetKerf} onChange={(e) => setSheetKerf(e.target.value)} />
                <span className="muted" style={{ fontSize: 12 }}>0 na guilhotina; 3–4 na serra</span>
              </label>
              <label className="field">
                Margem de esquadria por lado (mm)
                <input type="number" min={0} step="0.5" value={sheetTrim} onChange={(e) => setSheetTrim(e.target.value)} />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                Largura da lâmina (mm)
                <input type="number" min={0} step="0.1" value={barKerf} onChange={(e) => setBarKerf(e.target.value)} />
              </label>
              <label className="field">
                Topo cortado no início (mm)
                <input type="number" min={0} value={barTrim} onChange={(e) => setBarTrim(e.target.value)} />
              </label>
              <label className="field">
                Guardar sobras a partir de (mm)
                <input type="number" min={0} value={minRemnant} onChange={(e) => setMinRemnant(e.target.value)} />
              </label>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <label className="field" style={{ marginBottom: 12 }}>
          Notas
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={optimize} disabled={running}>
            {running ? "A otimizar..." : "Otimizar"}
          </button>
          <button type="submit" className="btn" disabled={saving || running} style={{ background: "#16a34a" }}>
            {saving ? "A gravar..." : "Gravar plano"}
          </button>
          {onCancel && (
            <button type="button" className="btn secondary" onClick={onCancel}>
              Cancelar
            </button>
          )}
        </div>
      </div>

      {preview && (
        <>
          <h3 style={{ margin: "18px 0 10px" }}>Pré-visualização</h3>
          <CutPlanView input={preview.input} result={preview.result} />
        </>
      )}
    </form>
  );
}

/** Valores para o editor a partir de um plano gravado. */
export function editorInitialFromPlan(plan: CutPlan): EditorInitial {
  return {
    name: plan.name,
    material: plan.material,
    notes: plan.notes,
    serviceOrderRef: plan.serviceOrder?.externalId ?? null,
    input: plan.input,
  };
}
