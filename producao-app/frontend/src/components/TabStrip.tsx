import { useFeature } from "../contexts/FeaturesContext";
import { MouseEvent as ReactMouseEvent, ReactNode, useEffect, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { AppTab, TabIdProvider, useTabs } from "../contexts/TabsContext";
import { protectedRoutes, RootPage } from "../appRoutes";
import logoMark from "../assets/logo-mark.png";

// ============================================================================
// Barra de abas da Central (pedido de 2026-10-25) e as páginas de cada aba.
//  - "+" abre uma aba nova no Início;
//  - Ctrl+clique (ou botão do meio do rato) num link abre-o numa aba nova,
//    tal como no browser;
//  - o "x" (ou o botão do meio do rato na aba) fecha a aba.
// ============================================================================

const P = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const tabIcons = {
  calendar: <svg {...P}><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4M7.5 14h3M13.5 14h3M7.5 17h3" /></svg>,
  home: <svg {...P}><path d="M3 11 12 4l9 7" /><path d="M5 10v10h14V10M10 20v-6h4v6" /></svg>,
  os: <svg {...P}><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4V3h6v1M9 10h6M9 14h6" /></svg>,
  scan: <svg {...P}><path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3M7 12h10" /></svg>,
  cut: <svg {...P}><rect x="3" y="5" width="18" height="14" rx="1" /><path d="M3 12h18M10 5v7M15 12v7" /></svg>,
  drop: <svg {...P}><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" /></svg>,
  print: <svg {...P}><path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M6 14h12v7H6z" /></svg>,
  cart: <svg {...P}><path d="M3 4h2l2.5 11h11L21 7H7" /><circle cx="9" cy="19.5" r="1.5" /><circle cx="17" cy="19.5" r="1.5" /></svg>,
  glass: <svg {...P}><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M9 3v18M15 3v18" /></svg>,
  bucket: <svg {...P}><path d="M5 7h14l-1.5 12.5a1.5 1.5 0 0 1-1.5 1.5H8a1.5 1.5 0 0 1-1.5-1.5L5 7Z" /><ellipse cx="12" cy="7" rx="7" ry="2.5" /></svg>,
  file: <svg {...P}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>,
  clock: <svg {...P}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  van: <svg {...P}><path d="M2 17V7a1 1 0 0 1 1-1h11v11" /><path d="M14 9h4l4 4v4h-2" /><circle cx="7" cy="17.5" r="2" /><circle cx="17" cy="17.5" r="2" /></svg>,
  chat: <svg {...P}><path d="M21 12a8 8 0 0 1-11.7 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>,
  chart: <svg {...P}><path d="M3 3v18h18" /><path d="M7 15v2M11 11v6M15 8v9M19 5v12" /></svg>,
  wallet: <svg {...P}><rect x="2.5" y="6" width="19" height="13" rx="2" /><path d="M2.5 10h19" /></svg>,
  gear: <svg {...P}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></svg>,
};

const AREA_NAMES: Record<string, string> = {
  producao: "Produção",
  compras: "Compras",
  equipa: "Equipa e Frota",
  orcamentacao: "Orçamentação",
  financeiro: "Financeiro",
  config: "Configuração",
};

const PAGES: { prefix: string; title: string; icon: ReactNode }[] = [
  { prefix: "/ordens-servico", title: "Ordens de Serviço", icon: tabIcons.os },
  { prefix: "/service-orders/", title: "Ordem de Serviço", icon: tabIcons.os },
  { prefix: "/scan", title: "Ler Código", icon: tabIcons.scan },
  { prefix: "/otimizacao-corte/novo", title: "Novo Plano de Corte", icon: tabIcons.cut },
  { prefix: "/otimizacao-corte/", title: "Plano de Corte", icon: tabIcons.cut },
  { prefix: "/otimizacao-corte", title: "Planos de Corte", icon: tabIcons.cut },
  { prefix: "/planeamento", title: "Planeamento Semanal", icon: tabIcons.calendar },
  { prefix: "/material-lacagem", title: "Material em Lacagem", icon: tabIcons.drop },
  { prefix: "/reports", title: "Listagens", icon: tabIcons.print },
  { prefix: "/compras", title: "Resumo de Compras", icon: tabIcons.cart },
  { prefix: "/material-a-pedir", title: "Material a Pedir", icon: tabIcons.cart },
  { prefix: "/pedidos-vidros", title: "Pedidos de Vidros", icon: tabIcons.glass },
  { prefix: "/po-em-stock", title: "Pó em Stock", icon: tabIcons.bucket },
  { prefix: "/orcamentos", title: "Orçamentos", icon: tabIcons.file },
  { prefix: "/controlo-horas", title: "Controlo de Horas", icon: tabIcons.clock },
  { prefix: "/km-carrinhas", title: "Km das Carrinhas", icon: tabIcons.van },
  { prefix: "/chat", title: "Chat", icon: tabIcons.chat },
  { prefix: "/financeiro", title: "Financeiro", icon: tabIcons.wallet },
  { prefix: "/relatorios", title: "Relatório de Produção", icon: tabIcons.chart },
  { prefix: "/products", title: "Produtos", icon: tabIcons.gear },
  { prefix: "/stages", title: "Etapas", icon: tabIcons.gear },
  { prefix: "/production-lines", title: "Linhas de Produção", icon: tabIcons.gear },
  { prefix: "/suppliers", title: "Fornecedores", icon: tabIcons.gear },
  { prefix: "/users", title: "Utilizadores", icon: tabIcons.gear },
  { prefix: "/acessos", title: "Acessos", icon: tabIcons.gear },
  { prefix: "/avisos-telegram", title: "Avisos Telegram", icon: tabIcons.gear },
  { prefix: "/emails-automaticos", title: "Avisos Semanais", icon: tabIcons.gear },
];

export function describePath(path: string): { title: string; icon: ReactNode } {
  const [pathname, search = ""] = path.split("?");
  if (pathname === "/") {
    const area = new URLSearchParams(search).get("area");
    return { title: (area && AREA_NAMES[area]) || "Início", icon: tabIcons.home };
  }
  const page = PAGES.find((p) => pathname === p.prefix || pathname.startsWith(p.prefix.endsWith("/") ? p.prefix : p.prefix + "/"));
  return page ? { title: page.title, icon: page.icon } : { title: "Página", icon: tabIcons.file };
}

function tabLabel(t: AppTab) {
  const d = describePath(t.path);
  return { icon: d.icon, title: t.title || d.title };
}

function initials(name?: string) {
  if (!name) return "?";
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

export function TabStrip() {
  // Arrastar as abas para mudar a ordem (pedido do utilizador de 2026-10-30).
  // Em teste: "moverAbas".
  const moveFeature = useFeature("moverAbas");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  const tabs = useTabs();
  const { user, logout } = useAuth();
  if (!tabs) return null;

  function onAux(e: ReactMouseEvent, id: string) {
    if (e.button === 1) {
      e.preventDefault();
      tabs!.closeTab(id);
    }
  }

  return (
    <header className="tabbar">
      {/* Um só logótipo com abas (pedido de 2026-10-27: "melhorar aqueles dois
          logos"): o do menu lateral fica escondido e este leva ao Início. */}
      <button type="button" className="tabbar-brand" onClick={() => tabs.openTab("/")} title="Central Minho Ferragens — Início" aria-label="Ir para o Início">
        <span className="tabbar-logo">
          <img src={logoMark} alt="" />
        </span>
        <span className="tabbar-brand-text">
          <strong>Central</strong>
          <span>Minho Ferragens</span>
        </span>
      </button>
      <div className="tabbar-tabs" role="tablist" aria-label="Abas abertas">
        {tabs.tabs.map((t, idx) => {
          const { icon, title } = tabLabel(t);
          const active = t.id === tabs.activeId;
          const dropCls = dropAt === idx ? " drop-before" : dropAt === idx + 1 && idx === tabs.tabs.length - 1 ? " drop-after" : "";
          return (
            <div
              key={t.id}
              role="tab"
              aria-selected={active}
              tabIndex={0}
              className={`tabbar-tab${active ? " active" : ""}${dragId === t.id ? " dragging" : ""}${dropCls}`}
              draggable={moveFeature.available}
              onDragStart={(e) => {
                setDragId(t.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/x-central-tab", t.id);
              }}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setDropAt(e.clientX < r.left + r.width / 2 ? idx : idx + 1);
              }}
              onDrop={(e) => {
                if (!dragId || dropAt == null) return;
                e.preventDefault();
                tabs.moveTab(dragId, dropAt);
                setDragId(null);
                setDropAt(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropAt(null);
              }}
              title={title}
              onClick={() => tabs.activate(t.id)}
              onMouseDown={(e) => e.button === 1 && e.preventDefault()}
              onAuxClick={(e) => onAux(e, t.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  tabs.activate(t.id);
                }
              }}
            >
              <span className="tabbar-tab-icon">{icon}</span>
              <span className="tabbar-tab-title">{title}</span>
              <button
                type="button"
                className="tabbar-close"
                aria-label={`Fechar ${title}`}
                title="Fechar aba"
                onClick={(e) => {
                  e.stopPropagation();
                  tabs.closeTab(t.id);
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </div>
          );
        })}
        <button type="button" className="tabbar-new" onClick={() => tabs.openTab("/")} aria-label="Nova aba" title="Nova aba">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </div>
      <div className="tabbar-user">
        <span className="tabbar-avatar" title={`${user?.name ?? ""} · ${user?.role ?? ""}`}>{initials(user?.name)}</span>
        <button type="button" className="tabbar-logout" onClick={logout} aria-label="Terminar sessão" title="Terminar sessão">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" /></svg>
        </button>
      </div>
    </header>
  );
}

/**
 * Todas as abas abertas, cada uma com as suas páginas montadas. Só a ativa se
 * vê; as outras ficam escondidas mas paradas onde estavam.
 */
export function TabPanes() {
  const tabs = useTabs();
  const location = useLocation();

  // Ctrl+clique / botão do meio num link interno: abre numa aba nova, por
  // trás (como no browser). Shift+clique abre e passa logo para ela.
  useEffect(() => {
    if (!tabs) return;
    function internalHref(e: MouseEvent): string | null {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return null;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/api") || url.pathname === "/login") return null;
      return url.pathname + url.search;
    }
    function onClick(e: MouseEvent) {
      if (e.button !== 0 || !(e.ctrlKey || e.metaKey || e.shiftKey)) return;
      const href = internalHref(e);
      if (!href) return;
      e.preventDefault();
      e.stopPropagation();
      tabs!.openTab(href, { background: !e.shiftKey });
    }
    function onAux(e: MouseEvent) {
      if (e.button !== 1) return;
      const href = internalHref(e);
      if (!href) return;
      e.preventDefault();
      tabs!.openTab(href, { background: true });
    }
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onAux, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("auxclick", onAux, true);
    };
  }, [tabs]);

  if (!tabs) return null;
  return (
    <>
      {tabs.tabs.map((t) => {
        const active = t.id === tabs.activeId;
        // Ao trocar de aba, a aba passa a ativa um instante antes de o
        // endereço mudar (o React Router 7 muda o endereço "em transição").
        // Nesse instante a aba mostraria a página da aba anterior e deitava
        // fora a sua (perdendo filtros, etc.) — por isso só segue o endereço
        // do browser quando ele já é o desta aba (correção de 2026-10-29).
        const here = location.pathname + location.search;
        const useLive = active && here === t.path;
        return (
          <div key={t.id} className="tab-pane" hidden={!active}>
            <TabIdProvider id={t.id}>
              <Routes location={useLive ? location : t.path}>
                {protectedRoutes}
                <Route path="*" element={<RootPage />} />
              </Routes>
            </TabIdProvider>
          </div>
        );
      })}
    </>
  );
}
