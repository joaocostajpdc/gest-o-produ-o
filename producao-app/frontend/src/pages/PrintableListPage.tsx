import { useEffect, useMemo, useState } from "react";
import { api, buildQuery, downloadBlob } from "../api/client";
import { PriorityBadge, StatusBadge } from "../components/Badges";
import { useFeature } from "../contexts/FeaturesContext";
import { FeatureTestBanner } from "../components/FeatureTestBanner";
import { MultiSelect } from "../components/MultiSelect";
import { Client, PriorityLevel, Product, ServiceOrderStatus, Stage, Supplier } from "../types";

interface ReportRow {
  externalId: string;
  cliente: string;
  produto: string;
  acabamento?: string;
  estado: ServiceOrderStatus;
  etapaAtual: string;
  prazo: string;
  prioridade: string;
  prioridadeNivel: PriorityLevel | null;
  prioridadeCor: string | null;
  lancada?: string;
  entradaEtapa?: string;
}

const STATUS_OPTIONS = [
  { value: "NAO_INICIADA", label: "Não iniciada" },
  { value: "EM_PRODUCAO", label: "Em produção" },
  { value: "SUSPENSA", label: "Suspensa" },
  { value: "CONCLUIDA", label: "Concluída" },
  { value: "CANCELADA", label: "Cancelada" },
];

const PRIORITY_OPTIONS = [
  { value: "PRAZO_ULTRAPASSADO", label: "Prazo ultrapassado" },
  { value: "URGENTE", label: "Urgente" },
  { value: "PROXIMO", label: "Próximo" },
  { value: "COM_MARGEM", label: "Com margem" },
];

