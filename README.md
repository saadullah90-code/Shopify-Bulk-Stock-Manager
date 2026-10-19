# Shopify Bulk Stock Manager

A private, order-based Shopify inventory tool with an Express backend and a plain HTML/CSS/vanilla JavaScript frontend. There is no application database.

## Setup

### Connected Shopify store

The app uses this project's **Shopify connection** by default. Claim the store through the link Shopify provided, and ensure it is the store you intend to change. Shopify authorization stays on the server through Replit's connector SDK.

Set these in **Replit Secrets**:

- `APP_PASSWORD` — a strong, unique password for this tool.
- `SESSION_SECRET` — a long, random secret used to sign browser sessions.

### Optional: use an existing store directly

To use a Shopify Admin API token instead of the project's connected store, add **both**:

- `SHOPIFY_STORE_DOMAIN` — the plain `your-store.myshopify.com` domain, without `https://` or a path.
- `SHOPIFY_ADMIN_ACCESS_TOKEN` — the store's Admin API access token.

If only one is set, the app reports a setup error. If neither is set, the Replit Shopify connection is used. Do not put real values in `.env.example`, source code, URLs, or chat.

Required permissions are `read_orders`, `read_products`, `read_inventory`, `write_inventory`, and `read_locations`. Older orders can require approved `read_all_orders` access; otherwise Shopify normally limits order access to the recent order window. This implementation does **not** use `write_products`.

The Admin GraphQL API version is pinned to **2026-10** in `artifacts/api-server/src/lib/shopify-client.ts`. Follow version-specific Shopify documentation when upgrading; quantity and activation mutations require an `@idempotent` directive in this version.

## Run

Dependencies are managed with pnpm. Use the existing Replit workflows:

- **API Server:** `pnpm --filter @workspace/api-server run dev`
- **Shopify Bulk Stock Manager web:** `pnpm --filter @workspace/bulk-stock-manager run dev`

The workflows provide the required service ports and frontend base path. The shared proxy routes `/api` to Express and `/` to the web app.

Useful check: `pnpm run typecheck`.

## Safe workflow

1. Sign in with the app password.
2. Paste up to 100 unique numeric order numbers, separated by lines, commas, or spaces. A leading `#` is optional.
3. Choose **Sold Out** or **In Stock**, and verify the explicitly selected Shopify location. In Stock defaults to **10** and accepts a positive whole-number target.
4. Select **Preview inventory changes**. This is read-only.
5. Review every order, grouped variant, current quantity, tracking status, proposed target, warning, and skip reason.
6. Check the authorization box, select **Apply confirmed changes**, and confirm the dialog.
7. Review per-variant results. Success is reported only after Shopify accepts the change and the resulting available quantity is read back.

Sold Out sets available inventory to exactly **0**. In Stock sets the exact chosen positive amount; it overwrites stock and does not restore historical quantities. Tracking is enabled when necessary, and inventory is activated only at the selected location when shown in the preview. Enabling tracking is a variant-level setting.

Other variants and location quantities are not changed. Products with Shopify's **CONTINUE** inventory policy may still be sold at zero stock. Stock remaining at other locations can also keep a product available. The tool warns about these limitations and does not silently change inventory policy, sales channels, or other product information.

Previews are session-bound, expire after 10 minutes, and can be applied only once. Editing inputs invalidates the review. Inventory is re-read before writing and compare-and-set quantities protect against concurrent changes. Transient read requests are retried; writes are not blindly retried.

## Operational limits

Sessions and previews are intentionally held in memory to avoid a database. Use **one API server instance**. Restarting it signs browsers out and invalidates previews. Multi-instance deployment would require shared session/preview storage before it is safe to scale.

No customer names, addresses, phone numbers, or other customer details are requested or stored. The UI contains no Shopify token. API responses are not cached, and cookies are HttpOnly, SameSite Strict, and Secure on HTTPS.

Use a disposable/test order for the first live stock test. See [MANUAL_TEST_CHECKLIST.md](MANUAL_TEST_CHECKLIST.md).
