// Thin fetch wrapper around the NestJS API. No React Query / SWR / Axios —
// this is a demo frontend, kept deliberately dependency-light. Session is
// stored in localStorage (fine for a demo; a real product would want
// httpOnly cookies instead).

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/v1";

export interface Session {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; phone_number: string; roles: string[]; kyc_tier: string };
}

const SESSION_KEY = "rental_platform_session";

export function saveSession(session: Session) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadSession(): Session | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function clearSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SESSION_KEY);
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  formData?: FormData;
  headers?: Record<string, string>;
  auth?: boolean; // defaults to true
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, formData, headers = {}, auth = true } = options;
  const finalHeaders: Record<string, string> = { ...headers };

  if (auth) {
    const session = loadSession();
    if (session) finalHeaders.Authorization = `Bearer ${session.access_token}`;
  }

  let requestBody: BodyInit | undefined;
  if (formData) {
    requestBody = formData; // browser sets the multipart Content-Type boundary itself
  } else if (body !== undefined) {
    finalHeaders["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE}${path}`, { method, headers: finalHeaders, body: requestBody });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const code = data?.error?.code ?? "UNKNOWN_ERROR";
    const message = data?.error?.message ?? res.statusText;
    throw new ApiError(code, message, res.status);
  }

  return data as T;
}
