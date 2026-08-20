# RosterOwl

**One roster. Every classroom tool.** — rosterowl.com

Free, client-side classroom tools for teachers. v1 is the seating chart maker:
rebuild your real room, set keep-apart/keep-together rules, shuffle fairly, and
download a one-page PDF. Student names never leave the browser — there is no
backend at all.

## Stack

- [Astro 5](https://astro.build) — static pages (the SEO surface)
- [Svelte 5](https://svelte.dev) (runes) — the interactive tool, rendered `client:only`
- TypeScript strict everywhere; pure logic lives in `src/lib/` with vitest coverage
- [pdf-lib](https://pdf-lib.js.org) + self-hosted Atkinson Hyperlegible — deterministic
  client-side PDF rendering (no print dialog roulette)
- localStorage + downloadable JSON backups — no accounts, no servers, no cookies

## Develop

```bash
npm install
npm run dev        # http://localhost:4321
npm test           # vitest — solver, parser, pdf, names, backup
npm run check      # astro check (typecheck)
npm run build      # production build to dist/
node tests/smoke.mjs [outDir]   # Playwright browser smoke drive (needs `npm run dev` running)
```

## Layout

```
src/lib/        pure modules: types, geometry, solver, smartPaste, csv, names,
                backup, pdf, pdfFonts + appState.svelte.ts (rune store)
src/components/ Svelte UI: SeatingApp shell, RoomCanvas, RosterPanel,
                PasteModal, PdfDialog, Modal, Toasts, OwlMark
src/pages/      index (brand portal), seating-chart/ (the tool + SEO content),
                privacy (the "what this site sends" contract)
public/fonts/   self-hosted OFL fonts (Atkinson Hyperlegible, Baloo 2)
tests/          vitest suites + smoke.mjs browser drive
```

## Deploy (Cloudflare Pages)

Static output — any static host works. For Cloudflare Pages:

1. Push this repo to GitHub, then Cloudflare dashboard → Workers & Pages →
   Create → Pages → connect the repo.
2. Build command `npm run build`, output directory `dist`.
3. Add the custom domain rosterowl.com.
4. Day-one SEO: verify the domain in **Bing Webmaster Tools** (enable IndexNow)
   and **Google Search Console**; submit `https://rosterowl.com/sitemap-index.xml`.
5. If you enable Cloudflare Web Analytics, update `/privacy` in the SAME deploy —
   that page promises the beacon will be disclosed there first.

## Product rules (do not break)

- **Privacy:** student tags, zone preferences, absences, and rules never appear
  on any printed or exported chart. Names only. `/privacy` is the contract —
  never add a network request that contradicts it.
- **Free:** no student caps, no watermarks, no signup walls. Ever.
- **Scope filter:** a new feature ships only if the stored roster makes it
  better than the generic version that already exists elsewhere.
