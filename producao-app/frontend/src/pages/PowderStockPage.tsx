import { FormEvent, useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { api, downloadBlob } from "../api/client";
import { canManageConfig, useAuth } from "../contexts/AuthContext";
import { useFeature, useFeatures } from "../contexts/FeaturesContext";
import { BarcodeScanner } from "../components/BarcodeScanner";
import {
  Powder,
  PowderLocation,
  POWDER_LOCATION_LABELS,
  POWDER_MOVEMENT_LABELS,
} from "../types";

// ============================================================================
// Pó em Stock — tintas em pó para lacagem (pedido do utilizador de
// 2026-10-13): Referência / Marca / Código / RAL / Quant. (kg) / Local
// (Lavagens ou Armazém), com uma etiqueta por caixa (código de barras + QR)
// para dar entrada e saída de pó lendo a etiqueta com a câmara.
//
// Enquanto o administrador não aprovar esta funcionalidade, só ele a vê
// (ver FeaturesContext e config/featureReleases.ts no backend).
// ============================================================================

const FEATURE_KEY = "powderStock";

const EMPTY_FORM = {
  referencia: "",
  marca: "",
  codigo: "",
  ral: "",
  quantityKg: "",
  location: "ARMAZEM" as PowderLocation,
  notes: "",
};

function formatKg(value: number) {
  return `${value.toLocaleString("pt-PT", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kg`;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Sugere o próximo código livre no formato PO-0001, PO-0002, ... (pode ser
// alterado à mão — p.ex. para usar o código do fornecedor).
function nextCode(items: Powder[]): string {
  let max = 0;
  for (const p of items) {
    const m = p.codigo.match(/^PO-(\d+)$/i);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `PO-${String(max + 1).padStart(4, "0")}`;
}

// Aceita "2,5" (vírgula portuguesa) além de "2.5".
function parseKg(value: string): number {
  return Number(value.replace(",", "."));
}

function LocationPill({ location }: { location: PowderLocation }) {
  return (
    <span className="badge" style={{ background: location === "LAVAGENS" ? "#0e7490" : "#475569" }}>
      {POWDER_LOCATION_LABELS[location]}
    </span>
  );
}

export function PowderStockPage() {
  const { user } = useAuth();
  const feature = useFeature(FEATURE_KEY);
  const { setReleased } = useFeatures();
  const isAdmin = user?.role === "ADMINISTRADOR";
  const canWrite = canManageConfig(user?.role);
  const [searchParams, setSearchParams] = useSearchParams();

  const [items, setItems] = useState<Powder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState<"" | PowderLocation>("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Powder | null>(null);
  const [releasing, setReleasing] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.get<Powder[]>("/powders"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar o pó em stock.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (feature.available) load();
  }, [feature.available]);

  // Vindo da página "Ler Código" (ou de um link) com ?codigo=..., abre logo
  // esse pó para dar entrada/saída.
  useEffect(() => {
    const codigo = searchParams.get("codigo");
    if (codigo && feature.available) {
      openByCode(codigo);
      searchParams.delete("codigo");
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature.available]);

  async function openByCode(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return;
    setScanError(null);
    try {
      const found = await api.get<Powder>(`/powders/by-code/${encodeURIComponent(trimmed)}`);
      const full = await api.get<Powder>(`/powders/${found.id}`);
      setScannerOpen(false);
      setManualCode("");
      setSelected(full);
    } catch (err) {
      setScannerOpen(false);
      setScanError(err instanceof Error ? err.message : "Código não encontrado.");
    }
  }

  async function openPowder(p: Powder) {
    try {
      setSelected(await api.get<Powder>(`/powders/${p.id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao abrir o pó.");
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/powders", {
        referencia: form.referencia,
        marca: form.marca,
        codigo: form.codigo,
        ral: form.ral || undefined,
        quantityKg: form.quantityKg ? parseKg(form.quantityKg) : undefined,
        location: form.location,
        notes: form.notes || undefined,
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao adicionar o pó.");
    }
  }

  async function handleRelease(released: boolean) {
    const msg = released
      ? "Aprovar o Pó em Stock e torná-lo visível para todos os utilizadores (supervisores e operários)?"
      : "Voltar a esconder o Pó em Stock dos outros utilizadores (fica só para administradores)?";
    if (!window.confirm(msg)) return;
    setReleasing(true);
    try {
      await setReleased(FEATURE_KEY, released);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao alterar o lançamento.");
    } finally {
      setReleasing(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((p) => {
      if (locationFilter && p.location !== locationFilter) return false;
      if (!q) return true;
      return [p.referencia, p.marca, p.codigo, p.ral ?? ""].some((v) => v.toLowerCase().includes(q));
    });
  }, [items, search, locationFilter]);

  const totals = useMemo(() => {
    const sum = (loc?: PowderLocation) =>
      items.filter((p) => !loc || p.location === loc).reduce((acc, p) => acc + p.quantityKg, 0);
    return { all: sum(), lavagens: sum("LAVAGENS"), armazem: sum("ARMAZEM") };
  }, [items]);

  if (feature.loading) return <div className="muted">A carregar...</div>;
  if (!feature.available) return <Navigate to="/" replace />;

  return (
    <div>
      <div className="page-header">
        <h2>Pó em Stock</h2>
        {canWrite && (
          <button
            className="btn"
            onClick={() => {
              setForm({ ...EMPTY_FORM, codigo: nextCode(items) });
              setShowForm((v) => !v);
            }}
          >
            {showForm ? "Fechar" : "Novo pó"}
          </button>
        )}
      </div>

      {isAdmin && !feature.released && (
        <div
          className="card"
          style={{ borderLeft: "4px solid #d97706", background: "#fffbeb", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}
        >
          <div>
            <strong>Em teste — só os administradores veem esta aba.</strong>
            <div className="muted">
              Experimenta à vontade. Quando estiver tudo bem, aprova para ficar disponível para supervisores e operários.
            </div>
          </div>
          <button className="btn" disabled={releasing} onClick={() => handleRelease(true)}>
            Aprovar e lançar para todos
          </button>
        </div>
      )}

      {/* Ler a etiqueta da caixa — o caminho rápido para dar entrada/saída. */}
      <div className="card">
        <h4>Entrada / saída de pó</h4>
        <p className="muted" style={{ marginBottom: 12 }}>
          Lê a etiqueta da caixa (código de barras ou QR) ou escreve o código.
        </p>
        {scannerOpen ? (
          <BarcodeScanner onDetected={openByCode} onClose={() => setScannerOpen(false)} />
        ) : (
          <div className="filters-bar" style={{ marginBottom: 0 }}>
            <button
              className="btn"
              onClick={() => {
                setScanError(null);
                setScannerOpen(true);
              }}
            >
              Ler etiqueta
            </button>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                openByCode(manualCode);
              }}
              style={{ display: "flex", gap: 8 }}
            >
              <input
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="Código (ex.: PO-0001)"
              />
              <button className="btn secondary" type="submit">
                Abrir
              </button>
            </form>
          </div>
        )}
        {scanError && <p className="error-text">{scanError}</p>}
      </div>

      {canWrite && showForm && (
        <div className="card">
          <h4>Novo pó</h4>
          <form onSubmit={handleCreate}>
            <div className="form-grid">
              <div>
                <label>Referência</label>
                <input
                  type="text"
                  value={form.referencia}
                  onChange={(e) => setForm({ ...form, referencia: e.target.value })}
                  placeholder="Ex.: Noir 200 Sablé"
                  required
                />
              </div>
              <div>
                <label>Marca</label>
                <input
                  type="text"
                  value={form.marca}
                  onChange={(e) => setForm({ ...form, marca: e.target.value })}
                  placeholder="Ex.: Interpon, Tiger, Axalta..."
                  required
                />
              </div>
              <div>
                <label>Código (vai no código de barras)</label>
                <input
                  type="text"
                  value={form.codigo}
                  onChange={(e) => setForm({ ...form, codigo: e.target.value })}
                  required
                />
              </div>
              <div>
                <label>RAL</label>
                <input
                  type="text"
                  value={form.ral}
                  onChange={(e) => setForm({ ...form, ral: e.target.value })}
                  placeholder="Ex.: 9005"
                />
              </div>
              <div>
                <label>Quant. (kg)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.quantityKg}
                  onChange={(e) => setForm({ ...form, quantityKg: e.target.value })}
                  placeholder="Ex.: 25"
                />
              </div>
              <div>
                <label>Local</label>
                <select
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value as PowderLocation })}
                >
                  <option value="ARMAZEM">Armazém</option>
                  <option value="LAVAGENS">Lavagens</option>
                </select>
              </div>
              <div>
                <label>Notas</label>
                <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <button className="btn" type="submit">
              Adicionar
            </button>
          </form>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      <div className="card">
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
          <span>
            <strong>Total:</strong> {formatKg(totals.all)}
          </span>
          <span className="muted">Armazém: {formatKg(totals.armazem)}</span>
          <span className="muted">Lavagens: {formatKg(totals.lavagens)}</span>
        </div>
        <div className="filters-bar">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Procurar referência, marca, código ou RAL"
          />
          <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value as "" | PowderLocation)}>
            <option value="">Todos os locais</option>
            <option value="ARMAZEM">Armazém</option>
            <option value="LAVAGENS">Lavagens</option>
          </select>
        </div>

        {loading ? (
          <p className="muted">A carregar...</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Referência</th>
                  <th>Marca</th>
                  <th>Código</th>
                  <th>RAL</th>
                  <th style={{ textAlign: "right" }}>Quant. (kg)</th>
                  <th>Local</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.referencia}</strong>
                    </td>
                    <td>{p.marca}</td>
                    <td>
                      <code>{p.codigo}</code>
                    </td>
                    <td>{p.ral || "—"}</td>
                    <td style={{ textAlign: "right", color: p.quantityKg <= 0 ? "#dc2626" : undefined }}>
                      {formatKg(p.quantityKg)}
                    </td>
                    <td>
                      <LocationPill location={p.location} />
                    </td>
                    <td>
                      <button className="btn secondary" onClick={() => openPowder(p)}>
                        Abrir
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      {items.length === 0 ? "Ainda não há pó registado." : "Nenhum pó corresponde à pesquisa."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isAdmin && feature.released && (
        <p className="muted" style={{ fontSize: 13 }}>
          Esta aba está disponível para todos.{" "}
          <button
            className="btn secondary"
            style={{ padding: "2px 8px", fontSize: 12 }}
            disabled={releasing}
            onClick={() => handleRelease(false)}
          >
            Voltar a restringir a administradores
          </button>
        </p>
      )}

      {selected && (
        <PowderDialog
          powder={selected}
          canWrite={canWrite}
          onClose={() => setSelected(null)}
          onChanged={(p) => {
            setSelected(p);
            load();
          }}
          onDeleted={() => {
            setSelected(null);
            load();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Janela de um pó: entrada/saída, etiqueta, edição e histórico.
// ---------------------------------------------------------------------------

function PowderDialog({
  powder,
  canWrite,
  onClose,
  onChanged,
  onDeleted,
}: {
  powder: Powder;
  canWrite: boolean;
  onClose: () => void;
  onChanged: (p: Powder) => void;
  onDeleted: () => void;
}) {
  const [qty, setQty] = useState("");
  const [moveLocation, setMoveLocation] = useState<"" | PowderLocation>("");
  const [moveNotes, setMoveNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [copies, setCopies] = useState("1");
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState({
    referencia: powder.referencia,
    marca: powder.marca,
    codigo: powder.codigo,
    ral: powder.ral ?? "",
    quantityKg: String(powder.quantityKg).replace(".", ","),
    location: powder.location,
    notes: powder.notes ?? "",
  });

  async function move(type: "ENTRADA" | "SAIDA") {
    const value = parseKg(qty);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Indica a quantidade em kg.");
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const updated = await api.post<Powder>(`/powders/${powder.id}/movements`, {
        type,
        quantityKg: value,
        location: moveLocation || undefined,
        notes: moveNotes || undefined,
      });
      setDone(`${type === "ENTRADA" ? "Entrada" : "Saída"} de ${formatKg(value)} registada.`);
      setQty("");
      setMoveNotes("");
      setMoveLocation("");
      onChanged(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao registar o movimento.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadLabel() {
    setBusy(true);
    setError(null);
    try {
      const n = Math.min(Math.max(parseInt(copies, 10) || 1, 1), 50);
      const blob = await api.getBlob(`/powders/${powder.id}/label?copies=${n}`);
      downloadBlob(blob, `etiqueta-po-${powder.codigo}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao gerar a etiqueta.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    const value = parseKg(edit.quantityKg);
    if (!Number.isFinite(value) || value < 0) {
      setError("Quantidade inválida.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.put(`/powders/${powder.id}`, {
        referencia: edit.referencia,
        marca: edit.marca,
        codigo: edit.codigo,
        ral: edit.ral || null,
        quantityKg: value,
        location: edit.location,
        notes: edit.notes || null,
      });
      const full = await api.get<Powder>(`/powders/${powder.id}`);
      setEditing(false);
      onChanged(full);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Remover o pó ${powder.referencia} (${powder.codigo}) e todo o seu histórico?`)) return;
    setBusy(true);
    try {
      await api.delete(`/powders/${powder.id}`);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao remover.");
      setBusy(false);
    }
  }

  return (
    <div className="qv-overlay" onClick={onClose}>
      <div className="qv-popover" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="qv-popover-header">
          <div>
            <div className="muted" style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase" }}>
              {powder.marca}
            </div>
            <h3 style={{ marginTop: 2 }}>{powder.referencia}</h3>
            <div className="muted" style={{ fontSize: 13 }}>
              <code>{powder.codigo}</code>
              {powder.ral ? ` · RAL ${powder.ral.replace(/^ral\s*/i, "")}` : ""}
            </div>
          </div>
          <button className="btn secondary" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0" }}>
          <span style={{ fontSize: 24, fontWeight: 800 }}>{formatKg(powder.quantityKg)}</span>
          <LocationPill location={powder.location} />
        </div>

        {!editing && (
          <>
            <div className="form-grid">
              <div>
                <label>Quantidade (kg)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  autoFocus
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  placeholder="Ex.: 5"
                />
              </div>
              <div>
                <label>Mudar local (opcional)</label>
                <select value={moveLocation} onChange={(e) => setMoveLocation(e.target.value as "" | PowderLocation)}>
                  <option value="">Manter ({POWDER_LOCATION_LABELS[powder.location]})</option>
                  <option value="ARMAZEM">Armazém</option>
                  <option value="LAVAGENS">Lavagens</option>
                </select>
              </div>
              <div>
                <label>Nota (opcional)</label>
                <input
                  type="text"
                  value={moveNotes}
                  onChange={(e) => setMoveNotes(e.target.value)}
                  placeholder="Ex.: OS 2026/1020"
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button className="btn" style={{ background: "#16a34a" }} disabled={busy} onClick={() => move("ENTRADA")}>
                + Entrada
              </button>
              <button className="btn danger" disabled={busy} onClick={() => move("SAIDA")}>
                − Saída
              </button>
            </div>
          </>
        )}

        {done && <p style={{ color: "#16a34a", fontWeight: 600 }}>{done}</p>}
        {error && <p className="error-text">{error}</p>}

        {editing && (
          <form onSubmit={saveEdit} style={{ marginTop: 8 }}>
            <div className="form-grid">
              <div>
                <label>Referência</label>
                <input
                  type="text"
                  value={edit.referencia}
                  onChange={(e) => setEdit({ ...edit, referencia: e.target.value })}
                  required
                />
              </div>
              <div>
                <label>Marca</label>
                <input type="text" value={edit.marca} onChange={(e) => setEdit({ ...edit, marca: e.target.value })} required />
              </div>
              <div>
                <label>Código</label>
                <input type="text" value={edit.codigo} onChange={(e) => setEdit({ ...edit, codigo: e.target.value })} required />
              </div>
              <div>
                <label>RAL</label>
                <input type="text" value={edit.ral} onChange={(e) => setEdit({ ...edit, ral: e.target.value })} />
              </div>
              <div>
                <label>Quant. (kg) — acerto</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={edit.quantityKg}
                  onChange={(e) => setEdit({ ...edit, quantityKg: e.target.value })}
                />
              </div>
              <div>
                <label>Local</label>
                <select value={edit.location} onChange={(e) => setEdit({ ...edit, location: e.target.value as PowderLocation })}>
                  <option value="ARMAZEM">Armazém</option>
                  <option value="LAVAGENS">Lavagens</option>
                </select>
              </div>
              <div>
                <label>Notas</label>
                <input type="text" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" type="submit" disabled={busy}>
                Guardar
              </button>
              <button className="btn secondary" type="button" onClick={() => setEditing(false)}>
                Cancelar
              </button>
            </div>
          </form>
        )}

        <hr style={{ border: 0, borderTop: "1px solid var(--color-border)", margin: "16px 0" }} />

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label>Etiquetas (n.º de caixas)</label>
            <input
              type="number"
              min={1}
              max={50}
              value={copies}
              onChange={(e) => setCopies(e.target.value)}
              style={{ width: 90 }}
            />
          </div>
          <button className="btn secondary" disabled={busy} onClick={downloadLabel}>
            Imprimir etiqueta
          </button>
          {canWrite && !editing && (
            <>
              <button className="btn secondary" onClick={() => setEditing(true)}>
                Editar
              </button>
              <button className="btn secondary" style={{ color: "#dc2626" }} disabled={busy} onClick={remove}>
                Remover
              </button>
            </>
          )}
        </div>

        {powder.movements && powder.movements.length > 0 && (
          <>
            <h4 style={{ marginTop: 18 }}>Últimos movimentos</h4>
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Tipo</th>
                  <th style={{ textAlign: "right" }}>kg</th>
                  <th style={{ textAlign: "right" }}>Stock</th>
                  <th>Quem</th>
                </tr>
              </thead>
              <tbody>
                {powder.movements.map((m) => (
                  <tr key={m.id} title={m.notes ?? undefined}>
                    <td>{formatDateTime(m.createdAt)}</td>
                    <td>{POWDER_MOVEMENT_LABELS[m.type]}</td>
                    <td style={{ textAlign: "right", color: m.type === "SAIDA" || m.quantityKg < 0 ? "#dc2626" : "#16a34a" }}>
                      {m.type === "SAIDA" || m.quantityKg < 0 ? "−" : "+"}
                      {Math.abs(m.quantityKg).toLocaleString("pt-PT", { maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ textAlign: "right" }}>{m.balanceKg.toLocaleString("pt-PT", { maximumFractionDigits: 2 })}</td>
                    <td>{m.user?.name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
