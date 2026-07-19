# mystery-cbn-web

Web frontend for [mystery-cbn](../mystery-cbn), a region-based mystery
color-by-number conversion engine. This app is a fully independent
Next.js/React/TypeScript project — it has no dependency on the engine's
source and talks to it exclusively over its versioned REST API
(`/v1/convert`, `/v1/jobs/{id}`, `/v1/download/{id}`, `/v1/health`).

## Architecture

```
src/
  app/          route composition only (page.tsx assembles components/hooks)
  components/   presentational + interactive UI, no direct API calls
  hooks/        stateful logic: submit/poll a job, theme, history
  lib/api/      the ONLY place that knows the REST contract (types + client)
  lib/jobHistory.ts   localStorage-backed history (the API has no job-listing endpoint)
```

`lib/api` is the sole seam to the backend. If the API changes, only that
directory should need edits.

## Getting started

1. Start the mystery-cbn API (see that repo's `adapters/api`):
   ```bash
   cd ../mystery-cbn
   uvicorn mysterycbn.adapters.api.main:app --port 8000
   ```
2. Configure this app's API base URL:
   ```bash
   cp .env.local.example .env.local
   # edit NEXT_PUBLIC_API_BASE_URL if the API isn't on localhost:8000
   ```
3. Install and run:
   ```bash
   npm install
   npm run dev
   ```
   Open http://localhost:3000.

## Features

- Drag-and-drop or click-to-choose upload with client-side type validation
- Async job submission with live progress polling and cancellation
- Preview with line-art/solved toggle and zoom controls
- Download SVG, PDF, and PNG outputs
- Job history (this browser only, via localStorage)
- Dark mode (manual toggle, persisted, defaults to OS preference)
- Responsive layout, keyboard-navigable, ARIA-labeled controls

## Scripts

- `npm run dev` — dev server (Turbopack)
- `npm run build` — production build
- `npm run start` — serve the production build
- `npm run lint` — ESLint
