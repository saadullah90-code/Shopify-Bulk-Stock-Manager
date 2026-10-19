# Shopify Bulk Stock Manager

A private, order-based Shopify stock and tracking tool with an Express backend and a plain HTML/CSS/vanilla JavaScript frontend. There is no application database.

## Setup

### Direct Shopify custom app authentication

This app calls your existing store's Shopify Admin GraphQL API directly from Express using Node.js fetch. It does not use a Replit Shopify connector, OAuth, or a provisioned store.

Set these four values privately in **Replit Secrets**:

- `APP_PASSWORD` — a strong, unique password for this tool.
- `SESSION_SECRET` — a long, random secret used to sign browser sessions.

- `SHOPIFY_STORE_DOMAIN` — the plain `your-store.myshopify.com` domain, without `https://` or a path.
- `SHOPIFY_ADMIN_ACCESS_TOKEN` — the store's Admin API access token.

Both Shopify values are mandatory. Missing or malformed configuration produces a clear error instead of falling back to another store. No Client ID, Client Secret, redirect URL, or connector configuration is needed. Do not put real values in `.env.example`, source code, URLs, or chat. Restart the API workflow after updating Secrets.

Core permissions are `read_orders`, `read_products`, `read_inventory`, and `write_inventory`. A corresponding write scope also satisfies read access. Full automatic location discovery normally needs `read_locations`; Shopify may accept an alternative scope such as `read_markets_home` for some fields. The app validates access with actual location name and active-status queries rather than assuming an ID-only query proves access. Missing permissions and Shopify's exact permission errors are shown safely. Older orders require approved `read_all_orders` access beyond the usual recent 60-day window. If permissions change, follow Shopify's instructions to update/reinstall the custom app and replace the stored token if needed. The app does **not** change inventory policy or require `write_products`.

The Admin GraphQL API version is pinned to **2026-10** in `artifacts/api-server/src/lib/shopify-client.ts`. Follow version-specific Shopify documentation when upgrading; quantity mutations use field-level `@idempotent` keys.

## Run

Dependencies are managed with pnpm. Use the existing Replit workflows:

- **API Server:** `pnpm --filter @workspace/api-server run dev`
- **Shopify Bulk Stock Manager web:** `pnpm --filter @workspace/bulk-stock-manager run dev`

The workflows provide the required service ports and frontend base path. The shared proxy routes `/api` to Express and `/` to the web app.

Useful check: `pnpm run typecheck`.

## Safe workflow

1. Sign in with the app password.
2. Paste up to 100 unique numeric order numbers, separated by lines, commas, or spaces. A leading `#` is optional.
3. Choose **Sold Out** or **In Stock**. No manual location or quantity controls are needed.
4. Select **Preview inventory changes**. This is read-only.
5. Review every order, grouped variant, tracking transition, and each automatically discovered location's quantity, target, active status, warning, and skip reason.
6. Check the authorization box, select **Apply confirmed changes**, and confirm the dialog.
7. Review per-variant and per-location results. Success is reported only after Shopify confirms the mutation and the final tracking/quantity state is read back.

**Sold Out** enables tracking when it is off and sets available inventory to exactly **0** at every active stocked location, including positive or negative quantities. All inventory-level pages are read again afterward, and any nonzero/unknown available quantity at any active stocked location prevents a success result. Unstocked locations are not activated merely to create zeros.

**In Stock** disables tracking with `inventoryItemUpdate`, verifies `tracked: false`, and never calls a quantity mutation. It does not invent or restore previous quantities. Already-disabled tracking is reported as skipped/no change. This tracking-only action does not request location names/status or require `read_locations`; the preview shows actual location IDs and quantities, with location active status explicitly unrequested. Sold Out still requires full location-detail access.

Only exact variants from the entered orders are touched. Inactive locations are listed and skipped because they are not currently sellable; their quantities are not erased. A location changing active status after preview invalidates that variant's operation. Partial failures remain failures and show what was confirmed before the error.

Products with Shopify's **CONTINUE** policy may still be sold at zero. Disabling tracking does not make a draft/archived product active or publish it to a sales channel. The tool warns about these limitations and never changes policy, product status, or channels.

Previews are session-bound, expire after 10 minutes, and can be applied only once. Editing inputs invalidates the review. Inventory is re-read before writing and compare-and-set quantities protect against concurrent changes. Transient read requests are retried; writes are not blindly retried.

## Operational limits

Sessions and previews are intentionally held in memory to avoid a database. Use **one API server instance**. Restarting it signs browsers out and invalidates previews. Multi-instance deployment would require shared session/preview storage before it is safe to scale.

No customer names, addresses, phone numbers, or other customer details are requested or stored. The UI contains no Shopify token. API responses are not cached, and cookies are HttpOnly, SameSite Strict, and Secure on HTTPS.

Use a disposable/test order for the first live stock test. See [MANUAL_TEST_CHECKLIST.md](MANUAL_TEST_CHECKLIST.md).
