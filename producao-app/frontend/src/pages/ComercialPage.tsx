import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../api/client";
import { useAuth } from "../contexts/AuthContext";
import { useFeature } from "../contexts/FeaturesContext";

// ============================================================================
// Comercial (pedido do utilizador de 2026-11-10: "e se passamos a parte
// comercial para a Central?" → "lança isso no teste"). Painel, carteira de
// clientes com ficha (visitas, OS, vendas e orçamentos), voltas, visitas e
// prospeção com mapa. Acesso restrito: "comercial".
// ============================================================================

interface Cliente {
  id: string;
  numero: string | null;
  nif: string | null;
  nome: string;
  zona: string | null;
  volta: string | null;
  email: string | null;
  telefone: string | null;
  estado: string;
  comercial: string | null;
  plafond: number | null;
  morada: string | null;
  codPostal: string | null;
  localidade: string | null;
  notas: string | null;
  ultimaVisita: string | null;
  proximaVisita: string | null;
  faturadoAno: number;
  encomendadoAno: number;
  ultimaCompra: string | null;
  osAtivas: number;
}
interface Visita {
  id: string;
  clienteId: string | null;
  leadId: string | null;
  data: string;
  objetivo: string | null;
  estado: string;
  notas: string | null;
  resultado: string | null;
  proxima: string | null;
  cliente?: { id: string; nome: string; zona: string | null; volta: string | null; comercial: string | null } | null;
  lead?: { id: string; nome: string; distrito: string | null } | null;
}
interface Lead {
  id: string;
  mercado: string;
  nif: string | null;
  nome: string;
  distrito: string | null;
  email: string | null;
  telefone: string | null;
  estado: string;
  newsletter: boolean;
  whatsapp: boolean;
  emailApresentacao: string | null;
  campanhas: string | null;
  conversas: string | null;
  notas: string | null;
}
interface Ficha extends Omit<Cliente, "ultimaVisita" | "proximaVisita" | "faturadoAno" | "encomendadoAno" | "ultimaCompra" | "osAtivas"> {
  visitas: Visita[];
  os: { id: string; externalId: string; status: string; produto: string; etapa: string | null; deadlineAt: string | null; createdAt: string }[];
  vendas: { id: string; kind: string; docType: string; docNumber: string; date: string; net: number }[];
  orcamentos: { id: string; num: string; data: string | null; tipo: string; estado: string; total: number | null; obra: string }[];
}
interface Painel {
  dias: number;
  clientesAtivos: number;
  visitasMes: number;
  semComprar: { id: string; nome: string; zona: string | null; comercial: string | null; ultimaCompra: string | null }[];
  nSemComprar: number;
  semVisita: { id: string; nome: string; zona: string | null; volta: string | null; comercial: string | null; ultimaVisita: string | null }[];
  nSemVisita: number;
  proximas: { id: string; data: string; nome: string; zona: string | null; objetivo: string | null; clienteId: string | null }[];
  atrasadas: { id: string; data: string; nome: string; clienteId: string | null }[];
  orcSemResposta: { num: string; data: string | null; cliente: string; total: number | null; estado: string }[];
  leads: Record<string, number>;
}

const TABS = [
  { key: "painel", label: "Painel" },
  { key: "clientes", label: "Clientes" },
  { key: "voltas", label: "Voltas" },
  { key: "visitas", label: "Visitas" },
  { key: "prospecao", label: "Prospeção" },
] as const;

const eur = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const dataPT = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const hojeIso = () => new Date().toISOString().slice(0, 10);
const diasDesde = (d: string | null) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null);
const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const ESTADO_LEAD: Record<string, string> = { prospecao: "Prospeção", conversas: "Em conversas", cliente: "Passou a cliente", concorrente: "Concorrente", sem_interesse: "Sem interesse" };
const ESTADO_VISITA: Record<string, string> = { planeada: "Planeada", realizada: "Realizada", cancelada: "Cancelada" };

