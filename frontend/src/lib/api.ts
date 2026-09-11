import { supabase } from "./supabase";
// Typed fetch layer over the FastAPI backend. Base is the relative "/api" prefix so the
// same code works in dev (Vite proxies /api → :8001) and behind a single origin in prod.
const BASE = "/api";

// Fields are declared, not constructor parameter properties: tsconfig sets
// erasableSyntaxOnly, which rejects `constructor(readonly status: number)`.
export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`request failed with ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type JsonBody = unknown;
type RequestOptions = { signal?: AbortSignal };

// Credential endpoints must never trigger a refresh-and-retry: a 401 from them is the
// real answer (bad password, expired refresh cookie), and retrying would loop.
const NO_REFRESH = ["/auth/login", "/auth/logout", "/auth/refresh", "/auth/register", "/auth/forgot-password"];

// Single-flight refresh: many queries can 401 at once (dashboard fires ~6 in parallel),
// and they must all wait on ONE /auth/refresh call rather than stampeding the endpoint.
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${BASE}/auth/refresh`, { method: "POST" })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        // Release the latch on the next tick so concurrent callers share this result.
        setTimeout(() => {
          refreshInFlight = null;
        }, 0);
      });
  }
  return refreshInFlight;
}


async function send(method: string, path: string, body?: JsonBody, options?: RequestOptions): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = body === undefined ? {} : { "Content-Type": "application/json" };
  
  if (session?.access_token) {
    headers["Authorization"] = `Bearer ${session.access_token}`;
  }

  return fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: options?.signal,
  });
}

async function request<T>(method: string, path: string, body?: JsonBody, options?: RequestOptions): Promise<T> {
  let res = await send(method, path, body, options);

  // The access cookie is short-lived; the refresh cookie outlives it by weeks. When the
  // access token lapses mid-session, renew it silently and replay the request once so the
  // user is never kicked back to /login while still holding a valid refresh cookie.
  if (res.status === 401 && !NO_REFRESH.includes(path)) {
    if (await refreshSession()) {
      res = await send(method, path, body, options);
    }
  }

  // FastAPI reports request-validation failures as 422 with a {detail: [...]} body.
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new ApiError(res.status, errBody);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// The response type is yours to declare: nothing infers across the Python boundary, so a
// TS interface here mirrors the endpoint's Pydantic model by hand — keep the two in sync.
export const apiGet = <T>(path: string) => request<T>("GET", path);
export const apiPost = <T>(path: string, body?: JsonBody, options?: RequestOptions) => request<T>("POST", path, body ?? null, options);
export const apiPut = <T>(path: string, body?: JsonBody) => request<T>("PUT", path, body ?? null);
export const apiPatch = <T>(path: string, body?: JsonBody) =>
  request<T>("PATCH", path, body ?? null);
export const apiDelete = <T>(path: string) => request<T>("DELETE", path);
