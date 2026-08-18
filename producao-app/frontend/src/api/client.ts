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
};

function buildQuery(params: Record<string, string | undefined>): string {
  const usable = Object.entries(params).filter(([, v]) => v);
  if (usable.length === 0) return "";
  return "?" + new URLSearchParams(usable as [string, string][]).toString();
}

export { buildQuery };
