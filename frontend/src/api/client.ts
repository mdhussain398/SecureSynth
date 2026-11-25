import type { ErrorBody, ErrorCode } from './types';

export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true';
export const DEVICE_KEY_STORAGE = 'ss_device_key';

/** Typed error raised for any non-2xx response. */
export class ApiError extends Error {
  readonly code: ErrorCode | 'NETWORK_ERROR' | 'UNKNOWN';
  readonly status: number;
  readonly requestId: string | null;
  constructor(code: ApiError['code'], message: string, status: number, requestId: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

export interface ApiResult<T> { status: number; data: T }

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

function readCookie(name: string): string | null {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export function getDeviceKey(): string | null {
  try { return localStorage.getItem(DEVICE_KEY_STORAGE); } catch { return null; }
}
export function setDeviceKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(DEVICE_KEY_STORAGE, key);
    else localStorage.removeItem(DEVICE_KEY_STORAGE);
  } catch { /* storage unavailable: pairing lasts for this page only */ }
}

function isErrorBody(x: unknown): x is ErrorBody {
  return typeof x === 'object' && x !== null && 'error' in x &&
    typeof (x as ErrorBody).error?.code === 'string';
}

interface RequestOptions { body?: unknown; device?: boolean }

/**
 * Core request. Banking/admin calls use the session cookie (credentials: include) and send
 * X-CSRF-Token from the ss_csrf cookie on mutating requests. Device calls (`device: true`)
 * authenticate only with X-Device-Key and omit cookies entirely.
 */
export async function request<T>(method: Method, path: string, opts: RequestOptions = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  if (opts.device) {
    const key = getDeviceKey();
    if (key) headers['X-Device-Key'] = key;
  } else if (method !== 'GET') {
    const csrf = readCookie('ss_csrf');
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  if (USE_MOCKS) {
    const { mockFetch } = await import('./mock');
    const res = await mockFetch(method, path, opts.body, headers);
    if (res.status >= 400) throw toApiError(res.status, res.body);
    return { status: res.status, data: res.body as T };
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: opts.device ? 'omit' : 'include',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'Could not reach the SecureSynth server. Check that the backend is running.', 0);
  }

  let parsed: unknown = null;
  if (res.status !== 204) {
    const text = await res.text();
    if (text) {
      try { parsed = JSON.parse(text); } catch { parsed = null; }
    }
  }
  if (!res.ok) throw toApiError(res.status, parsed);
  return { status: res.status, data: parsed as T };
}

function toApiError(status: number, body: unknown): ApiError {
  if (isErrorBody(body)) {
    return new ApiError(body.error.code, body.error.message, status, body.error.request_id);
  }
  return new ApiError('UNKNOWN', `Request failed with status ${status}.`, status);
}

export const api = {
  get: <T>(path: string, device = false) => request<T>('GET', path, { device }).then((r) => r.data),
  post: <T>(path: string, body?: unknown, device = false) => request<T>('POST', path, { body, device }),
};
