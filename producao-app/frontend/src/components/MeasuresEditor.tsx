import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { FeatureTestBanner } from "./FeatureTestBanner";

// ============================================================================
// Medidas das OS (pedido do utilizador de 2026-10-29: "melhorar a leitura dos
// PDF pondo aqui as medidas para que depois saia nas etiquetas e poder
// calcular o plano de corte").
//
//  - "Medidas": Largura × Altura de cada artigo, escritas à mão. Ficam nas
//    Características do Produto ("Dimensões: Larg. W x Alt. H"), por isso
//    saem na Etiqueta de Mosquiteira e no plano de corte.
//  - "Ler PDF de novo": carrega o PDF da Ordem Serviço do Goldylocks e volta
//    a ler as características com a leitura nova das medidas.
// Em teste ("medidasOS"): só o administrador vê, até aprovar.
// ============================================================================

interface SpecBlock {
  index: number;
  title: string | null;
  width: number | null;
  height: number | null;
  qty: number | null;
}

const fmt = (n: number | null) => (n == null ? "" : String(n).replace(".", ","));
const num = (s: string) => {
  const v = Number(s.replace(",", ".").trim());
  return s.trim() && v > 0 ? v : null;
};

export function MeasuresToolbar({
  orderId,
  externalId,
  onChanged,
}: {
  orderId: string;
  externalId: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [blocks, setBlocks] = useState<SpecBlock[] | null>(null);
  const [rows, setRows] = useState<{ width: string; height: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    api
      .get<SpecBlock[]>(`/service-orders/${orderId}/measures`)
      .then((b) => {
        setBlocks(b);
        setRows(b.map((x) => ({ width: fmt(x.width), height: fmt(x.height) })));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Erro ao ler as medidas."));
  }, [open, orderId]);

  async function save() {
    if (!blocks) return;
    const bad = rows.findIndex((r) => (r.width.trim() || r.height.trim()) && !(num(r.width) && num(r.height)));
    if (bad >= 0) {
      setError(`Preenche a largura e a altura do ${blocks[bad].title?.replace(/\s*—.*$/, "") ?? "artigo"} (ou deixa as duas em branco).`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await api.put<SpecBlock[]>(`/service-orders/${orderId}/measures`, {
        items: rows.map((r, index) => ({ index, width: num(r.width), height: num(r.height) })),
      });
      setBlocks(saved);
      setMsg("Medidas guardadas.");
      setOpen(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao guardar as medidas.");
    } finally {
      setBusy(false);
    }
  }

  async function rereadPdf(file: File) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await api.postFile<{ status: string; externalId: string; reason?: string }>(
        "/service-orders/import-pdf",
        file,
        "application/pdf"
      );
      if (r.externalId !== externalId) {
        setError(`Esse PDF é da OS ${r.externalId}, não da ${externalId}.`);
      } else {
        setMsg(r.reason?.includes("atualizadas") ? "Medidas lidas de novo a partir do PDF." : "O PDF não trouxe nada de novo para esta OS.");
        setOpen(false);
        onChanged();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao ler o PDF.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="measures-toolbar">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn secondary" style={{ padding: "4px 10px", fontSize: 13 }} onClick={() => setOpen((o) => !o)} disabled={busy}>
          {open ? "Fechar medidas" : "Medidas"}
        </button>
        <button
          className="btn secondary"
          style={{ padding: "4px 10px", fontSize: 13 }}
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          title="Carregar o PDF da Ordem Serviço do Goldylocks para ler as medidas"
        >
          Ler PDF de novo
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          style={{ display: "none" }}
          onChange={(e) => e.target.files?.[0] && rereadPdf(e.target.files[0])}
        />
        {msg && <span className="muted" style={{ fontSize: 13 }}>{msg}</span>}
      </div>
      {error && <p className="error-text">{error}</p>}

      {open && blocks && (
        <div className="measures-editor">
          <table className="table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Artigo</th>
                <th style={{ width: 70 }}>Quant.</th>
                <th style={{ width: 110 }}>Largura (mm)</th>
                <th style={{ width: 110 }}>Altura (mm)</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((b, i) => (
                <tr key={b.index}>
                  <td>{b.title ?? "Artigo"}</td>
                  <td>{b.qty != null ? fmt(b.qty) : "—"}</td>
                  <td>
                    <input
                      inputMode="decimal"
                      value={rows[i]?.width ?? ""}
                      onChange={(e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, width: e.target.value } : r)))}
                      style={{ width: "100%" }}
                    />
                  </td>
                  <td>
                    <input
                      inputMode="decimal"
                      value={rows[i]?.height ?? ""}
                      onChange={(e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, height: e.target.value } : r)))}
                      style={{ width: "100%" }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn" onClick={save} disabled={busy}>
              {busy ? "A guardar…" : "Guardar medidas"}
            </button>
            <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
              Saem na etiqueta da mosquiteira e no plano de corte.
            </span>
          </div>
        </div>
      )}
      <FeatureTestBanner featureKey="medidasOS" label="as Medidas nas OS" />
    </div>
  );
}
