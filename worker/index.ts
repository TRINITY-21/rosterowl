/**
 * RosterOwl sync API.
 *
 * The site is a static Astro build served straight from Cloudflare's edge; this
 * Worker exists only for /api/*. Everything else never reaches it, which is why
 * the SEO surface still costs nothing to serve and dist/_headers still governs
 * its security headers.
 *
 * Scope, deliberately: identity and one JSON document per teacher. No roster
 * parsing, no per-entity endpoints, no merge engine. Local storage remains the
 * source of truth in the browser; this is somewhere to put a copy so the same
 * teacher can pick the work up on another machine.
 */
import { handleAuth } from './auth';
import { handleDoc } from './doc';
import type { Env } from './lib';
import { json, securityHeaders } from './lib';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      // Not an API route. In practice static assets are served before the
      // Worker is ever invoked, so this only catches genuinely unknown paths —
      // hand them to the asset router so they get the real 404 page.
      return env.ASSETS.fetch(request);
    }

    try {
      const response =
        (await handleAuth(request, env, ctx, url)) ??
        (await handleDoc(request, env, url)) ??
        json({ error: 'not_found' }, 404);
      return securityHeaders(response);
    } catch (error) {
      // Never leak a stack trace to the client; the teacher gets a plain
      // failure and the detail goes to the Worker log.
      console.error('[rosterowl] unhandled', error);
      return securityHeaders(json({ error: 'server_error' }, 500));
    }
  },
} satisfies ExportedHandler<Env>;
