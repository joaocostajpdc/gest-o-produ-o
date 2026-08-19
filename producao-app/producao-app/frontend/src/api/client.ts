// ============================================================================
// Cliente API — wrapper fino sobre fetch com injeção do token JWT e
// tratamento uniforme de erros vindos do backend.
// ============================================================================

const TOKEN_STORAGE_KEY = "producao_app_token";

// Nota: por indicação explícita das guidelines de artefactos deste ambiente,
// evita-se localStorage em contexto de artefacto; esta app corre como
// aplicação standalone (Vite), pelo que localStorage é seguro e apropriado
// aqui para persistir a sessão entre recarregamentos de página.
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
  else localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };

  const res = await fetch(`/api${path}`, { ...options, headers });

  if (res.status === 204) return undefined as T;

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const message = isJson && body?.error ? body.error : `Erro ${res.status}`;
    throw new ApiError(message, res.status, isJson ? body?.details : undefined);
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "POST", body: data !== undefined ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PUT", body: data !== undefined ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  // Envia um ficheiro em bruto (ex.: PDF) no corpo do pedido, em vez de JSON
  // — usado para a importação de Ordens de Serviço a partir de um PDF.
  postFile: <T>(path: string, file: File | Blob, contentType: string) =>
    request<T>(path, { method: "POST", body: file, headers: { "Content-Type": contentType } }),
  // Descarrega um ficheiro (CSV/PDF) autenticado e devolve-o como Blob, para
  // depois se gerar um link de download local — usar window.open() direto
  // não funciona para endpoints autenticados, pois não envia o token.
  getBlob: async (path: string): Promise<Blob> => {
    const token = getToken();
    const res = await fetch(`/api${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let message = `Erro ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error) message = body.error;
      } catch {
        // resposta não é JSON (ex.: erro genérico do servidor) — mantém a mensagem por defeito
      }
      throw new ApiError(message, res.status);
    }
    return res.blob();
  },
};

// Dispara o download de um Blob no browser com o nome de ficheiro indicado.
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildQuery(params: Record<string, string | undefined>): string {
  const usable = Object.entries(params).filter(([, v]) => v);
  if (usable.length === 0) return "";
  return "?" + new URLSearchParams(usable as [string, string][]).toString();
}

export { buildQuery };
