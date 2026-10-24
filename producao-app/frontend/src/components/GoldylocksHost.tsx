import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { useFeature, useFeatures } from "../contexts/FeaturesContext";
import { FeatureTestBanner } from "./FeatureTestBanner";

// ============================================================================
// Goldylocks dentro da Central, com vários separadores (pedido do utilizador
// de 2026-10-24: "melhora a integração do Goldylocks dentro do programa e se
// possível ter várias abas abertas dentro dele").
//
// Fica montado no Layout (escondido quando se está noutra página), por isso
// os separadores abertos não recarregam nem perdem o trabalho ao ir e voltar
// de outras páginas do programa. A lista de separadores (nomes) fica guardada
// neste computador. Em teste só para o administrador (feature "goldylocks").
// ============================================================================

export const GOLDYLOCKS_URL = "https://app.goldylocks.pt/jpdcmynhoferragens/";
const STORAGE_KEY = "gl-separadores-v1";
const MAX_TABS = 8;

interface GlTab {
  id: string;
  nome: string;
  url: string; // Goldylocks: endereço externo; páginas do programa: caminho (/ordens-servico)
  kind: "gl" | "app";
  v: number; // muda para recarregar o separador
}

// Páginas do programa que se podem abrir num separador (pedido de 2026-10-24:
// "e abrir na mesma outras coisas, ordens de serviço e assim ao mesmo tempo").
interface AppPage {
  path: string;
  nome: string;
  feature?: string;
}
const APP_PAGES: AppPage[] = [
  { path: "/ordens-servico", nome: "Ordens de Serviço" },
  { path: "/scan", nome: "Ler Código" },
  { path: "/otimizacao-corte", nome: "Planos de Corte", feature: "cutPlans" },
  { path: "/material-lacagem", nome: "Material em Lacagem" },
  { path: "/compras", nome: "Compras", feature: "compras" },
  { path: "/material-a-pedir", nome: "Material a Pedir" },
  { path: "/pedidos-vidros", nome: "Pedidos de Vidros", feature: "glassOrders" },
  { path: "/po-em-stock", nome: "Pó em Stock", feature: "powderStock" },
  { path: "/orcamentos", nome: "Orçamentos", feature: "orcamentos" },
  { path: "/controlo-horas", nome: "Controlo de Horas", feature: "horas" },
  { path: "/km-carrinhas", nome: "Km das Carrinhas", feature: "kmViaturas" },
  { path: "/reports", nome: "Listagens" },
];

function novoId() {
  return Math.random().toString(36).slice(2, 9);
}

function loadTabs(): { tabs: GlTab[]; active: string } {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (raw && Array.isArray(raw.tabs) && raw.tabs.length) {
      const tabs: GlTab[] = raw.tabs
        .slice(0, MAX_TABS)
        .map((t: Partial<GlTab>) =>
          t.kind === "app" && typeof t.url === "string" && t.url.startsWith("/")
            ? { id: String(t.id || novoId()), nome: String(t.nome || "Programa"), url: t.url, kind: "app" as const, v: 0 }
            : { id: String(t.id || novoId()), nome: String(t.nome || "Goldylocks"), url: GOLDYLOCKS_URL, kind: "gl" as const, v: 0 }
        );
      const active = tabs.some((t) => t.id === raw.active) ? raw.active : tabs[0].id;
      return { tabs, active };
    }
  } catch {
    /* sem armazenamento: começa do zero */
  }
  const first: GlTab = { id: novoId(), nome: "Goldylocks", url: GOLDYLOCKS_URL, kind: "gl", v: 0 };
  return { tabs: [first], active: first.id };
}

const IcoPlus = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
);
const IcoX = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
);
const IcoReload = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>
);
const IcoExternal = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
);

