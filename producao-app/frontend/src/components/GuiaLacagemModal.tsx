import { useEffect, useState } from "react";
import { api } from "../api/client";

// ============================================================================
// Submeter guia da Lacagem (pedido do utilizador de 2026-10-30): tira-se uma
// fotografia à guia (ou escolhe-se o PDF), o programa lê as Ordens de
// Serviço que lá vêm e, depois de confirmar, envia-as para a Lacagem ou
// retira-as da Lacagem, deixando a guia anexada em cada OS.
// As fotografias são lidas aqui no browser (OCR em português); os PDFs no
// servidor. Uma guia com 2 páginas = 2 fotografias.
// ============================================================================

type Direction = "enviar" | "retirar";

interface FoundOrder {
  id: string;
  externalId: string;
  status: string;
  client: string;
  product: string;
  currentStage: string | null;
  currentSupplier: string | null;
  inLacagem: boolean;
  confident: boolean;
}

interface Analysis {
  guiaNumber: string | null;
  supplierId: string | null;
  supplierName: string | null;
  suggestedDirection: Direction;
  orders: FoundOrder[];
  notFound: string[];
}

interface Supplier {
  id: string;
  name: string;
}

interface ApplyResult {
  id: string;
  externalId: string;
  ok: boolean;
  message: string;
}

const MAX_SIDE = 2200;

/** Reduz a fotografia (as do telemóvel são enormes) — serve para o OCR e para o anexo. */
async function shrinkImage(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`Não foi possível abrir a imagem "${file.name}".`));
      el.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.8));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("Não foi possível ler o ficheiro."));
    r.readAsDataURL(blob);
  });
}

interface Prepared {
  name: string;
  mimeType: string;
  blob: Blob;
}

