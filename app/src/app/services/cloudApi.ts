export interface CloudUser {
  id: string;
  email: string;
  name: string;
  emailVerified?: boolean;
  emailVerifiedAt?: string | null;
  mfaEnabled?: boolean;
  mfaEnrolledAt?: string | null;
}

export interface CloudOrg {
  id: string;
  name: string;
  role: string;
}

interface CloudRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  token?: string | null;
  body?: unknown;
  cache?: RequestCache;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export class CloudRequestError extends Error {
  status: number;
  payload: unknown;
  requestId: string | null;

  constructor(message: string, status: number, payload: unknown, requestId: string | null) {
    super(message);
    this.name = 'CloudRequestError';
    this.status = status;
    this.payload = payload;
    this.requestId = requestId;
  }
}

export const CLOUD_SYNC_ENABLED = import.meta.env.VITE_ENABLE_CLOUD_SYNC === 'true';
const CONFIGURED_CLOUD_API_BASE_URL =
  typeof import.meta.env.VITE_API_URL === 'string'
    ? import.meta.env.VITE_API_URL.replace(/\/+$/, '')
    : typeof import.meta.env.VITE_SERVER_URL === 'string'
      ? import.meta.env.VITE_SERVER_URL.replace(/\/+$/, '')
      : '';
const LOCAL_CLOUD_API_BASE_URL = 'http://localhost:4000';
const LOOPBACK_CLOUD_API_BASE_URL = 'http://127.0.0.1:4000';
const DEV_PROXY_CLOUD_API_BASE_URL = '';
export const CLOUD_API_BASE_URL = import.meta.env.DEV
  ? DEV_PROXY_CLOUD_API_BASE_URL
  : CONFIGURED_CLOUD_API_BASE_URL || LOCAL_CLOUD_API_BASE_URL;
const DEFAULT_CLOUD_REQUEST_TIMEOUT_MS = 15_000;

function shouldRetryLocalhost(path: string): boolean {
  if (!import.meta.env.DEV) return false;
  if (!path.startsWith('/api/v1/')) return false;
  return true;
}

function getRequestUrl(baseUrl: string, path: string): string {
  return baseUrl ? `${baseUrl}${path}` : path;
}

function getDevFallbackApiBaseUrls(): string[] {
  if (!import.meta.env.DEV) return [];
  const fallback = new Set<string>();
  if (CONFIGURED_CLOUD_API_BASE_URL) {
    fallback.add(CONFIGURED_CLOUD_API_BASE_URL);
  }
  if (typeof window !== 'undefined' && window.location?.hostname) {
    fallback.add(`http://${window.location.hostname}:4000`);
  }
  fallback.add(LOCAL_CLOUD_API_BASE_URL);
  fallback.add(LOOPBACK_CLOUD_API_BASE_URL);
  fallback.delete(CLOUD_API_BASE_URL);
  return Array.from(fallback);
}

async function tryDevFallbackFetch(
  path: string,
  requestInit: RequestInit
): Promise<Response | null> {
  for (const fallbackBaseUrl of getDevFallbackApiBaseUrls()) {
    try {
      return await fetch(getRequestUrl(fallbackBaseUrl, path), requestInit);
    } catch {
      // Try the next fallback endpoint.
    }
  }
  return null;
}

export function getCloudSseUrl(path: string, params?: Record<string, string>) {
  const baseUrl =
    CLOUD_API_BASE_URL ||
    (typeof window !== 'undefined' ? window.location.origin : LOCAL_CLOUD_API_BASE_URL);
  const url = new URL(path, `${baseUrl}/`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value) {
        url.searchParams.set(key, value);
      }
    });
  }
  return url.toString();
}

export async function cloudRequest<T>(path: string, options: CloudRequestOptions = {}): Promise<T> {
  const {
    method = 'GET',
    token,
    body,
    cache = 'no-store',
    headers: customHeaders,
    timeoutMs = DEFAULT_CLOUD_REQUEST_TIMEOUT_MS,
  } = options;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
    ...(customHeaders ?? {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const timeoutController = new AbortController();
  const timeoutId =
    timeoutMs > 0
      ? globalThis.setTimeout(() => {
          timeoutController.abort();
        }, timeoutMs)
      : null;

  try {
    const requestInit: RequestInit = {
      method,
      headers,
      credentials: 'include',
      cache,
      body: body ? JSON.stringify(body) : undefined,
      signal: timeoutController.signal,
    };
    let response: Response | null = null;

    try {
      response = await fetch(getRequestUrl(CLOUD_API_BASE_URL, path), requestInit);
    } catch (error) {
      if (!shouldRetryLocalhost(path)) {
        throw error;
      }
      const fallbackResponse = await tryDevFallbackFetch(path, requestInit);
      response = fallbackResponse;
      if (!response) {
        throw error;
      }
    }

    if (response && shouldRetryLocalhost(path) && response.status >= 500) {
      const fallbackResponse = await tryDevFallbackFetch(path, requestInit);
      if (fallbackResponse) {
        response = fallbackResponse;
      }
    }

    if (!response) {
      throw new Error('Cloud request failed before receiving a response.');
    }

    if (!response.ok) {
      let errorMessage = `Request failed with status ${response.status}`;
      let payload: { error?: string | { formErrors?: string[] } } | null = null;
      const requestId = response.headers.get('X-Request-Id');
      try {
        payload = (await response.json()) as { error?: string | { formErrors?: string[] } };
        if (typeof payload.error === 'string') {
          errorMessage = payload.error;
        } else if (payload.error?.formErrors?.[0]) {
          errorMessage = payload.error.formErrors[0];
        }
      } catch {
        // ignore parse failures
      }
      throw new CloudRequestError(errorMessage, response.status, payload, requestId);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Cloud request timed out.');
    }
    throw error;
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}