export function GoldylocksHost({ visible }: { visible: boolean }) {
  const feature = useFeature("goldylocks");
  const { features } = useFeatures();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState(loadTabs);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Só se carrega o Goldylocks depois da primeira visita à página.
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ active: state.active, tabs: state.tabs.map((t) => ({ id: t.id, nome: t.nome, kind: t.kind, url: t.kind === "app" ? t.url : undefined })) }));
    } catch {
      /* ignora */
    }
  }, [state]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  // Fecha o menu "+" ao clicar fora dele.
  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [menuOpen]);

  if (!feature.available || !mounted) return null;

  const { tabs, active } = state;

  const pageAvailable = (p: AppPage) => !p.feature || !!features.find((f) => f.key === p.feature)?.available;
  function addTab(page?: AppPage) {
    setMenuOpen(false);
    if (tabs.length >= MAX_TABS) return;
    const nGl = tabs.filter((t) => t.kind === "gl").length;
    const t: GlTab = page
      ? { id: novoId(), nome: page.nome, url: page.path, kind: "app", v: 0 }
      : { id: novoId(), nome: nGl ? `Goldylocks ${nGl + 1}` : "Goldylocks", url: GOLDYLOCKS_URL, kind: "gl", v: 0 };
    setState({ tabs: [...tabs, t], active: t.id });
  }
  // Lembra a página onde está cada separador do programa (mesmo site, dá para ler).
  function onFrameLoad(t: GlTab, el: HTMLIFrameElement) {
    if (t.kind !== "app") return;
    try {
      const loc = el.contentWindow?.location;
      const path = loc ? loc.pathname + loc.search : "";
      if (path && path !== t.url && path.startsWith("/")) {
        setState((s) => ({ ...s, tabs: s.tabs.map((x) => (x.id === t.id ? { ...x, url: path } : x)) }));
      }
    } catch {
      /* ignora */
    }
  }
  function closeTab(id: string) {
    if (tabs.length === 1) return;
    const i = tabs.findIndex((t) => t.id === id);
    const rest = tabs.filter((t) => t.id !== id);
    setState({ tabs: rest, active: active === id ? rest[Math.max(0, i - 1)].id : active });
  }
  function reload() {
    setState({ ...state, tabs: tabs.map((t) => (t.id === active ? { ...t, v: t.v + 1 } : t)) });
  }
  function startRename(t: GlTab) {
    setEditing(t.id);
    setDraft(t.nome);
  }
  function commitRename() {
    if (!editing) return;
    const nome = draft.trim() || "Goldylocks";
    setState({ ...state, tabs: tabs.map((t) => (t.id === editing ? { ...t, nome } : t)) });
    setEditing(null);
  }
  function onTabKey(e: KeyboardEvent<HTMLDivElement>) {
    const i = tabs.findIndex((t) => t.id === active);
    if (e.key === "ArrowRight") setState({ ...state, active: tabs[(i + 1) % tabs.length].id });
    if (e.key === "ArrowLeft") setState({ ...state, active: tabs[(i - 1 + tabs.length) % tabs.length].id });
  }

  return (
    <div className="gl-host" hidden={!visible}>
      {!feature.released && (
        <div style={{ marginBottom: 10 }}>
          <FeatureTestBanner featureKey="goldylocks" label="o Goldylocks dentro do programa" />
        </div>
      )}
      <div className="gl-bar">
        <div className="gl-tabs" role="tablist" aria-label="Separadores do Goldylocks" onKeyDown={onTabKey}>
          {tabs.map((t) => {
            const on = t.id === active;
            return (
              <div key={t.id} className={`gl-tab${on ? " on" : ""} ${t.kind === "gl" ? "is-gl" : "is-app"}`}>
                {editing === t.id ? (
                  <input
                    ref={inputRef}
                    className="gl-rename"
                    value={draft}
                    aria-label="Nome do separador"
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={on}
                    tabIndex={on ? 0 : -1}
                    className="gl-tab-btn"
                    onClick={() => setState({ ...state, active: t.id })}
                    onDoubleClick={() => startRename(t)}
                    title="Duplo clique para mudar o nome"
                  >
                    {t.nome}
                  </button>
                )}
                {tabs.length > 1 && (
                  <button type="button" className="gl-close" onClick={() => closeTab(t.id)} aria-label={`Fechar ${t.nome}`}>
                    <IcoX />
                  </button>
                )}
              </div>
            );
          })}
        </div>
          <div className="gl-addwrap" ref={menuRef}>
            <button
              type="button"
              className="gl-add"
              onClick={() => setMenuOpen((o) => !o)}
              disabled={tabs.length >= MAX_TABS}
              aria-label="Novo separador"
              aria-expanded={menuOpen}
              title={tabs.length >= MAX_TABS ? `Máximo de ${MAX_TABS} separadores` : "Novo separador"}
            >
              <IcoPlus />
            </button>
            {menuOpen && (
              <div className="gl-menu" role="menu">
                <button type="button" role="menuitem" className="gl-menu-gl" onClick={() => addTab()}>
                  Goldylocks
                </button>
                <div className="gl-menu-sep">Programa</div>
                {APP_PAGES.filter(pageAvailable).map((p) => (
                  <button key={p.path} type="button" role="menuitem" onClick={() => addTab(p)}>
                    {p.nome}
                  </button>
                ))}
              </div>
            )}
          </div>
        <div className="gl-actions">
          <button type="button" className="gl-icon" onClick={reload} aria-label="Recarregar este separador" title="Recarregar este separador">
            <IcoReload />
          </button>
          <a className="gl-icon" href={tabs.find((t) => t.id === active)?.kind === "app" ? tabs.find((t) => t.id === active)!.url : GOLDYLOCKS_URL} target="_blank" rel="noopener noreferrer" aria-label="Abrir o Goldylocks numa janela do browser" title="Abrir numa janela do browser">
            <IcoExternal />
          </a>
        </div>
      </div>
      <div className="gl-frames">
        {tabs.map((t) => (
          <iframe
            key={`${t.id}-${t.v}`}
            title={t.nome}
            src={t.url}
            onLoad={(e) => onFrameLoad(t, e.currentTarget)}
            className="gl-frame"
            hidden={t.id !== active}
            allow="clipboard-read; clipboard-write; fullscreen"
          />
        ))}
      </div>
    </div>
  );
}
