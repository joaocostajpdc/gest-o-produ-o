import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useFeature } from "../contexts/FeaturesContext";
import {
  GLASS_ORDER_STATUS_LABELS,
  GlassOrder,
  MATERIAL_REQUEST_STATUS_LABELS,
  MaterialRequest,
  Powder,
  SERVICE_ORDER_STATUS_LABELS,
  ServiceOrderListItem,
} from "../types";

// ============================================================================
// Anexos do chat (pedido de 2026-10-24: "todo o tipo de documentos"):
// documentos do programa (OS, pedidos de material, vidros, planos de corte,
// pó em stock, orçamentos) e ficheiros (PDF, fotografias, Excel, …).
// No texto da mensagem ficam como:
//   [[os:<id>|<nº>]]  ·  [[doc:<tipo>:<id>|<título>|<detalhe>]]  ·  [[file:<id>|<nome>|<tipo>]]
// ============================================================================

export type DocKind = "os" | "mat" | "vidro" | "corte" | "po" | "orc";

export interface Anexo {
  token: string;
  label: string;
}

export const ANEXO_TOKEN = /\[\[(os|doc|file):([^\]]*)\]\]/g;

const KIND_INFO: Record<Exclude<DocKind, "os">, { nome: string; link: (id: string) => string; cor: string }> = {
  mat: { nome: "Pedido de material", link: () => "/material-a-pedir", cor: "#c2410c" },
  vidro: { nome: "Pedido de vidro", link: () => "/pedidos-vidros", cor: "#0e7490" },
  corte: { nome: "Plano de corte", link: (id) => `/otimizacao-corte/${id}`, cor: "#6d28d9" },
  po: { nome: "Pó em stock", link: () => "/po-em-stock", cor: "#a16207" },
  orc: { nome: "Orçamento", link: () => "/orcamentos", cor: "#047857" },
};

const clean = (s: string) => String(s ?? "").replace(/[|\]\[]/g, " ").replace(/\s+/g, " ").trim();

export function tokenResumo(t: string) {
  return t.replace(ANEXO_TOKEN, (_m, tipo: string, rest: string) => {
    const parts = rest.split("|");
    if (tipo === "os") return `OS ${parts[1] ?? ""}`;
    if (tipo === "file") return `📎 ${parts[1] ?? "ficheiro"}`;
    const kind = (parts[0].split(":")[0] || "") as Exclude<DocKind, "os">;
    return `${KIND_INFO[kind]?.nome ?? "Documento"} ${parts[1] ?? ""}`.trim();
  }).trim();
}

// ---------------------------------------------------------------------------
// Cartões mostrados na conversa
// ---------------------------------------------------------------------------
const Ic = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const IC_OS = "M8 4h8a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 10h6M9 14h6M9 18h3";
const IC_DOC = "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5";
const IC_FILE = "M21 11.5l-8.6 8.6a5 5 0 0 1-7-7l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l8-8";

export function OsCard({ id, num, os, mine }: { id: string; num: string; os?: ServiceOrderListItem; mine: boolean }) {
  return (
    <Link to={`/service-orders/${id}`} className={`chat-oscard${mine ? " mine" : ""}`}>
      <span className="chat-oscard-ic"><Ic d={IC_OS} /></span>
      <span className="chat-oscard-text">
        <strong>OS {os?.externalId ?? num}</strong>
        {os ? (
          <>
            <span>{os.client.name}</span>
            <span className="chat-oscard-sub">
              {os.product.name} · {SERVICE_ORDER_STATUS_LABELS[os.status]}
              {os.currentStage ? ` · ${os.currentStage.name}` : ""}
            </span>
          </>
        ) : (
          <span className="chat-oscard-sub">Abrir a Ordem de Serviço</span>
        )}
      </span>
    </Link>
  );
}

function DocCard({ kind, id, title, sub, mine }: { kind: Exclude<DocKind, "os">; id: string; title: string; sub: string; mine: boolean }) {
  const info = KIND_INFO[kind];
  return (
    <Link to={info ? info.link(id) : "/"} className={`chat-oscard${mine ? " mine" : ""}`}>
      <span className="chat-oscard-ic" style={{ color: info?.cor, background: "#f2f3f7" }}><Ic d={IC_DOC} /></span>
      <span className="chat-oscard-text">
        <span className="chat-oscard-kind" style={{ color: info?.cor }}>{info?.nome ?? "Documento"}</span>
        <strong style={{ color: "var(--color-text)" }}>{title}</strong>
        {sub && <span className="chat-oscard-sub">{sub}</span>}
      </span>
    </Link>
  );
}

