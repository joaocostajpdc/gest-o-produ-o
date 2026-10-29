import { useEffect, useRef, useState } from "react";

// ============================================================================
// Filtro com várias escolhas (pedido do utilizador de 2026-10-29: "aqui quero
// poder selecionar dentro do mesmo filtro várias coisas"). Tem o aspeto de um
// <select> e abre uma lista com caixas de seleção. O valor é guardado como
// texto separado por vírgulas ("a,b,c"), o mesmo formato que o servidor lê.
// ============================================================================

export interface MultiOption {
  value: string;
  label: string;
}

export function MultiSelect({
  placeholder,
  options,
  value,
  onChange,
  wide,
}: {
  placeholder: string; // ex.: "Estado (todos)"
  options: MultiOption[];
  value: string;
  onChange: (v: string) => void;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const selected = value ? value.split(",").filter(Boolean) : [];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const toggle = (v: string) => {
    const next = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v];
    onChange(next.join(","));
  };

  const name = placeholder.replace(/\s*\(.*\)\s*$/, "");
  const label =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? options.find((o) => o.value === selected[0])?.label ?? placeholder
        : `${name}: ${selected.length} escolhidos`;

  const shown = q.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()))
    : options;

  return (
    <div className="multi-select" ref={ref} style={{ position: "relative", minWidth: wide ? 260 : 160 }}>
      <button
        type="button"
        className={`multi-select-btn${selected.length ? " has-value" : ""}`}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "8px 30px 8px 12px",
          border: "1px solid var(--border, #d0d5dd)",
          borderRadius: 8,
          background: "var(--surface, #fff)",
          color: "inherit",
          font: "inherit",
          cursor: "pointer",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          position: "relative",
          fontWeight: selected.length ? 600 : undefined,
        }}
      >
        {label}
        <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 10 }}>▼</span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            zIndex: 50,
            top: "calc(100% + 4px)",
            left: 0,
            minWidth: "100%",
            maxWidth: 360,
            maxHeight: 320,
            overflowY: "auto",
            background: "var(--surface, #fff)",
            border: "1px solid var(--border, #d0d5dd)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,.12)",
            padding: 6,
          }}
        >
          {options.length > 8 && (
            <input
              autoFocus
              placeholder="Procurar…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ width: "100%", marginBottom: 6, boxSizing: "border-box" }}
            />
          )}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 6px 6px", fontSize: 12 }}>
            <button type="button" className="link-btn" onClick={() => onChange(shown.map((o) => o.value).concat(selected.filter((s) => !shown.some((o) => o.value === s))).join(","))} style={linkStyle}>
              Todos
            </button>
            <button type="button" className="link-btn" onClick={() => onChange("")} style={linkStyle}>
              Limpar
            </button>
          </div>
          {shown.map((o) => (
            <label
              key={o.value}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap" }}
            >
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{o.label}</span>
            </label>
          ))}
          {shown.length === 0 && <div className="muted" style={{ padding: 8, fontSize: 13 }}>Sem resultados.</div>}
        </div>
      )}
    </div>
  );
}

const linkStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  color: "var(--primary, #2f5ce0)",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
};
