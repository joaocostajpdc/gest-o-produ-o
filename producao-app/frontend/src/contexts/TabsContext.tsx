import { createContext, ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

// ============================================================================
// Abas da Central, como num browser — pedido do utilizador de 2026-10-25:
// "quero poder abrir várias coisas ao mesmo tempo como num browser".
//
// Cada aba guarda o seu endereço (ex.: /ordens-servico, /service-orders/12).
// Todas as abas abertas ficam montadas (só a ativa é visível), por isso ao
// mudar de aba nada se perde: filtros, formulários a meio, posição, etc.
// A aba ativa segue sempre o endereço do browser; as outras ficam paradas
// no último endereço onde estavam. Ficam guardadas neste computador
// (localStorage) para reabrirem depois de atualizar a página.
// ============================================================================

export interface AppTab {
  id: string;
  path: string;
  /** Título escolhido pela própria página (ex.: "OS 1234"); senão usa o do endereço. */
  title?: string;
}

interface TabsContextValue {
  tabs: AppTab[];
  activeId: string;
  /** Abre um endereço numa aba nova. Por omissão fica a ativa (como o "+"). */
  openTab: (path: string, opts?: { background?: boolean }) => void;
  closeTab: (id: string) => void;
  activate: (id: string) => void;
  setTabTitle: (id: string, title: string | undefined) => void;
  /** Põe a aba "id" na posição "toIndex" (arrastar as abas — 2026-10-30). */
  moveTab: (id: string, toIndex: number) => void;
}

const MAX_TABS = 15;
const HOME = "/";

const TabsContext = createContext<TabsContextValue | null>(null);
const TabIdContext = createContext<string | null>(null);

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

function storageKey(userId?: string) {
  return `central_tabs_${userId ?? "anon"}`;
}

function loadSaved(key: string): { tabs: AppTab[]; activeId: string } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.tabs) || data.tabs.length === 0) return null;
    const tabs: AppTab[] = data.tabs
      .filter((t: AppTab) => t && typeof t.id === "string" && typeof t.path === "string" && t.path.startsWith("/"))
      .slice(0, MAX_TABS)
      .map((t: AppTab) => ({ id: t.id, path: t.path }));
    if (tabs.length === 0) return null;
    const activeId = tabs.some((t) => t.id === data.activeId) ? data.activeId : tabs[0].id;
    return { tabs, activeId };
  } catch {
    return null;
  }
}