export function PrintableListPage() {
  // Coluna Acabamento (2026-10-29) — em teste, só o administrador até aprovar.
  const showAcab = useFeature("listagemAcabamento").available;
  // Várias escolhas no mesmo filtro (2026-10-29) — em teste.
  const multi = useFeature("filtrosMultiplos").available;
  // Intervalos de datas (2026-10-30): lançamento da OS e entrada numa etapa — em teste.
  const datas = useFeature("filtrosDatas").available;
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<"csv" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [filters, setFilters] = useState({
    status: "",
    stageId: "",
    supplierId: "",
    clientId: "",
    priority: "",
    category: "",
    search: "",
    lancDe: "",
    lancAte: "",
    etapaDataId: "",
    etapaDe: "",
    etapaAte: "",
  });
  // Filtros de datas só seguem para o servidor quando a funcionalidade está disponível.
  const sentFilters = datas
    ? filters
    : { ...filters, lancDe: "", lancAte: "", etapaDataId: "", etapaDe: "", etapaAte: "" };
  const showEntrada = datas && !!(filters.etapaDataId || filters.etapaDe || filters.etapaAte);

  useEffect(() => {
    Promise.all([
      api.get<Stage[]>("/stages"),
      api.get<Supplier[]>("/suppliers"),
      api.get<Client[]>("/clients"),
      api.get<Product[]>("/products"),
    ])
      .then(([s, sup, cl, prod]) => {
        setStages(s);
        setSuppliers(sup);
        setClients(cl);
        setProducts(prod);
      })
      .catch(() => {
        /* filtros são opcionais; falha silenciosa não bloqueia a listagem */
      });
  }, []);

  // Mesma lógica da listagem principal de OS: categorias de produto
  // disponíveis, derivadas dos produtos existentes.
  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-PT"));
  }, [products]);

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const query = buildQuery(sentFilters);
      const data = await api.get<ReportRow[]>(`/reports/service-orders${query}`);
      setRows(data);
      setGeneratedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao gerar a listagem.");
    } finally {
      setLoading(false);
    }
  }

  async function downloadFile(format: "csv" | "pdf") {
    setDownloading(format);
    setError(null);
    try {
      const query = buildQuery({ ...sentFilters, format });
      const blob = await api.getBlob(`/reports/service-orders${query}`);
      downloadBlob(blob, `listagem-ordens-servico.${format}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Erro ao gerar o ficheiro ${format.toUpperCase()}.`);
    } finally {
      setDownloading(null);
    }
  }

  const nameOf = (list: { id: string; name: string }[], ids: string) =>
    ids.split(",").filter(Boolean).map((id) => list.find((x) => x.id === id)?.name ?? "?").join(", ");
  const filtersSummary = describeFilters(sentFilters, {
    etapa: nameOf(stages, filters.stageId),
    fornecedor: nameOf(suppliers, filters.supplierId),
    cliente: nameOf(clients, filters.clientId),
    etapaData: nameOf(stages, sentFilters.etapaDataId),
  });

  return (
    <div>
      <div className="page-header">
        <h2>Listagens Imprimíveis</h2>
      </div>

      <div className="card no-print">
        <p className="muted">
          Gera uma listagem com base nos filtros aplicados — adequada para reuniões de acompanhamento,
          planeamento diário, distribuição entre setores ou consulta offline.
        </p>
        <div className="filters-bar">
          <input
            type="text"
            placeholder="Pesquisar OS, cliente, nº cliente ou produto..."
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          />
          {multi ? (
            <>
              <MultiSelect placeholder="Estado (todos)" options={STATUS_OPTIONS} value={filters.status} onChange={(v) => setFilters((f) => ({ ...f, status: v }))} />
              <MultiSelect placeholder="Prioridade (todas)" options={PRIORITY_OPTIONS} value={filters.priority} onChange={(v) => setFilters((f) => ({ ...f, priority: v }))} />
              <MultiSelect placeholder="Etapa (todas)" options={stages.map((x) => ({ value: x.id, label: x.name }))} value={filters.stageId} onChange={(v) => setFilters((f) => ({ ...f, stageId: v }))} />
              <MultiSelect placeholder="Fornecedor (todos)" options={suppliers.map((x) => ({ value: x.id, label: x.name }))} value={filters.supplierId} onChange={(v) => setFilters((f) => ({ ...f, supplierId: v }))} />
              <MultiSelect
                placeholder="Cliente (todos)"
                wide
                options={clients.map((c) => ({ value: c.id, label: c.externalId ? `${c.externalId} — ${c.name}` : c.name }))}
                value={filters.clientId}
                onChange={(v) => setFilters((f) => ({ ...f, clientId: v }))}
              />
              <MultiSelect placeholder="Categoria (todas)" options={categories.map((c) => ({ value: c, label: c }))} value={filters.category} onChange={(v) => setFilters((f) => ({ ...f, category: v }))} />
            </>
          ) : (
            <>
          <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">Estado (todos)</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}>
            <option value="">Prioridade (todas)</option>
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <select value={filters.stageId} onChange={(e) => setFilters((f) => ({ ...f, stageId: e.target.value }))}>
            <option value="">Etapa (todas)</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            value={filters.supplierId}
            onChange={(e) => setFilters((f) => ({ ...f, supplierId: e.target.value }))}
          >
            <option value="">Fornecedor (todos)</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select value={filters.clientId} onChange={(e) => setFilters((f) => ({ ...f, clientId: e.target.value }))}>
            <option value="">Cliente (todos)</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.externalId ? `${c.externalId} — ${c.name}` : c.name}
              </option>
            ))}
          </select>
          <select
            value={filters.category}
            onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
          >
            <option value="">Categoria (todas)</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
            </>
          )}
          {datas && (
            <div className="list-date-filters">
              <label>
                Lançada de
                <input type="date" value={filters.lancDe} onChange={(e) => setFilters((f) => ({ ...f, lancDe: e.target.value }))} />
              </label>
              <label>
                até
                <input type="date" value={filters.lancAte} onChange={(e) => setFilters((f) => ({ ...f, lancAte: e.target.value }))} />
              </label>
              <label>
                Foi para
                <select value={filters.etapaDataId} onChange={(e) => setFilters((f) => ({ ...f, etapaDataId: e.target.value }))}>
                  <option value="">(qualquer etapa)</option>
                  {stages.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                de
                <input type="date" value={filters.etapaDe} onChange={(e) => setFilters((f) => ({ ...f, etapaDe: e.target.value }))} />
              </label>
              <label>
                até
                <input type="date" value={filters.etapaAte} onChange={(e) => setFilters((f) => ({ ...f, etapaAte: e.target.value }))} />
              </label>
              {(filters.lancDe || filters.lancAte || filters.etapaDataId || filters.etapaDe || filters.etapaAte) && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setFilters((f) => ({ ...f, lancDe: "", lancAte: "", etapaDataId: "", etapaDe: "", etapaAte: "" }))}
                >
                  Limpar datas
                </button>
              )}
            </div>
          )}
          <button className="btn" onClick={loadReport} disabled={loading}>
            {loading ? "A gerar..." : "Gerar listagem"}
          </button>
          <button className="btn secondary" onClick={() => window.print()} disabled={rows.length === 0}>
            Imprimir
          </button>
          <button
            className="btn secondary"
            onClick={() => downloadFile("pdf")}
            disabled={rows.length === 0 || downloading !== null}
          >
            {downloading === "pdf" ? "A gerar PDF..." : "Baixar PDF"}
          </button>
          <button
            className="btn secondary"
            onClick={() => downloadFile("csv")}
            disabled={rows.length === 0 || downloading !== null}
          >
            {downloading === "csv" ? "A gerar CSV..." : "Exportar CSV"}
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
        <FeatureTestBanner featureKey="listagemAcabamento" label="a coluna Acabamento na listagem" />
        <FeatureTestBanner featureKey="filtrosMultiplos" label="os filtros com várias escolhas" />
        <FeatureTestBanner featureKey="filtrosDatas" label="os filtros de datas" />
      </div>

      <div className="card report-sheet">
        <div className="report-header">
          <div>
            <div className="report-title">Gestão de Produção</div>
            <div className="report-subtitle">Listagem de Ordens de Serviço</div>
          </div>
          {generatedAt && (
            <div className="report-meta">
              <div>Gerado em {generatedAt.toLocaleString("pt-PT")}</div>
              <div>
                {rows.length} Ordem(ns) de Serviço · {filtersSummary}
              </div>
            </div>
          )}
        </div>

        <table>
          <thead>
            <tr>
              <th>OS</th>
              <th>Cliente</th>
              <th>Produto</th>
              {showAcab && <th>Acabamento</th>}
              {datas && <th>Lançada</th>}
              <th>Estado</th>
              <th>Etapa atual</th>
              {showEntrada && <th>Entrou em</th>}
              <th>Prazo</th>
              <th>Prioridade</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.externalId}>
                <td>{r.externalId}</td>
                <td>{r.cliente}</td>
                <td>{r.produto}</td>
                {showAcab && <td>{r.acabamento ?? "-"}</td>}
                {datas && <td>{r.lancada ?? "-"}</td>}
                <td>
                  <StatusBadge status={r.estado} />
                </td>
                <td>{r.etapaAtual}</td>
                {showEntrada && <td>{r.entradaEtapa ?? "-"}</td>}
                <td>{r.prazo !== "-" ? new Date(r.prazo).toLocaleString("pt-PT") : "-"}</td>
                <td>
                  <PriorityBadge priority={r.prioridadeNivel} label={r.prioridade} color={r.prioridadeCor} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7 + (showAcab ? 1 : 0) + (datas ? 1 : 0) + (showEntrada ? 1 : 0)} className="muted">
                  Sem dados. Escolhe os filtros e clica em "Gerar listagem".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ptDay = (v: string) => (v ? v.split("-").reverse().join("/") : "");
