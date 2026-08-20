/**
 * Google Sign-In, as a server-side redirect.
 *
 * Deliberately not Google's JavaScript SDK. A redirect keeps the site's
 * Content-Security-Policy at `script-src 'self'` with no third-party origin
 * allowed anywhere — the policy tools/csp/integration.mjs generates is the
 * privacy page in a form the browser enforces, and loosening it to load a
 * sign-in widget would have been a poor trade for a button.
 *
 * There are no passwords here, and so no reset, confirm, or verification flows:
 * Google has already established who the teacher is, and the only thing this
 * file stores is the fact that it happened.
 *
 * The provider is behind one small interface so a second one (Microsoft, for
 * districts on 365) is a new object rather than a new flow.
 */
import type { Env } from './lib';
import {
  OAUTH_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  clearCookie,
  currentUser,
  isSecure,
  json,
  randomToken,
  readCookie,
  sameOrigin,
  setCookie,
  setHintCookie,
  sha256,
  base64url,
} from './lib';

const GOOGLE = {
  id: 'google',
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  /** openid+email only. No Drive, no profile scopes, nothing that needs review. */
  scope: 'openid email',
};

const OAUTH_TTL_MS = 10 * 60 * 1000;

export async function handleAuth(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL
): Promise<Response | null> {
  switch (url.pathname) {
    case '/api/me':
      return me(request, env);
    case '/api/auth/google/start':
      return start(env, url);
    case '/api/auth/google/callback':
      return callback(request, env, ctx, url);
    case '/api/auth/logout':
      return logout(request, env, url);
    default:
      return null;
  }
}

async function me(request: Request, env: Env): Promise<Response> {
  const user = await currentUser(request, env);
  return json(user ? { signedIn: true, email: user.email } : { signedIn: false });
}

/** Step 1: mint PKCE + state, stash them in a short-lived cookie, redirect out. */
async function start(env: Env, url: URL): Promise<Response> {
  const verifier = randomToken(32);
  const state = randomToken(16);
  const challenge = base64url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  );
  // Where to land afterwards. Same-origin paths only — an open redirect here
  // would let someone bounce a teacher off this domain.
  const next = url.searchParams.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/seating-chart/';

  const authorize = new URL(GOOGLE.authorize);
  authorize.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', redirectUri(env, url));
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('scope', GOOGLE.scope);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  // Keeps the account chooser predictable on a shared staffroom machine.
  authorize.searchParams.set('prompt', 'select_account');

  return new Response(null, {
    status: 302,
    headers: {
      location: authorize.toString(),
      'set-cookie': setCookie(OAUTH_COOKIE, JSON.stringify({ verifier, state, next: safeNext }), {
        maxAge: OAUTH_TTL_MS,
        secure: isSecure(url),
      }),
    },
  });
}

/** Step 2: verify state, trade the code for an id_token, open a session. */
async function callback(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL
): Promise<Response> {
  const back = (reason: string) =>
    new Response(null, {
      status: 302,
      headers: {
        location: `/seating-chart/?sync=${reason}`,
        'set-cookie': clearCookie(OAUTH_COOKIE, isSecure(url)),
      },
    });

  const raw = readCookie(request, OAUTH_COOKIE);
  if (!raw) return back('expired');
  let pending: { verifier: string; state: string; next: string };
  try {
    pending = JSON.parse(raw);
  } catch {
    return back('failed');
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  // The teacher can decline on Google's screen; that is not an error.
  if (url.searchParams.get('error')) return back('cancelled');
  if (!code || !state || state !== pending.state) return back('failed');

  const tokenResponse = await fetch(GOOGLE.token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(env, url),
      grant_type: 'authorization_code',
      code_verifier: pending.verifier,
    }),
  });
  if (!tokenResponse.ok) {
    console.error('[rosterowl] token exchange failed', tokenResponse.status);
    return back('failed');
  }

  const body = (await tokenResponse.json()) as { id_token?: string };
  const claims = body.id_token ? decodeIdToken(body.id_token) : null;
  if (!claims?.sub) return back('failed');

  const now = Date.now();
  const userId = await sha256(`${GOOGLE.id}:${claims.sub}`);
  await env.DB.prepare(
    `INSERT INTO users (id, provider, subject, email, created_at, last_seen_at)
          VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (provider, subject)
     DO UPDATE SET email = excluded.email, last_seen_at = excluded.last_seen_at`
  )
    .bind(userId, GOOGLE.id, claims.sub, claims.email ?? null, now, now)
    .run();

  const token = randomToken(32);
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  )
    .bind(await sha256(token), userId, now, now + SESSION_TTL_MS)
    .run();

  // Housekeeping after the response is on its way, so signing in stays fast.
  ctx.waitUntil(env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run());

  const headers = new Headers({ location: pending.next });
  headers.append('set-cookie', clearCookie(OAUTH_COOKIE, isSecure(url)));
  headers.append(
    'set-cookie',
    setCookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL_MS, secure: isSecure(url) })
  );
  headers.append('set-cookie', setHintCookie('1', SESSION_TTL_MS, isSecure(url)));
  return new Response(null, { status: 302, headers });
}

async function logout(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!sameOrigin(request, env)) return json({ error: 'forbidden' }, 403);
  const token = readCookie(request, SESSION_COOKIE);
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  }
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  headers.append('set-cookie', clearCookie(SESSION_COOKIE, isSecure(url)));
  headers.append('set-cookie', setHintCookie('', 0, isSecure(url)));
  return new Response(JSON.stringify({ signedIn: false }), { status: 200, headers });
}

function redirectUri(env: Env, url: URL): string {
  // Origin comes from the live request so `wrangler dev` on localhost works
  // without a second Google client; APP_ORIGIN is the production value that
  // must match the Authorised redirect URI registered in Google Cloud.
  const origin = isSecure(url) ? env.APP_ORIGIN : url.origin;
  return `${origin}/api/auth/google/callback`;
}

/**
 * Reads the claims out of an id_token without verifying its signature.
 *
 * That is safe *here* and nowhere else: this token came back on the response to
 * our own TLS-authenticated POST to Google's token endpoint, using the client
 * secret. There is no untrusted party in between to forge it. OpenID Connect
 * Core §3.1.3.7 makes exactly this allowance for the authorization-code flow
 * with a confidential client, which is why this file carries no JWT library.
 * An id_token arriving from anywhere else would have to be verified properly.
 */
function decodeIdToken(idToken: string): { sub?: string; email?: string } | null {
  const payload = idToken.split('.')[1];
  if (!payload) return null;
  try {
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)));
  } catch {
    return null;
  }
}