export function TabsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const current = location.pathname + location.search;
  const key = storageKey(user?.id);

  const [state, setState] = useState<{ tabs: AppTab[]; activeId: string }>(() => {
    const saved = loadSaved(key);
    if (saved) {
      // O endereço do browser manda: a aba ativa passa a mostrar o que está
      // na barra de endereço (ex.: link aberto diretamente).
      return {
        tabs: saved.tabs.map((t) => (t.id === saved.activeId ? { ...t, path: current } : t)),
        activeId: saved.activeId,
      };
    }
    const id = newId();
    return { tabs: [{ id, path: current }], activeId: id };
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  // Endereço para onde se mandou ir ao trocar/abrir/fechar uma aba. Até o
  // browser lá chegar, o endereço antigo não pode ser copiado para a aba que
  // ficou ativa (o React Router 7 muda o endereço um pouco depois).
  const pendingNav = useRef<{ path: string; at: number } | null>(null);
  const go = useCallback(
    (path: string) => {
      pendingNav.current = { path, at: Date.now() };
      navigate(path);
    },
    [navigate]
  );

  // A aba ativa acompanha a navegação normal (links, botões, voltar atrás).
  useEffect(() => {
    const pend = pendingNav.current;
    if (pend) {
      // (se a página entretanto redirecionar para outro sítio, ao fim de 1,5 s
      // a aba volta a seguir o endereço normalmente)
      if (current !== pend.path && Date.now() - pend.at < 1500) return;
      pendingNav.current = null;
    }
    setState((s) => {
      const active = s.tabs.find((t) => t.id === s.activeId);
      if (!active || active.path === current) return s;
      // Muda de página dentro da aba: o título dado pela página anterior deixa
      // de servir (mas mudar só filtros na mesma página mantém-no).
      const samePage = active.path.split("?")[0] === location.pathname;
      return {
        ...s,
        tabs: s.tabs.map((t) => (t.id === s.activeId ? { ...t, path: current, title: samePage ? t.title : undefined } : t)),
      };
    });
  }, [current, location.pathname]);

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify({ tabs: state.tabs.map(({ id, path }) => ({ id, path })), activeId: state.activeId }));
    } catch {
      /* sem armazenamento: as abas só não sobrevivem a um refresh */
    }
  }, [key, state]);

  // Cada aba lembra até onde estava descida a página, como no browser.
  const scrollByTab = useRef<Record<string, number>>({});
  const rememberScroll = () => {
    scrollByTab.current[stateRef.current.activeId] = window.scrollY;
  };
  useLayoutEffect(() => {
    // Um cartão aberto noutra aba pode ter bloqueado o deslizar da página.
    document.body.style.overflow = "";
    window.scrollTo(0, scrollByTab.current[state.activeId] ?? 0);
  }, [state.activeId]);

  const activate = useCallback(
    (id: string) => {
      const tab = stateRef.current.tabs.find((t) => t.id === id);
      if (!tab || id === stateRef.current.activeId) return;
      rememberScroll();
      setState((s) => ({ ...s, activeId: id }));
      if (tab.path !== window.location.pathname + window.location.search) go(tab.path);
    },
    [go]
  );

  const openTab = useCallback(
    (path: string, opts?: { background?: boolean }) => {
      const s = stateRef.current;
      if (s.tabs.length >= MAX_TABS) {
        window.alert(`Podes ter no máximo ${MAX_TABS} abas abertas. Fecha alguma primeiro.`);
        return;
      }
      const tab: AppTab = { id: newId(), path };
      const idx = s.tabs.findIndex((t) => t.id === s.activeId);
      const tabs = [...s.tabs];
      // Como no browser: a aba nova fica logo a seguir à atual.
      tabs.splice(idx + 1, 0, tab);
      if (opts?.background) {
        setState({ ...s, tabs });
      } else {
        rememberScroll();
        setState({ tabs, activeId: tab.id });
        go(path);
      }
    },
    [go]
  );

  const closeTab = useCallback(
    (id: string) => {
      const s = stateRef.current;
      const idx = s.tabs.findIndex((t) => t.id === id);
      if (idx < 0) return;
      const tabs = s.tabs.filter((t) => t.id !== id);
      delete scrollByTab.current[id];
      if (tabs.length === 0) {
        const fresh: AppTab = { id: newId(), path: HOME };
        setState({ tabs: [fresh], activeId: fresh.id });
        go(HOME);
        return;
      }
      if (id !== s.activeId) {
        setState({ ...s, tabs });
        return;
      }
      const next = tabs[Math.min(idx, tabs.length - 1)];
      setState({ tabs, activeId: next.id });
      go(next.path);
    },
    [go]
  );

  const setTabTitle = useCallback((id: string, title: string | undefined) => {
    setState((s) => {
      const t = s.tabs.find((x) => x.id === id);
      if (!t || t.title === title) return s;
      return { ...s, tabs: s.tabs.map((x) => (x.id === id ? { ...x, title } : x)) };
    });
  }, []);

  const moveTab = useCallback((id: string, toIndex: number) => {
    setState((s) => {
      const from = s.tabs.findIndex((t) => t.id === id);
      if (from < 0) return s;
      const tabs = [...s.tabs];
      const [t] = tabs.splice(from, 1);
      const to = Math.max(0, Math.min(toIndex > from ? toIndex - 1 : toIndex, tabs.length));
      if (to === from) return s;
      tabs.splice(to, 0, t);
      return { ...s, tabs };
    });
  }, []);

  const value = useMemo(
    () => ({ tabs: state.tabs, activeId: state.activeId, openTab, closeTab, activate, setTabTitle, moveTab }),
    [state, openTab, closeTab, activate, setTabTitle, moveTab]
  );

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

/** Abas da Central, ou null quando as abas não estão ligadas para este utilizador. */
export function useTabs() {
  return useContext(TabsContext);
}

export function TabIdProvider({ id, children }: { id: string; children: ReactNode }) {
  return <TabIdContext.Provider value={id}>{children}</TabIdContext.Provider>;
}

/** Uma página pode dar um nome mais útil à sua aba (ex.: "OS 1234"). */
export function useTabTitle(title: string | undefined) {
  const tabs = useContext(TabsContext);
  const id = useContext(TabIdContext);
  const setTabTitle = tabs?.setTabTitle;
  useEffect(() => {
    if (!setTabTitle || !id) return;
    setTabTitle(id, title);
  }, [setTabTitle, id, title]);
}
