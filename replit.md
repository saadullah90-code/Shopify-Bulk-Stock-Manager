# Shopify Bulk Stock Manager

A private order-based tool for previewing and applying exact Shopify inventory quantities.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/bulk-stock-manager run dev` — web frontend (use its managed workflow)
- Required secrets: `APP_PASSWORD`, `SESSION_SECRET`
- Shopify uses the project's connected store by default; optional direct mode requires both `SHOPIFY_STORE_DOMAIN` and `SHOPIFY_ADMIN_ACCESS_TOKEN`.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Frontend: HTML, CSS, vanilla JavaScript, served with Vite
- Storage: no application database; sessions and previews are in memory
- Shopify: server-only Admin GraphQL API, pinned to 2026-10
- Validation: generated Zod schemas
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/bulk-stock-manager/src/main.js` — plain frontend and its interaction states
- `artifacts/bulk-stock-manager/src/index.css` — frontend styling
- `artifacts/api-server/src/routes/` — authentication and inventory endpoints
- `artifacts/api-server/src/lib/shopify-client.ts` — server-only Shopify transport and API version
- `lib/api-spec/openapi.yaml` — API contract
- `README.md` and `MANUAL_TEST_CHECKLIST.md` — setup, safety, and acceptance checks

## Architecture decisions

- Use one API instance because sessions and previews intentionally avoid a database. Restarts invalidate both.
- A preview is read-only, short-lived, session-bound, and one-use. The apply endpoint accepts only its server-owned preview ID, never arbitrary client inventory IDs.
- Enabling tracking is variant-level; quantity changes and activation are limited to the explicitly selected location.
- Shopify's CONTINUE policy and stock at other locations can keep products purchasable even when selected-location inventory is zero. Do not silently alter policy.

## Product

- Parse/deduplicate numeric order numbers, resolve exact Shopify order names, paginate line items, and group duplicate inventory items.
- Preview Sold Out (`0`) or In Stock (positive quantity, default `10`).
- Require explicit confirmation, detect stale inventory, verify updates, and report partial results.

## User preferences

- Follow the supplied PRD: correctness, security, minimal dependencies, no unnecessary database, no unrelated dashboard/account/billing features.
- Never ask for credentials in chat or expose them in browser code, responses, or logs.

## Gotchas

- Re-run API codegen after editing the OpenAPI contract.
- No live inventory test should run without explicit authorization for the test order, location, and target quantities.
- Do not call the app complete until its live preview and both stock actions have been verified.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
