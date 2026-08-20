# RosterOwl

**One roster. Every classroom tool.** — rosterowl.com

Free, client-side classroom tools for teachers. v1 is the seating chart maker:
rebuild your real room, set keep-apart/keep-together rules, shuffle fairly, and
download a one-page PDF. Student names stay in the browser unless the teacher
switches on sync, which is off until they sign in.

## Stack

- [Astro 5](https://astro.build) — static pages (the SEO surface)
- [Svelte 5](https://svelte.dev) (runes) — the interactive tool, rendered `client:only`
- TypeScript strict everywhere; pure logic lives in `src/lib/` with vitest coverage
- [pdf-lib](https://pdf-lib.js.org) + self-hosted Atkinson Hyperlegible — deterministic
  client-side PDF rendering (no print dialog roulette)
- localStorage + downloadable JSON backups — the source of truth, always
- Optional sync: a Cloudflare Worker + D1 behind `/api/*`, Google Sign-In only,
  off unless the teacher signs in (`worker/`, `src/lib/sync.svelte.ts`)
- [pdfjs-dist](https://mozilla.github.io/pdf.js/) — lazily imported, and only to
  render a finished PDF to a PNG for "Copy image"
- A Workbox service worker (`@vite-pwa/astro`) — the whole suite, including PDF
  generation, works with no connection

## Develop

```bash
npm install
npm run dev        # http://localhost:4321
npm test           # vitest — solver, parser, pdf, names, backup
npm run check      # astro check (typecheck)
npm run build      # production build to dist/ (also writes dist/_headers)
npm run verify     # check + test + build
npm run test:ci    # verify + the full Playwright browser suite
node tests/run-browser-ci.mjs   # browser suite alone (boots its own preview server)
```

Asset generation — run these only when the artwork or the tool registry changes,
and commit the output:

```bash
npm run icons      # favicon.ico/svg, apple-touch-icon, PWA icons (needs ImageMagick)
npm run og         # one social card per route, into public/og/
npm run og -- /picker/          # just one
```

`npm run og` reads `OG_ROUTES` in `src/lib/seo.ts`, which is derived from
`src/lib/tools.ts` — so adding a tool there gets it a card and a `<meta>` tag
pointing at that card, with no third list to keep in step.

## Layout

```
src/lib/        pure modules: types, geometry, solver, smartPaste, csv, names,
                backup, pdf, pdfFonts + appState.svelte.ts (rune store)
src/components/ Svelte UI: SeatingApp shell, RoomCanvas, RosterPanel,
                PasteModal, PdfDialog, Modal, Toasts, OwlMark
src/pages/      index (brand portal), seating-chart/ (the tool + SEO content),
                privacy (the "what this site sends" contract), about, contact,
                terms
src/layouts/    Layout (head, header, service-worker prompt), TextPage (the
                shared reading treatment for the four prose pages)
public/fonts/   self-hosted OFL fonts (Atkinson Hyperlegible, Baloo 2)
public/og/      generated social cards, one per route
tools/          build-time asset and header generation (icons, og, csp)
tests/          vitest suites + Playwright smoke drives
```

## Security headers

`tools/csp/integration.mjs` writes `dist/_headers` on every build, hashing the
inline scripts and styles the build actually emitted (19 pages produce ~40 of
them, so a hand-maintained list would be wrong within a week).

The Content-Security-Policy is the privacy page expressed in a form the browser
enforces: `connect-src` allows this origin and the analytics endpoint, nothing
else. Code that tried to post a roster somewhere would be blocked by the browser
rather than by our good intentions.

`astro preview` does not apply `_headers`, so a broken policy is invisible
locally — `tests/smoke-csp.mjs` serves `dist/` under the generated headers and
fails on any violation.

## Deploy (Cloudflare Workers)

The site is still a static build; the Worker exists only for `/api/*`, so static
assets are served straight from the edge and the SEO surface costs no Worker
invocations. (Cloudflare's own guidance for a Pages project that grows server
routes and a D1 binding is to move to Workers with static assets.)

```bash
npx wrangler d1 create rosterowl      # copy the id into wrangler.jsonc
npm run db:migrate                    # apply worker/migrations to the remote db
npx wrangler secret put GOOGLE_CLIENT_SECRET
npm run deploy                        # astro build + wrangler deploy
```

1. Add the custom domain rosterowl.com to the Worker.
2. Day-one SEO: verify the domain in **Bing Webmaster Tools** (enable IndexNow)
   and **Google Search Console**; submit `https://rosterowl.com/sitemap-index.xml`.
3. Analytics: `PUBLIC_CF_BEACON_TOKEN` is set inline on the `deploy` script,
   so only real deploys carry the beacon. `npm run build`, `npm run preview`
   and the browser CI all build without it and stay out of the dashboard. The
   token is a public site token — it ships in the HTML of every page — so it
   lives in `package.json` rather than in a secret. `/privacy` describes the
   beacon as running, so it must stay set for production.
4. Google Analytics: `PUBLIC_GA_ID` is set the same way, and the tag is gated
   behind consent — `Layout.astro` injects gtag.js only after the visitor
   accepts, so declining means zero requests to Google rather than the usual
   consent-mode arrangement where the tag loads anyway. Builds without the id
   emit no consent bar at all.

## Google Sign-In setup

Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web):

- Authorised redirect URI: `https://rosterowl.com/api/auth/google/callback`
  (and `http://localhost:8787/api/auth/google/callback` for `wrangler dev`)
- Scopes: `openid email` only — non-sensitive, so no verification review
- Put the client id in `wrangler.jsonc` under `vars.GOOGLE_CLIENT_ID`; the
  secret goes in `wrangler secret put GOOGLE_CLIENT_SECRET`, never in the repo.
  For local dev put it in `.dev.vars` (gitignored).

## Product rules (do not break)

- **Privacy:** student tags, zone preferences, absences, and rules never appear
  on any printed or exported chart. Names only, and sync uploads only what the
  document already holds. `/privacy` is the contract — never add a network
  request that contradicts it, and update that page in the same deploy.
- **Sync is opt-in.** Signed out must remain a first-class, fully working state:
  no prompts, no walls, no nagging. `src/lib/sync.svelte.ts` makes *no* network
  request at all unless the `ro_signed_in` hint cookie is present, so a teacher
  who never signs in is never talked to by the API.
- **The CSP must fit.** Cloudflare drops any `_headers` line over 2,000
  characters, silently. `tools/csp/integration.mjs` fails the build instead —
  do not raise that limit to make a build pass.
- **Free:** no student caps, no watermarks, no signup walls. Ever.
- **Scope filter:** a new feature ships only if the stored roster makes it
  better than the generic version that already exists elsewhere.