export function ComercialPage() {
  const feature = useFeature("comercial");
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as (typeof TABS)[number]["key"]) || "painel";
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [fichaId, setFichaId] = useState<string | null>(null);
  const [visitaForm, setVisitaForm] = useState<Partial<Visita> | null>(null);
  const [reload, setReload] = useState(0);
  const [comercial, setComercial] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!feature.available) return;
    api
      .get<Cliente[]>("/comercial/clientes")
      .then((r) => {
        setClientes(r);
        // A carteira de cada um: por omissão, os clientes do próprio comercial.
        const first = user?.name?.split(" ")[0];
        if (first && r.some((c) => c.comercial === first)) setComercial((cur) => cur || first);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Erro ao carregar a carteira."));
  }, [feature.available, reload, user?.name]);

  const comerciais = useMemo(() => [...new Set(clientes.map((c) => c.comercial).filter(Boolean) as string[])].sort(), [clientes]);
  const meus = useMemo(() => (comercial ? clientes.filter((c) => c.comercial === comercial) : clientes), [clientes, comercial]);

  if (feature.loading) return <div className="muted">A carregar...</div>;
  if (!feature.available) return <Navigate to="/" replace />;

  const refresh = () => setReload((n) => n + 1);

  return (
    <div className="com">
      <div className="page-header com-head">
        <div>
          <h2>Comercial</h2>
          <p className="muted" style={{ margin: "2px 0 0" }}>
            Carteira de clientes, visitas e prospeção
          </p>
        </div>
        <div className="com-head-actions">
          <label className="com-select">
            Carteira
            <select value={comercial} onChange={(e) => setComercial(e.target.value)}>
              <option value="">Todos os comerciais</option>
              {comerciais.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn" onClick={() => setVisitaForm({ data: hojeIso(), estado: "realizada" })}>
            + Registar visita
          </button>
        </div>
      </div>

      <div className="com-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? "on" : ""} onClick={() => setParams({ tab: t.key })}>
            {t.label}
          </button>
        ))}
      </div>
      {error && <p className="error-text">{error}</p>}

      {tab === "painel" && <PainelTab clientes={meus} reload={reload} onFicha={setFichaId} comercial={comercial} />}
      {tab === "clientes" && <ClientesTab clientes={meus} onFicha={setFichaId} />}
      {tab === "voltas" && <VoltasTab clientes={meus} onFicha={setFichaId} onPlanear={(c, d) => setVisitaForm({ clienteId: c, data: d, estado: "planeada" })} />}
      {tab === "visitas" && <VisitasTab reload={reload} comercial={comercial} onFicha={setFichaId} onEdit={(v) => setVisitaForm(v)} />}
      {tab === "prospecao" && <ProspecaoTab />}

      {fichaId && (
        <FichaCliente
          id={fichaId}
          reload={reload}
          onClose={() => setFichaId(null)}
          onVisita={(v) => setVisitaForm(v)}
          onSaved={refresh}
        />
      )}
      {visitaForm && (
        <VisitaModal
          initial={visitaForm}
          clientes={clientes}
          onClose={() => setVisitaForm(null)}
          onSaved={() => {
            setVisitaForm(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function PainelTab({ clientes, reload, onFicha, comercial }: { clientes: Cliente[]; reload: number; onFicha: (id: string) => void; comercial: string }) {
  const [p, setP] = useState<Painel | null>(null);
  const [dias, setDias] = useState(60);
  useEffect(() => {
    api.get<Painel>(`/comercial/painel?dias=${dias}`).then(setP).catch(() => undefined);
  }, [dias, reload]);
  if (!p) return <p className="muted">A carregar...</p>;
  const ids = new Set(clientes.map((c) => c.id));
  const doMeu = <T extends { id?: string; clienteId?: string | null }>(x: T) => !comercial || ids.has((x.clienteId ?? x.id) as string);
  const semComprar = p.semComprar.filter(doMeu);
  const semVisita = p.semVisita.filter(doMeu);
  const proximas = p.proximas.filter((x) => !comercial || !x.clienteId || ids.has(x.clienteId));
  const atrasadas = p.atrasadas.filter((x) => !comercial || !x.clienteId || ids.has(x.clienteId));
  const faturado = clientes.reduce((s, c) => s + c.faturadoAno, 0);
  return (
    <div>
      <div className="com-kpis">
        <div className="com-kpi">
          <b>{clientes.filter((c) => c.estado === "ativo").length}</b>
          <span>Clientes ativos</span>
        </div>
        <div className="com-kpi">
          <b>{eur(faturado)}</b>
          <span>Faturado este ano</span>
        </div>
        <div className="com-kpi warn">
          <b>{semComprar.length}</b>
          <span>Sem comprar há {dias}+ dias</span>
        </div>
        <div className="com-kpi warn">
          <b>{semVisita.length}</b>
          <span>Sem visita há {dias}+ dias</span>
        </div>
        <div className="com-kpi">
          <b>{(p.leads.prospecao ?? 0) + (p.leads.conversas ?? 0)}</b>
          <span>Empresas em prospeção</span>
        </div>
      </div>
      <div className="com-dias">
        Considerar parado ao fim de
        {[30, 60, 90].map((d) => (
          <button key={d} type="button" className={dias === d ? "on" : ""} onClick={() => setDias(d)}>
            {d} dias
          </button>
        ))}
      </div>
      <div className="com-grid2">
        <section className="com-card">
          <h3>Próximas visitas</h3>
          {proximas.length === 0 && <p className="muted">Nenhuma visita marcada.</p>}
          {proximas.map((v) => (
            <button key={v.id} type="button" className="com-row" onClick={() => v.clienteId && onFicha(v.clienteId)}>
              <span className="com-date">{dataPT(v.data)}</span>
              <span className="com-grow">
                <strong>{v.nome}</strong>
                {v.objetivo && <small>{v.objetivo}</small>}
              </span>
              {v.zona && <span className="com-pill">{v.zona}</span>}
            </button>
          ))}
          {atrasadas.length > 0 && (
            <>
              <h4>Marcadas e por fazer</h4>
              {atrasadas.map((v) => (
                <button key={v.id} type="button" className="com-row" onClick={() => v.clienteId && onFicha(v.clienteId)}>
                  <span className="com-date red">{dataPT(v.data)}</span>
                  <span className="com-grow">
                    <strong>{v.nome}</strong>
                  </span>
                </button>
              ))}
            </>
          )}
        </section>
        <section className="com-card">
          <h3>Orçamentos sem resposta (+7 dias)</h3>
          {p.orcSemResposta.length === 0 && <p className="muted">Nada pendente.</p>}
          {p.orcSemResposta.map((o) => (
            <div key={o.num} className="com-row static">
              <span className="com-date">{dataPT(o.data)}</span>
              <span className="com-grow">
                <strong>{o.num}</strong>
                <small>{o.cliente || "—"}</small>
              </span>
              <span>{eur(o.total)}</span>
            </div>
          ))}
        </section>
        <section className="com-card">
          <h3>Clientes sem comprar</h3>
          {semComprar.length === 0 && <p className="muted">Todos compraram nos últimos {dias} dias.</p>}
          {semComprar.slice(0, 15).map((c) => (
            <button key={c.id} type="button" className="com-row" onClick={() => onFicha(c.id)}>
              <span className="com-grow">
                <strong>{c.nome}</strong>
                <small>{c.zona ?? ""}</small>
              </span>
              <span className="com-pill warn">{c.ultimaCompra ? `${diasDesde(c.ultimaCompra)} dias` : "sem compras"}</span>
            </button>
          ))}
        </section>
        <section className="com-card">
          <h3>Clientes sem visita</h3>
          {semVisita.length === 0 && <p className="muted">Todos visitados nos últimos {dias} dias.</p>}
          {semVisita.slice(0, 15).map((c) => (
            <button key={c.id} type="button" className="com-row" onClick={() => onFicha(c.id)}>
              <span className="com-grow">
                <strong>{c.nome}</strong>
                <small>
                  {c.zona ?? ""}
                  {c.volta ? ` · volta ${c.volta}` : ""}
                </small>
              </span>
              <span className="com-pill warn">{c.ultimaVisita ? `${diasDesde(c.ultimaVisita)} dias` : "nunca"}</span>
            </button>
          ))}
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function ClientesTab({ clientes, onFicha }: { clientes: Cliente[]; onFicha: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("ativo");
  const [volta, setVolta] = useState("");
  const voltas = useMemo(() => [...new Set(clientes.map((c) => c.volta ?? ""))].sort((a, b) => a.localeCompare(b, "pt", { numeric: true })), [clientes]);
  const nq = norm(q.trim());
  const rows = clientes.filter(
    (c) =>
      (!estado || c.estado === estado) &&
      (!volta || (c.volta ?? "") === volta) &&
      (!nq || norm(c.nome).includes(nq) || norm(c.zona).includes(nq) || (c.numero ?? "").includes(nq) || (c.nif ?? "").includes(nq))
  );
  return (
    <div className="com-card">
      <div className="filters-bar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar nome, zona, nº ou NIF…" />
        <select value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todos os estados</option>
          <option value="ativo">Ativos</option>
          <option value="prospecao">Em prospeção</option>
          <option value="inativo">Inativos</option>
        </select>
        <select value={volta} onChange={(e) => setVolta(e.target.value)}>
          <option value="">Todas as voltas</option>
          {voltas.map((v) => (
            <option key={v} value={v}>
              {v ? `Volta ${v}` : "Sem volta"}
            </option>
          ))}
        </select>
        <span className="muted" style={{ alignSelf: "center" }}>
          {rows.length} clientes
        </span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Zona</th>
              <th>Volta</th>
              <th>Comercial</th>
              <th>Última visita</th>
              <th>Próxima</th>
              <th style={{ textAlign: "right" }}>Faturado (ano)</th>
              <th>Última compra</th>
              <th style={{ textAlign: "center" }}>OS ativas</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const dv = diasDesde(c.ultimaVisita);
              return (
                <tr key={c.id} className="com-click" onClick={() => onFicha(c.id)}>
                  <td>
                    <strong>{c.nome}</strong>
                    {c.numero && <div className="muted small">nº {c.numero}</div>}
                  </td>
                  <td>{c.zona ?? "—"}</td>
                  <td>{c.volta ?? "—"}</td>
                  <td>{c.comercial ?? "—"}</td>
                  <td className={dv != null && dv > 60 ? "com-warn" : undefined}>{dataPT(c.ultimaVisita)}</td>
                  <td>{dataPT(c.proximaVisita)}</td>
                  <td style={{ textAlign: "right" }}>{c.faturadoAno ? eur(c.faturadoAno) : "—"}</td>
                  <td>{dataPT(c.ultimaCompra)}</td>
                  <td style={{ textAlign: "center" }}>{c.osAtivas || "—"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">
                  Sem clientes com estes filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function VoltasTab({ clientes, onFicha, onPlanear }: { clientes: Cliente[]; onFicha: (id: string) => void; onPlanear: (clienteId: string, data: string) => void }) {
  const ativos = clientes.filter((c) => c.estado === "ativo");
  const grupos = useMemo(() => {
    const m = new Map<string, Cliente[]>();
    ativos.forEach((c) => {
      const k = c.volta && c.volta.trim() ? c.volta.trim() : "Sem volta";
      m.set(k, [...(m.get(k) ?? []), c]);
    });
    return [...m.entries()].sort((a, b) => (a[0] === "Sem volta" ? 1 : b[0] === "Sem volta" ? -1 : a[0].localeCompare(b[0], "pt", { numeric: true })));
  }, [ativos]);
  return (
    <div className="com-voltas">
      {grupos.map(([nome, lista]) => {
        const porVisitar = lista.filter((c) => {
          const d = diasDesde(c.ultimaVisita);
          return d == null || d > 30;
        }).length;
        return (
          <section key={nome} className="com-card">
            <div className="com-volta-head">
              <h3>{/^\d+$/.test(nome) ? `Volta ${nome}` : nome}</h3>
              <span className="muted">
                {lista.length} clientes · {porVisitar} sem visita há 30+ dias
              </span>
            </div>
            {lista
              .sort((a, b) => (a.zona ?? "").localeCompare(b.zona ?? "", "pt") || a.nome.localeCompare(b.nome, "pt"))
              .map((c) => {
                const d = diasDesde(c.ultimaVisita);
                return (
                  <div key={c.id} className="com-row">
                    <button type="button" className="com-grow com-linkbtn" onClick={() => onFicha(c.id)}>
                      <strong>{c.nome}</strong>
                      <small>{c.zona ?? ""}</small>
                    </button>
                    <span className={`com-pill${d == null || d > 30 ? " warn" : ""}`}>{d == null ? "nunca visitado" : d === 0 ? "hoje" : `há ${d} dias`}</span>
                    {c.proximaVisita ? (
                      <span className="com-pill blue">{dataPT(c.proximaVisita)}</span>
                    ) : (
                      <button type="button" className="link-button" onClick={() => onPlanear(c.id, hojeIso())}>
                        Marcar
                      </button>
                    )}
                  </div>
                );
              })}
          </section>
        );
      })}
      {grupos.length === 0 && <p className="muted">Sem clientes ativos nesta carteira.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
function VisitasTab({ reload, comercial, onFicha, onEdit }: { reload: number; comercial: string; onFicha: (id: string) => void; onEdit: (v: Visita) => void }) {
  const [rows, setRows] = useState<Visita[]>([]);
  const [estado, setEstado] = useState("");
  useEffect(() => {
    api.get<Visita[]>("/comercial/visitas").then(setRows).catch(() => undefined);
  }, [reload]);
  const list = rows.filter((v) => (!estado || v.estado === estado) && (!comercial || v.cliente?.comercial === comercial || (!v.cliente && v.lead)));
  return (
    <div className="com-card">
      <div className="filters-bar">
        <select value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todas as visitas</option>
          <option value="planeada">Planeadas</option>
          <option value="realizada">Realizadas</option>
          <option value="cancelada">Canceladas</option>
        </select>
        <span className="muted" style={{ alignSelf: "center" }}>
          {list.length} visitas
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Cliente / empresa</th>
            <th>Objetivo</th>
            <th>Estado</th>
            <th>Notas / resultado</th>
            <th>Próxima</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((v) => (
            <tr key={v.id}>
              <td style={{ whiteSpace: "nowrap" }}>{dataPT(v.data)}</td>
              <td>
                {v.cliente ? (
                  <button type="button" className="com-linkbtn" onClick={() => onFicha(v.cliente!.id)}>
                    <strong>{v.cliente.nome}</strong>
                  </button>
                ) : (
                  <strong>{v.lead?.nome ?? "—"}</strong>
                )}
                <div className="muted small">{v.cliente?.zona ?? v.lead?.distrito ?? ""}</div>
              </td>
              <td>{v.objetivo ?? ""}</td>
              <td>
                <span className={`com-pill ${v.estado === "realizada" ? "green" : v.estado === "planeada" ? "blue" : ""}`}>{ESTADO_VISITA[v.estado] ?? v.estado}</span>
              </td>
              <td style={{ maxWidth: 360 }}>{[v.notas, v.resultado].filter(Boolean).join(" · ")}</td>
              <td>{dataPT(v.proxima)}</td>
              <td>
                <button type="button" className="btn secondary" onClick={() => onEdit(v)}>
                  {v.estado === "planeada" ? "Registar" : "Editar"}
                </button>
              </td>
            </tr>
          ))}
          {list.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                Sem visitas.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coordenadas aproximadas dos distritos (PT) e províncias (ES) para o mapa.
const CENTROS: Record<string, [number, number]> = {
  "Viana do Castelo": [41.69, -8.83], Braga: [41.55, -8.42], Famalicão: [41.41, -8.52], Porto: [41.15, -8.61], "Vila Real": [41.3, -7.74], Bragança: [41.81, -6.76],
  Aveiro: [40.64, -8.65], Viseu: [40.66, -7.91], Guarda: [40.54, -7.27], Coimbra: [40.21, -8.43], "Castelo Branco": [39.82, -7.49], Leiria: [39.74, -8.81],
  Santarém: [39.24, -8.69], Portalegre: [39.29, -7.43], Lisboa: [38.72, -9.14], Setúbal: [38.52, -8.89], Évora: [38.57, -7.91], Beja: [38.02, -7.86], Faro: [37.02, -7.93],
  Açores: [37.74, -25.67], Madeira: [32.65, -16.91],
  Pontevedra: [42.43, -8.64], Ourense: [42.34, -7.86], "A Coruña": [43.36, -8.41], Lugo: [43.01, -7.56], Barcelona: [41.39, 2.17], Bizkaia: [43.26, -2.93], Madrid: [40.42, -3.7],
  Valencia: [39.47, -0.38], Sevilla: [37.39, -5.98], Zaragoza: [41.65, -0.89], Málaga: [36.72, -4.42],
};
const COR_LEAD: Record<string, string> = { prospecao: "#2f4cf5", conversas: "#ea580c", cliente: "#16a34a", concorrente: "#6b7280", sem_interesse: "#9ca3af" };

function ProspecaoTab() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [mercado, setMercado] = useState("");
  const [distrito, setDistrito] = useState("");
  const [estado, setEstado] = useState("");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Lead | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  const load = () => api.get<Lead[]>("/comercial/leads").then(setLeads).catch(() => undefined);
  useEffect(() => {
    load();
  }, []);

  const distritos = useMemo(() => [...new Set(leads.filter((l) => !mercado || l.mercado === mercado).map((l) => l.distrito ?? ""))].filter(Boolean).sort((a, b) => a.localeCompare(b, "pt")), [leads, mercado]);
  const nq = norm(q.trim());
  const rows = leads.filter(
    (l) => (!mercado || l.mercado === mercado) && (!distrito || l.distrito === distrito) && (!estado || l.estado === estado) && (!nq || norm(l.nome).includes(nq) || norm(l.email).includes(nq))
  );

  // Mapa: um círculo por distrito/província, do tamanho do nº de empresas.
  useEffect(() => {
    if (!mapRef.current) return;
    if (!map.current) {
      map.current = L.map(mapRef.current, { scrollWheelZoom: false }).setView([40.6, -6.5], 6);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(map.current);
      layer.current = L.layerGroup().addTo(map.current);
    }
    layer.current!.clearLayers();
    const byDist = new Map<string, Lead[]>();
    rows.forEach((l) => l.distrito && byDist.set(l.distrito, [...(byDist.get(l.distrito) ?? []), l]));
    byDist.forEach((ls, d) => {
      const c = CENTROS[d];
      if (!c) return;
      const conversas = ls.filter((l) => l.estado === "conversas").length;
      L.circleMarker(c, {
        radius: 7 + Math.sqrt(ls.length) * 4,
        color: conversas ? COR_LEAD.conversas : COR_LEAD.prospecao,
        fillOpacity: 0.35,
        weight: 2,
      })
        .bindTooltip(`<b>${d}</b><br>${ls.length} empresa${ls.length > 1 ? "s" : ""}${conversas ? ` · ${conversas} em conversas` : ""}`)
        .on("click", () => setDistrito(d))
        .addTo(layer.current!);
    });
  }, [rows]);
  useEffect(() => () => {
    map.current?.remove();
    map.current = null;
  }, []);

  async function save(l: Lead, patch: Partial<Lead>) {
    const r = await api.put<Lead>(`/comercial/leads/${l.id}`, patch);
    setLeads((prev) => prev.map((x) => (x.id === r.id ? r : x)));
    if (sel?.id === r.id) setSel(r);
  }

  return (
    <div className="com-prosp">
      <div className="com-card com-mapcard">
        <div ref={mapRef} className="com-map" />
        <div className="com-legend">
          <span>
            <i style={{ background: COR_LEAD.prospecao }} /> Prospeção
          </span>
          <span>
            <i style={{ background: COR_LEAD.conversas }} /> Com conversas
          </span>
          <span className="muted">Carrega num círculo para filtrar o distrito.</span>
        </div>
      </div>
      <div className="com-card">
        <div className="filters-bar">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar empresa ou email…" />
          <select value={mercado} onChange={(e) => { setMercado(e.target.value); setDistrito(""); }}>
            <option value="">Portugal e Espanha</option>
            <option value="PT">Portugal</option>
            <option value="ES">Espanha</option>
          </select>
          <select value={distrito} onChange={(e) => setDistrito(e.target.value)}>
            <option value="">Todos os distritos</option>
            {distritos.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="">Todos os estados</option>
            {Object.entries(ESTADO_LEAD).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <span className="muted" style={{ alignSelf: "center" }}>
            {rows.length} empresas
          </span>
        </div>
        <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Distrito</th>
                <th>Contacto</th>
                <th>Estado</th>
                <th>Apresentação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="com-click" onClick={() => setSel(l)}>
                  <td>
                    <strong>{l.nome}</strong>
                    <div className="muted small">{l.mercado === "ES" ? "Espanha" : "Portugal"}</div>
                  </td>
                  <td>{l.distrito ?? "—"}</td>
                  <td className="small">{[l.email, l.telefone].filter(Boolean).join(" · ") || "—"}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <select value={l.estado} onChange={(e) => save(l, { estado: e.target.value })} style={{ color: COR_LEAD[l.estado] }}>
                      {Object.entries(ESTADO_LEAD).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{dataPT(l.emailApresentacao)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {sel && <LeadModal lead={sel} onClose={() => setSel(null)} onSave={(patch) => save(sel, patch)} />}
    </div>
  );
}

function LeadModal({ lead, onClose, onSave }: { lead: Lead; onClose: () => void; onSave: (p: Partial<Lead>) => Promise<void> }) {
  const [notas, setNotas] = useState(lead.notas ?? "");
  const [conversas, setConversas] = useState(lead.conversas ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <div className="plan-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="plan-modal com-modal">
        <div className="com-modal-head">
          <div>
            <h3>{lead.nome}</h3>
            <p className="muted">
              {lead.distrito ?? ""} · {lead.mercado === "ES" ? "Espanha" : "Portugal"}
              {lead.nif ? ` · NIF ${lead.nif}` : ""}
            </p>
          </div>
          <button type="button" className="link-button" onClick={onClose}>
            Fechar
          </button>
        </div>
        <p className="small">{[lead.email, lead.telefone].filter(Boolean).join(" · ") || "Sem contactos."}</p>
        <p className="small muted">
          Newsletter: {lead.newsletter ? "sim" : "não"} · WhatsApp: {lead.whatsapp ? "sim" : "não"} · Campanhas: {lead.campanhas ?? "—"}
        </p>
        <label className="field">
          Conversas
          <textarea rows={3} value={conversas} onChange={(e) => setConversas(e.target.value)} />
        </label>
        <label className="field">
          Notas
          <textarea rows={3} value={notas} onChange={(e) => setNotas(e.target.value)} />
        </label>
        <div className="com-modal-actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onSave({ notas, conversas }).finally(() => setBusy(false));
              onClose();
            }}
          >
            Gravar
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function FichaCliente({ id, reload, onClose, onVisita, onSaved }: { id: string; reload: number; onClose: () => void; onVisita: (v: Partial<Visita>) => void; onSaved: () => void }) {
  const [f, setF] = useState<Ficha | null>(null);
  const [edit, setEdit] = useState(false);
  const [notas, setNotas] = useState("");
  useEffect(() => {
    api
      .get<Ficha>(`/comercial/clientes/${id}`)
      .then((r) => {
        setF(r);
        setNotas(r.notas ?? "");
      })
      .catch(() => undefined);
  }, [id, reload]);
  return (
    <div className="plan-modal-backdrop com-drawer-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="com-drawer" role="dialog" aria-label="Ficha do cliente">
        {!f ? (
          <p className="muted">A carregar...</p>
        ) : (
          <>
            <div className="com-modal-head">
              <div>
                <h3>{f.nome}</h3>
                <p className="muted">
                  {[f.numero ? `nº ${f.numero}` : null, f.nif ? `NIF ${f.nif}` : null, f.zona, f.volta ? `volta ${f.volta}` : null, f.comercial].filter(Boolean).join(" · ")}
                </p>
              </div>
              <button type="button" className="link-button" onClick={onClose}>
                Fechar
              </button>
            </div>
            <div className="com-ficha-actions">
              <button type="button" className="btn" onClick={() => onVisita({ clienteId: f.id, data: hojeIso(), estado: "realizada" })}>
                Registar visita
              </button>
              <button type="button" className="btn secondary" onClick={() => onVisita({ clienteId: f.id, data: hojeIso(), estado: "planeada" })}>
                Marcar visita
              </button>
              {f.telefone && (
                <a className="btn secondary" href={`tel:${f.telefone.replace(/\s/g, "")}`}>
                  Ligar
                </a>
              )}
              {f.email && (
                <a className="btn secondary" href={`mailto:${f.email}`}>
                  Email
                </a>
              )}
            </div>
            <div className="com-ficha-info">
              <div>
                <span>Telefone</span>
                {f.telefone ?? "—"}
              </div>
              <div>
                <span>Email</span>
                {f.email ?? "—"}
              </div>
              <div>
                <span>Plafond</span>
                {eur(f.plafond)}
              </div>
              <div>
                <span>Morada</span>
                {[f.morada, f.codPostal, f.localidade].filter(Boolean).join(", ") || "—"}
              </div>
            </div>
            <section>
              <div className="com-sec-head">
                <h4>Notas</h4>
                {!edit ? (
                  <button type="button" className="link-button" onClick={() => setEdit(true)}>
                    Editar
                  </button>
                ) : (
                  <button
                    type="button"
                    className="link-button"
                    onClick={async () => {
                      await api.put(`/comercial/clientes/${f.id}`, { notas });
                      setEdit(false);
                      setF({ ...f, notas });
                      onSaved();
                    }}
                  >
                    Gravar
                  </button>
                )}
              </div>
              {edit ? <textarea rows={3} value={notas} onChange={(e) => setNotas(e.target.value)} style={{ width: "100%" }} /> : <p className="small">{f.notas || <span className="muted">Sem notas.</span>}</p>}
            </section>
            <section>
              <h4>Visitas</h4>
              {f.visitas.length === 0 && <p className="muted small">Ainda sem visitas.</p>}
              {f.visitas.slice(0, 10).map((v) => (
                <button key={v.id} type="button" className="com-row" onClick={() => onVisita(v)}>
                  <span className="com-date">{dataPT(v.data)}</span>
                  <span className="com-grow">
                    <strong>{v.objetivo || ESTADO_VISITA[v.estado]}</strong>
                    {(v.notas || v.resultado) && <small>{[v.notas, v.resultado].filter(Boolean).join(" · ")}</small>}
                  </span>
                  <span className={`com-pill ${v.estado === "realizada" ? "green" : v.estado === "planeada" ? "blue" : ""}`}>{ESTADO_VISITA[v.estado]}</span>
                </button>
              ))}
            </section>
            <section>
              <h4>Ordens de Serviço</h4>
              {!f.numero && <p className="muted small">Sem nº de cliente do Goldylocks — não dá para ligar às OS.</p>}
              {f.numero && f.os.length === 0 && <p className="muted small">Sem OS.</p>}
              {f.os.slice(0, 10).map((o) => (
                <Link key={o.id} to={`/service-orders/${o.id}`} className="com-row">
                  <span className="com-date">{o.externalId}</span>
                  <span className="com-grow">
                    <strong>{o.produto}</strong>
                    <small>{o.etapa ?? o.status}</small>
                  </span>
                </Link>
              ))}
            </section>
            <section>
              <h4>Vendas</h4>
              {f.vendas.length === 0 && <p className="muted small">Sem faturas nem encomendas importadas.</p>}
              {f.vendas.slice(0, 10).map((v) => (
                <div key={v.id} className="com-row static">
                  <span className="com-date">{dataPT(v.date)}</span>
                  <span className="com-grow">
                    <strong>{v.docNumber}</strong>
                    <small>{v.docType}</small>
                  </span>
                  <span>{eur(v.net)}</span>
                </div>
              ))}
            </section>
            <section>
              <h4>Orçamentos</h4>
              {f.orcamentos.length === 0 && <p className="muted small">Sem orçamentos na Central para este cliente.</p>}
              {f.orcamentos.map((o) => (
                <div key={o.id} className="com-row static">
                  <span className="com-date">{dataPT(o.data)}</span>
                  <span className="com-grow">
                    <strong>{o.num}</strong>
                    <small>{[o.tipo, o.obra, o.estado].filter(Boolean).join(" · ")}</small>
                  </span>
                  <span>{eur(o.total)}</span>
                </div>
              ))}
            </section>
          </>
        )}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
function VisitaModal({ initial, clientes, onClose, onSaved }: { initial: Partial<Visita>; clientes: Cliente[]; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Partial<Visita>>({ ...initial, estado: initial.id && initial.estado === "planeada" ? "realizada" : initial.estado });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const sorted = useMemo(() => [...clientes].sort((a, b) => a.nome.localeCompare(b.nome, "pt")), [clientes]);
  const opts = q ? sorted.filter((c) => norm(c.nome).includes(norm(q))) : sorted;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body = {
        clienteId: v.clienteId ?? null,
        leadId: v.leadId ?? null,
        data: v.data,
        objetivo: v.objetivo || null,
        estado: v.estado ?? "planeada",
        notas: v.notas || null,
        resultado: v.resultado || null,
        proxima: v.proxima || null,
      };
      if (v.id) await api.put(`/comercial/visitas/${v.id}`, body);
      else await api.post("/comercial/visitas", body);
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Não foi possível gravar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="plan-modal-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="plan-modal com-modal" onSubmit={submit}>
        <div className="com-modal-head">
          <h3>{v.id ? "Visita" : v.estado === "planeada" ? "Marcar visita" : "Registar visita"}</h3>
          <button type="button" className="link-button" onClick={onClose}>
            Fechar
          </button>
        </div>
        {!v.leadId && (
          <label className="field">
            Cliente
            {!v.clienteId && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar cliente…" />}
            <select required value={v.clienteId ?? ""} onChange={(e) => setV({ ...v, clienteId: e.target.value })} size={v.clienteId ? undefined : 6}>
              {!v.clienteId && <option value="">— escolhe —</option>}
              {opts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                  {c.zona ? ` · ${c.zona}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="com-form-row">
          <label className="field">
            Data
            <input type="date" required value={v.data ?? ""} onChange={(e) => setV({ ...v, data: e.target.value })} />
          </label>
          <label className="field">
            Estado
            <select value={v.estado ?? "planeada"} onChange={(e) => setV({ ...v, estado: e.target.value })}>
              <option value="planeada">Planeada</option>
              <option value="realizada">Realizada</option>
              <option value="cancelada">Cancelada</option>
            </select>
          </label>
        </div>
        <label className="field">
          Objetivo
          <input value={v.objetivo ?? ""} onChange={(e) => setV({ ...v, objetivo: e.target.value })} placeholder="ex.: apresentar painéis, levar amostras" />
        </label>
        {v.estado === "realizada" && (
          <>
            <label className="field">
              Notas da visita
              <textarea rows={3} value={v.notas ?? ""} onChange={(e) => setV({ ...v, notas: e.target.value })} />
            </label>
            <label className="field">
              Resultado
              <input value={v.resultado ?? ""} onChange={(e) => setV({ ...v, resultado: e.target.value })} placeholder="ex.: pediu orçamento de 4 portas" />
            </label>
            <label className="field">
              Próxima visita (fica marcada)
              <input type="date" value={v.proxima ?? ""} onChange={(e) => setV({ ...v, proxima: e.target.value })} />
            </label>
          </>
        )}
        {err && <p className="error-text">{err}</p>}
        <div className="com-modal-actions">
          {v.id && (
            <button
              type="button"
              className="btn secondary"
              style={{ color: "#dc2626", marginRight: "auto" }}
              onClick={async () => {
                if (!window.confirm("Apagar esta visita?")) return;
                await api.delete(`/comercial/visitas/${v.id}`);
                onSaved();
              }}
            >
              Apagar
            </button>
          )}
          <button type="submit" className="btn" disabled={busy}>
            {busy ? "A gravar…" : "Gravar"}
          </button>
        </div>
      </form>
    </div>
  );
}