function fmtSize(n: number) {
  return n > 1048576 ? `${(n / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function FileCard({ id, name, mime, mine }: { id: string; name: string; mime: string; mine: boolean }) {
  const isImg = mime.startsWith("image/");
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isImg) return;
    let u: string | null = null;
    api.getBlob(`/chat/files/${id}`).then((b) => { u = URL.createObjectURL(b); setUrl(u); }).catch(() => undefined);
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [id, isImg]);
  async function abrir() {
    const w = window.open("", "_blank");
    try {
      const b = await api.getBlob(`/chat/files/${id}`);
      const u = URL.createObjectURL(new Blob([b], { type: mime }));
      if (w) w.location.href = u; else window.open(u, "_blank");
      setTimeout(() => URL.revokeObjectURL(u), 120000);
    } catch {
      w?.close();
    }
  }
  if (isImg) {
    return (
      <button type="button" className="chat-img" onClick={abrir} aria-label={`Abrir imagem ${name}`}>
        {url ? <img src={url} alt={name} /> : <span className="chat-img-ph">A carregar imagem…</span>}
      </button>
    );
  }
  const ext = (name.split(".").pop() || "").toUpperCase().slice(0, 4);
  return (
    <button type="button" className={`chat-oscard chat-filecard${mine ? " mine" : ""}`} onClick={abrir}>
      <span className="chat-oscard-ic" style={{ background: "#eef0f5", color: "#3b4466", fontSize: 10.5, fontWeight: 800 }}>{ext || <Ic d={IC_FILE} />}</span>
      <span className="chat-oscard-text">
        <strong style={{ color: "var(--color-text)" }}>{name}</strong>
        <span className="chat-oscard-sub">Abrir ficheiro</span>
      </span>
    </button>
  );
}

/** Desenha o texto da mensagem com os anexos como cartões. */
export function renderMessage(t: string, osMap: Map<string, ServiceOrderListItem>, mine: boolean) {
  const out: JSX.Element[] = [];
  const byNum = new Map([...osMap.values()].map((o) => [o.externalId, o] as [string, ServiceOrderListItem]));
  let last = 0;
  let k = 0;
  const plain = (txt: string) =>
    txt.split(/(\b20\d{2}\/\d{1,5}\b)/g).map((p) => {
      if (!/^20\d{2}\/\d{1,5}$/.test(p)) return <span key={k++}>{p}</span>;
      const o = byNum.get(p);
      return o ? <Link key={k++} to={`/service-orders/${o.id}`} className="chat-os">{p}</Link> : <strong key={k++} className="chat-os">{p}</strong>;
    });
  for (const m of t.matchAll(ANEXO_TOKEN)) {
    const before = t.slice(last, m.index).trim();
    if (before) out.push(<span key={k++} className="chat-text">{plain(before)}</span>);
    const parts = m[2].split("|");
    if (m[1] === "os") out.push(<OsCard key={k++} id={parts[0]} num={parts[1] ?? ""} os={osMap.get(parts[0])} mine={mine} />);
    else if (m[1] === "file") out.push(<FileCard key={k++} id={parts[0]} name={parts[1] ?? "ficheiro"} mime={parts[2] ?? ""} mine={mine} />);
    else {
      const [kind, id] = parts[0].split(":");
      out.push(<DocCard key={k++} kind={kind as Exclude<DocKind, "os">} id={id} title={parts[1] ?? ""} sub={parts[2] ?? ""} mine={mine} />);
    }
    last = (m.index ?? 0) + m[0].length;
  }
  const rest = t.slice(last).trim();
  if (rest) out.push(<span key={k++} className="chat-text">{plain(rest)}</span>);
  return out;
}

// ---------------------------------------------------------------------------
// Escolha de anexos
// ---------------------------------------------------------------------------
interface Item {
  token: string;
  label: string;
  title: string;
  sub: string;
  date: string;
}

const norm = (x: string) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const dataPT = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "");

export function AnexoPicker({
  osList,
  onPick,
  onFiles,
  onClose,
}: {
  osList: ServiceOrderListItem[];
  onPick: (a: Anexo) => void;
  onFiles: (files: File[]) => void;
  onClose: () => void;
}) {
  const fCut = useFeature("cutPlans");
  const fGlass = useFeature("glassOrders");
  const fPo = useFeature("powderStock");
  const fOrc = useFeature("orcamentos");
  const tabs: { k: DocKind; nome: string }[] = [
    { k: "os", nome: "Ordens de Serviço" },
    { k: "mat", nome: "Material a pedir" },
    ...(fGlass.available ? [{ k: "vidro" as DocKind, nome: "Vidros" }] : []),
    ...(fCut.available ? [{ k: "corte" as DocKind, nome: "Planos de corte" }] : []),
    ...(fPo.available ? [{ k: "po" as DocKind, nome: "Pó em stock" }] : []),
    ...(fOrc.available ? [{ k: "orc" as DocKind, nome: "Orçamentos" }] : []),
  ];
  const [tab, setTab] = useState<DocKind>("os");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Record<string, Item[]>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (tab === "os") {
      setItems((s) => ({
        ...s,
        os: osList.map((o) => ({
          token: `[[os:${o.id}|${clean(o.externalId)}]]`,
          label: `OS ${o.externalId} · ${o.client.name}`,
          title: o.externalId,
          sub: `${o.client.name} · ${o.product.name} · ${SERVICE_ORDER_STATUS_LABELS[o.status]}`,
          date: o.createdAt,
        })),
      }));
      return;
    }
    if (items[tab]) return;
    setLoading(true);
    const load = async (): Promise<Item[]> => {
      if (tab === "mat") {
        const l = await api.get<MaterialRequest[]>("/material-requests");
        return l.map((m) => {
          const title = clean(m.description) + (m.quantity ? ` (${clean(m.quantity)})` : "");
          const sub = clean([m.supplier?.name, MATERIAL_REQUEST_STATUS_LABELS[m.status]].filter(Boolean).join(" · "));
          return { token: `[[doc:mat:${m.id}|${title}|${sub}]]`, label: title, title, sub, date: m.createdAt };
        });
      }
      if (tab === "vidro") {
        const l = await api.get<GlassOrder[]>("/glass-orders");
        return l.map((g) => {
          const title = clean(`${g.quantity}× ${g.medida} — ${g.caixa}`);
          const sub = clean([g.serviceOrder?.externalId ? `OS ${g.serviceOrder.externalId}` : g.nRef, g.supplier?.name, GLASS_ORDER_STATUS_LABELS[g.status]].filter(Boolean).join(" · "));
          return { token: `[[doc:vidro:${g.id}|${title}|${sub}]]`, label: title, title, sub, date: g.date };
        });
      }
      if (tab === "corte") {
        const l = await api.get<{ id: string; number: number; name: string; material?: string | null; serviceOrder?: { externalId: string } | null; createdAt: string }[]>("/cut-plans");
        return l.map((c) => {
          const title = clean(`Plano ${c.number} — ${c.name}`);
          const sub = clean([c.material, c.serviceOrder?.externalId ? `OS ${c.serviceOrder.externalId}` : ""].filter(Boolean).join(" · "));
          return { token: `[[doc:corte:${c.id}|${title}|${sub}]]`, label: title, title, sub, date: c.createdAt };
        });
      }
      if (tab === "po") {
        const l = await api.get<Powder[]>("/powders");
        return l.map((p) => {
          const title = clean(`${p.referencia}${p.ral ? ` · RAL ${p.ral}` : ""}`);
          const sub = clean(`${p.marcaPo ?? p.marca} · ${p.codigo} · ${String(p.quantityKg).replace(".", ",")} kg`);
          return { token: `[[doc:po:${p.id}|${title}|${sub}]]`, label: title, title, sub, date: p.updatedAt };
        });
      }
      const l = await api.get<{ id: string; num?: string; tipo?: string; data?: string; estado?: string; cliente?: { nome?: string }; criado?: number }[]>("/orcamentos/lista");
      return l.map((o) => {
        const title = clean(`${o.num ?? "Orçamento"} — ${o.cliente?.nome || "sem cliente"}`);
        const sub = clean([o.tipo === "paineis" ? "Painéis" : "Chapas quinadas", o.estado, dataPT(o.data)].filter(Boolean).join(" · "));
        return { token: `[[doc:orc:${o.id}|${title}|${sub}]]`, label: title, title, sub, date: o.data || (o.criado ? new Date(o.criado).toISOString() : "") };
      });
    };
    load()
      .then((l) => setItems((s) => ({ ...s, [tab]: l })))
      .catch(() => setItems((s) => ({ ...s, [tab]: [] })))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, osList]);

  const list = (items[tab] || [])
    .filter((i) => !q.trim() || norm(`${i.title} ${i.sub}`).includes(norm(q.trim())))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, 40);

  return (
    <div className="chat-picker" role="dialog" aria-label="Anexar documento">
      <div className="chat-picker-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.k} type="button" role="tab" aria-selected={tab === t.k} className={tab === t.k ? "on" : ""} onClick={() => { setTab(t.k); setQ(""); }}>
            {t.nome}
          </button>
        ))}
      </div>
      <input autoFocus type="search" placeholder="Procurar…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Procurar documento" />
      <div className="chat-picker-list">
        {loading && <div className="muted" style={{ padding: 10, fontSize: 13 }}>A carregar…</div>}
        {!loading && list.length === 0 && <div className="muted" style={{ padding: 10, fontSize: 13 }}>Nada encontrado.</div>}
        {list.map((i) => (
          <button key={i.token} type="button" onClick={() => { onPick({ token: i.token, label: i.label }); onClose(); }}>
            <strong>{i.title}</strong>
            {i.sub && <span className="muted">{i.sub}</span>}
          </button>
        ))}
      </div>
      <label className="chat-picker-file">
        <input
          type="file"
          multiple
          onChange={(e) => {
            const f = Array.from(e.target.files || []);
            e.target.value = "";
            if (f.length) { onFiles(f); onClose(); }
          }}
        />
        📎 Ficheiro do computador (PDF, fotografia, Excel…)
      </label>
    </div>
  );
}