const ptRange = (a: string, b: string) =>
  a && b ? `${ptDay(a)} a ${ptDay(b)}` : a ? `desde ${ptDay(a)}` : b ? `até ${ptDay(b)}` : "";

function describeFilters(
  filters: {
    status: string;
    priority: string;
    category: string;
    search: string;
    lancDe: string;
    lancAte: string;
    etapaDataId: string;
    etapaDe: string;
    etapaAte: string;
  },
  names: { etapa: string; fornecedor: string; cliente: string; etapaData: string }
): string {
  const parts: string[] = [];
  const labels = (v: string, opts: { value: string; label: string }[]) =>
    v.split(",").filter(Boolean).map((x) => opts.find((o) => o.value === x)?.label ?? x).join(", ");
  const statusLabel = labels(filters.status, STATUS_OPTIONS);
  const priorityLabel = labels(filters.priority, PRIORITY_OPTIONS);
  if (statusLabel) parts.push(`Estado: ${statusLabel}`);
  if (priorityLabel) parts.push(`Prioridade: ${priorityLabel}`);
  if (filters.category) parts.push(`Categoria: ${filters.category.split(",").join(", ")}`);
  if (filters.search) parts.push(`Pesquisa: "${filters.search}"`);
  if (names.etapa) parts.push(`Etapa: ${names.etapa}`);
  if (names.fornecedor) parts.push(`Fornecedor: ${names.fornecedor}`);
  if (names.cliente) parts.push(`Cliente: ${names.cliente}`);
  const lanc = ptRange(filters.lancDe, filters.lancAte);
  if (lanc) parts.push(`Lançada: ${lanc}`);
  const ent = ptRange(filters.etapaDe, filters.etapaAte);
  if (ent || names.etapaData) parts.push(`Foi para ${names.etapaData || "uma etapa"}${ent ? `: ${ent}` : ""}`);
  return parts.length ? parts.join(" · ") : "Sem filtros aplicados";
}
