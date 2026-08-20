/** Shared plumbing for the sync API: env shape, cookies, sessions, responses. */

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** e.g. https://rosterowl.com — used to build the OAuth redirect and to check Origin. */
  APP_ORIGIN: string;
}

export const SESSION_COOKIE = 'ro_session';
/**
 * A readable companion to the session cookie, holding no secret and granting
 * nothing. The session cookie is HttpOnly, so the page cannot tell whether one
 * exists — without this hint every visitor would have to ask /api/me, and a
 * signed-out teacher would make a network request purely to be told "no". This
 * lets the client skip that entirely, which is what the privacy page claims.
 */
export const HINT_COOKIE = 'ro_signed_in';
export const OAUTH_COOKIE = 'ro_oauth';
/** Long enough that a teacher is not signed out between terms. */
export const SESSION_TTL_MS = 400 * 24 * 60 * 60 * 1000;
/** A roster document is tens of kilobytes; this is a wide abuse ceiling. */
export const MAX_DOC_BYTES = 1_000_000;

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

/** API responses are private and must never be cached by anything. */
export function securityHeaders(response: Response): Response {
  const h = new Headers(response.headers);
  h.set('cache-control', 'no-store');
  h.set('x-content-type-options', 'nosniff');
  h.set('referrer-policy', 'no-referrer');
  return new Response(response.body, { status: response.status, headers: h });
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export function setCookie(
  name: string,
  value: string,
  opts: { maxAge: number; secure: boolean }
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    // Lax, not Strict: the teacher returns from accounts.google.com by
    // top-level navigation, and Strict would withhold the cookie on that hop.
    'SameSite=Lax',
    `Max-Age=${Math.floor(opts.maxAge / 1000)}`,
  ];
  // Omitted on http://localhost so `wrangler dev` can hold a session.
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(name: string, secure: boolean): string {
  const parts = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** The hint cookie, deliberately without HttpOnly so the page can read it. */
export function setHintCookie(value: '1' | '', maxAge: number, secure: boolean): string {
  const parts = [`${HINT_COOKIE}=${value}`, 'Path=/', 'SameSite=Lax', `Max-Age=${Math.floor(maxAge / 1000)}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export const isSecure = (url: URL) => url.protocol === 'https:';

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64url(buf);
}

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return base64url(new Uint8Array(digest));
}

export interface SessionUser {
  id: string;
  email: string | null;
}

/** Resolves the signed-in user, or null. Expired rows are treated as absent. */
export async function currentUser(request: Request, env: Env): Promise<SessionUser | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id AS id, u.email AS email, s.expires_at AS expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`
  )
    .bind(await sha256(token))
    .first<{ id: string; email: string | null; expires_at: number }>();
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, email: row.email };
}

/**
 * Rejects cross-site state-changing requests.
 *
 * The session cookie is SameSite=Lax, which already blocks cross-site POSTs,
 * but Lax permits top-level GET navigations — so this is the second lock, and
 * it is the one that does not depend on the browser implementing Lax correctly.
 */
export function sameOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  if (origin === env.APP_ORIGIN) return true;
  // `wrangler dev` serves the app from localhost on an arbitrary port.
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}