export function GuiaLacagemModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [files, setFiles] = useState<Prepared[]>([]);
  const [step, setStep] = useState<"ficheiros" | "confirmar" | "feito">("ficheiros");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<FoundOrder[]>([]);
  const [manual, setManual] = useState("");
  const [direction, setDirection] = useState<Direction>("enviar");
  const [supplierId, setSupplierId] = useState("");
  const [guiaNumber, setGuiaNumber] = useState("");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [results, setResults] = useState<ApplyResult[]>([]);

  useEffect(() => {
    api
      .get<Supplier[]>("/suppliers")
      .then(setSuppliers)
      .catch(() => undefined);
  }, []);

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError(null);
    setBusy("A preparar…");
    try {
      const out: Prepared[] = [];
      for (const f of Array.from(list)) {
        if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) {
          out.push({ name: f.name, mimeType: "application/pdf", blob: f });
        } else if (f.type.startsWith("image/")) {
          out.push({ name: f.name.replace(/\.[^.]+$/, "") + ".jpg", mimeType: "image/jpeg", blob: await shrinkImage(f) });
        }
      }
      setFiles((prev) => [...prev, ...out].slice(0, 6));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao preparar os ficheiros.");
    } finally {
      setBusy(null);
    }
  }

  async function read() {
    setError(null);
    try {
      const texts: string[] = [];
      const images = files.filter((f) => f.mimeType.startsWith("image/"));
      for (const f of files.filter((f) => f.mimeType === "application/pdf")) {
        setBusy(`A ler ${f.name}…`);
        const r = await api.postFile<{ text: string }>("/lacagem-guias/ler-pdf", f.blob, "application/pdf");
        texts.push(r.text);
      }
      if (images.length) {
        setBusy("A preparar a leitura das fotografias…");
        const { createWorker } = await import("tesseract.js");
        const worker = await createWorker("por", 1, { langPath: "/tessdata" });
        try {
          for (let i = 0; i < images.length; i++) {
            setBusy(`A ler a fotografia ${i + 1} de ${images.length}…`);
            const r = await worker.recognize(images[i].blob);
            texts.push(r.data.text);
          }
        } finally {
          await worker.terminate();
        }
      }
      setBusy("A procurar as Ordens de Serviço…");
      const a = await api.post<Analysis>("/lacagem-guias/analisar", { text: texts.join("\n") });
      setAnalysis(a);
      setSelected(new Set(a.orders.filter((o) => o.confident).map((o) => o.id)));
      setExtra([]);
      setDirection(a.suggestedDirection);
      setSupplierId(a.supplierId ?? "");
      setGuiaNumber(a.guiaNumber ?? "");
      setStep("confirmar");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível ler a guia.");
    } finally {
      setBusy(null);
    }
  }

  async function addManual() {
    const n = manual.trim();
    if (!n) return;
    const id = /^\d{1,4}$/.test(n) ? `${new Date().getFullYear()}/${n}` : n;
    setError(null);
    try {
      const a = await api.post<Analysis>("/lacagem-guias/analisar", { text: `Ordem Serviço ${id}` });
      const o = a.orders[0];
      if (!o) {
        setError(`A OS ${id} não existe no programa.`);
        return;
      }
      if (!analysis?.orders.some((x) => x.id === o.id) && !extra.some((x) => x.id === o.id)) {
        setExtra((prev) => [...prev, o]);
      }
      setSelected((prev) => new Set(prev).add(o.id));
      setManual("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao procurar a OS.");
    }
  }

  async function apply() {
    if (selected.size === 0) return;
    setError(null);
    setBusy(direction === "enviar" ? "A enviar para a Lacagem…" : "A retirar da Lacagem…");
    try {
      const payloadFiles = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const label = guiaNumber ? `Guia ${guiaNumber.replace("/", "-")}` : "Guia lacagem";
        const ext = f.mimeType === "application/pdf" ? "pdf" : "jpg";
        payloadFiles.push({
          filename: files.length > 1 ? `${label} (${i + 1} de ${files.length}).${ext}` : `${label}.${ext}`,
          mimeType: f.mimeType,
          base64: await blobToBase64(f.blob),
        });
      }
      const r = await api.post<{ results: ApplyResult[] }>("/lacagem-guias/aplicar", {
        direction,
        orderIds: Array.from(selected),
        supplierId: supplierId || null,
        guiaNumber: guiaNumber.trim() || null,
        files: payloadFiles,
      });
      setResults(r.results);
      setStep("feito");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível aplicar a guia.");
    } finally {
      setBusy(null);
    }
  }

  const rows = [...(analysis?.orders ?? []), ...extra];
  const toggle = (id: string) =>
    setSelected((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  return (
    <div className="plan-modal-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="plan-modal guia-modal" role="dialog" aria-label="Submeter guia da Lacagem">
        <div className="guia-head">
          <h3>Submeter guia da Lacagem</h3>
          <button type="button" className="link-button" onClick={onClose} disabled={!!busy}>
            Fechar
          </button>
        </div>

        {step === "ficheiros" && (
          <>
            <p className="muted">
              Tira uma fotografia a cada página da guia (ou escolhe o PDF). O programa lê as Ordens de Serviço e
              mostra-as para confirmares antes de mexer em alguma coisa.
            </p>
            <div className="guia-pick">
              <label className="btn secondary">
                Tirar fotografia
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  hidden
                  onChange={(e) => {
                    void addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
              <label className="btn secondary">
                Escolher ficheiros
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  hidden
                  onChange={(e) => {
                    void addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            {files.length > 0 && (
              <ul className="guia-files">
                {files.map((f, i) => (
                  <li key={i}>
                    <span>
                      Página {i + 1}: {f.name}
                    </span>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                      disabled={!!busy}
                    >
                      Tirar
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="guia-actions">
              <button type="button" className="btn" disabled={files.length === 0 || !!busy} onClick={read}>
                Ler a guia
              </button>
            </div>
          </>
        )}

        {step === "confirmar" && analysis && (
          <>
            <div className="guia-direction" role="radiogroup" aria-label="O que fazer">
              <label className={direction === "enviar" ? "on" : ""}>
                <input type="radio" checked={direction === "enviar"} onChange={() => setDirection("enviar")} />
                Enviar para a Lacagem
              </label>
              <label className={direction === "retirar" ? "on" : ""}>
                <input type="radio" checked={direction === "retirar"} onChange={() => setDirection("retirar")} />
                Retirar da Lacagem
              </label>
            </div>
            <div className="guia-fields">
              <label className="field">
                Nº da guia
                <input value={guiaNumber} onChange={(e) => setGuiaNumber(e.target.value)} placeholder="ex.: 2026/170" />
              </label>
              {direction === "enviar" && (
                <label className="field">
                  Lacagem (fornecedor)
                  <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                    <option value="">— manter o que está —</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {rows.length === 0 ? (
              <p className="muted">Não encontrei nenhuma OS na guia. Escreve os números em baixo.</p>
            ) : (
              <div className="guia-table">
                <table>
                  <thead>
                    <tr>
                      <th />
                      <th>OS</th>
                      <th>Cliente</th>
                      <th>Produto</th>
                      <th>Etapa atual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((o) => {
                      const warn =
                        direction === "retirar" ? !o.inLacagem : o.inLacagem || o.status === "CONCLUIDA" || o.status === "CANCELADA";
                      return (
                        <tr key={o.id} className={selected.has(o.id) ? "" : "guia-off"}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selected.has(o.id)}
                              onChange={() => toggle(o.id)}
                              aria-label={`Incluir a OS ${o.externalId}`}
                            />
                          </td>
                          <td>
                            <strong>{o.externalId}</strong>
                            {!o.confident && <div className="muted small">lido com dúvida</div>}
                          </td>
                          <td>{o.client}</td>
                          <td>{o.product}</td>
                          <td className={warn ? "guia-warn" : undefined}>
                            {o.status === "NAO_INICIADA" ? "Não iniciada" : o.currentStage ?? "—"}
                            {o.inLacagem && o.currentSupplier ? ` (${o.currentSupplier})` : ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {analysis.notFound.length > 0 && (
              <p className="muted small">Números lidos que não existem no programa: {analysis.notFound.join(", ")}</p>
            )}

            <div className="guia-manual">
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void addManual())}
                placeholder="Falta alguma? nº da OS (ex.: 530)"
              />
              <button type="button" className="btn secondary" onClick={addManual} disabled={!manual.trim()}>
                Juntar
              </button>
            </div>

            <div className="guia-actions">
              <button type="button" className="btn secondary" onClick={() => setStep("ficheiros")} disabled={!!busy}>
                Voltar
              </button>
              <button type="button" className="btn" onClick={apply} disabled={selected.size === 0 || !!busy}>
                {direction === "enviar" ? "Enviar" : "Retirar"} {selected.size} OS
              </button>
            </div>
          </>
        )}

        {step === "feito" && (
          <>
            <ul className="guia-results">
              {results.map((r) => (
                <li key={r.id} className={r.ok ? "ok" : "fail"}>
                  <strong>{r.externalId}</strong> — {r.message}
                </li>
              ))}
            </ul>
            <p className="muted small">A guia ficou anexada em cada OS que correu bem.</p>
            <div className="guia-actions">
              <button type="button" className="btn" onClick={onClose}>
                Fechar
              </button>
            </div>
          </>
        )}

        {busy && <p className="muted guia-busy">{busy}</p>}
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}
