import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, downloadBlob } from "../api/client";
import {
  Attachment,
  HistoryEvent,
  INTERRUPTION_REASON_LABELS,
  InterruptionReason,
  ServiceOrderDetail,
  Stage,
  Supplier,
} from "../types";
import { minutesToDays, minutesToHuman, PriorityBadge, StatusBadge } from "../components/Badges";
import { canChangeFlow, canDeleteServiceOrders, useAuth } from "../contexts/AuthContext";

type Tab = "etapas" | "tempos" | "interrupcoes" | "observacoes" | "anexos" | "historico";

// Faz upload de um ficheiro em bruto para uma OS (e, opcionalmente, associado
// a uma observação — ver ObservacoesTab). O nome original do ficheiro segue
// como query param porque um upload em bruto (sem multipart) não o expõe de
// outra forma ao servidor.
async function uploadAttachment(orderId: string, file: File, observationId?: string): Promise<Attachment> {
  const params = new URLSearchParams({ filename: file.name });
  if (observationId) params.set("observationId", observationId);
  // A câmara de alguns telemóveis/browsers pode não preencher file.type —
  // nesse caso assume-se imagem (é sempre uma foto, neste fluxo), já que
  // "application/octet-stream" seria rejeitado pelo filtro de tipos aceites
  // no servidor.
  return api.postFile<Attachment>(
    `/service-orders/${orderId}/attachments?${params.toString()}`,
    file,
    file.type || "image/jpeg"
  );
}

// Converte um ISO string para o formato aceite por <input type="datetime-local">.
function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ServiceOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [order, setOrder] = useState<ServiceOrderDetail | null>(null);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [tab, setTab] = useState<Tab>("etapas");
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [editingDeadline, setEditingDeadline] = useState(false);
  const [deadlineInput, setDeadlineInput] = useState("");
  const [deadlineReason, setDeadlineReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [downloadingLabel, setDownloadingLabel] = useState<"barcode" | "product" | null>(null);

  async function downloadTravelerPdf() {
    if (!id) return;
    setDownloadingPdf(true);
    setActionError(null);
    try {
      const blob = await api.getBlob(`/service-orders/${id}/pdf`);
      downloadBlob(blob, `ficha-producao-${order?.externalId ?? id}.pdf`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Erro ao gerar a Ficha de Produção.");
    } finally {
      setDownloadingPdf(false);
    }
  }

  async function downloadLabel(kind: "barcode" | "product") {
    if (!id) return;
    setDownloadingLabel(kind);
    setActionError(null);
    try {
      const blob = await api.getBlob(`/service-orders/${id}/label-${kind}`);
      const suffix = kind === "barcode" ? "etiqueta-barras" : "etiqueta-produto";
      downloadBlob(blob, `${suffix}-${order?.externalId ?? id}.pdf`);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Erro ao gerar a etiqueta."
      );
    } finally {
      setDownloadingLabel(null);
    }
  }

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const [o, h, a] = await Promise.all([
        api.get<ServiceOrderDetail>(`/service-orders/${id}`),
        api.get<HistoryEvent[]>(`/service-orders/${id}/history`),
        api.get<Attachment[]>(`/service-orders/${id}/attachments`),
      ]);
      setOrder(o);
      setHistory(h);
      setAttachments(a);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    api.get<Stage[]>("/stages").then(setStages).catch(() => {});
    api.get<Supplier[]>("/suppliers").then(setSuppliers).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function runAction(action: () => Promise<unknown>): Promise<void> {
    setActionError(null);
    setBusy(true);
    try {
      await action();
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Ocorreu um erro.");
    } finally {
      setBusy(false);
    }
  }

  async function saveDeadline() {
    if (!id) return;
    if (!deadlineReason.trim()) {
      setActionError("É obrigatório justificar a alteração da data-limite.");
      return;
    }
    await runAction(() =>
      api.put(`/service-orders/${id}/deadline`, {
        deadlineAt: deadlineInput ? new Date(deadlineInput).toISOString() : null,
        reason: deadlineReason.trim(),
      })
    );
    setEditingDeadline(false);
    setDeadlineReason("");
  }

  async function handleDelete() {
    if (!id || !order) return;
    const confirmed = window.confirm(
      `Apagar definitivamente a Ordem de Serviço "${order.externalId}"?\n\n` +
        "Esta ação remove também todas as etapas, interrupções, observações e histórico associados, e não pode ser desfeita."
    );
    if (!confirmed) return;
    setDeleting(true);
    setActionError(null);
    try {
      await api.delete(`/service-orders/${id}`);
      navigate("/");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Erro ao apagar a Ordem de Serviço.");
      setDeleting(false);
    }
  }

  if (loading || !order) return <p className="muted">A carregar...</p>;

  const canFlow = canChangeFlow(user?.role);

  return (
    <div>
      <p>
