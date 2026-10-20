import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  ApplyChangesBody, ApplyChangesResponse, GetLocationsResponse,
  GetShopifyCollectionProductsResponse, GetShopifyCollectionsQueryParams,
  GetShopifyCollectionsResponse, getShopifyCollectionProductsQueryCollectionIdRegExp,
  getShopifyProductVariantsQueryProductIdRegExp, GetShopifyProductVariantsResponse,
  PreviewOrdersBody, PreviewOrdersResponse, PreviewShopifyProductStockBody,
  PreviewShopifyProductStockResponse, SearchShopifyProductsQueryParams,
  SearchShopifyProductsResponse, type PreviewResponse,
} from "@workspace/api-zod";
import { getAppSession, hasSameOrigin } from "../lib/app-session";
import { ShopifyApiError, assertShopifyPermissions } from "../lib/shopify-client";
import {
  applyStockVariant, buildProductStockPreview, buildStockPreview, discoverLocations,
  parseOrders, readShopifyCollectionProducts, readShopifyCollections, readShopifyProductVariants,
  searchShopifyProducts, stockSummary,
} from "../lib/stock-manager";

const router: IRouter = Router();
interface StoredPreview { data: PreviewResponse; sessionId: string; consumed: boolean }
const previews = new Map<string, StoredPreview>();
const TTL = 10 * 60 * 1000;

function session(req: Request, res: Response, write = false): string | null {
  const current = getAppSession(req);
  if (!current) {
    res.status(401).json({ error: "Your session has expired. Sign in again." });
    return null;
  }
  if (write && !hasSameOrigin(req)) {
    res.status(403).json({ error: "Cross-origin requests are not allowed." });
    return null;
  }
  return current.id;
}

function failure(req: Request, res: Response, error: unknown): void {
  const message = error instanceof ShopifyApiError ? error.message : "The Shopify operation failed safely. Preview again.";
  req.log.warn({ message }, "Inventory operation failed");
  res.status(502).json({ error: message });
}

function savePreview(sessionId: string, action: "sold_out" | "in_stock", result: {
  orders: PreviewResponse["orders"];
  variants: PreviewResponse["variants"];
  blockingIssues: string[];
}): PreviewResponse {
  const now = Date.now();
  for (const [id, stored] of previews) {
    if (stored.data.expiresAt.getTime() <= now || stored.consumed) previews.delete(id);
  }
  while (previews.size >= 100) previews.delete(previews.keys().next().value!);
  const data = PreviewOrdersResponse.parse({
    previewId: randomUUID(), action, ...result,
    summary: stockSummary(result.orders, result.variants),
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + TTL).toISOString(),
  });
  previews.set(data.previewId, { data, sessionId, consumed: false });
  return data;
}

router.get("/shopify/locations", async (req, res): Promise<void> => {
  if (!session(req, res)) return;
  try {
    const locations = await discoverLocations();
    res.json(GetLocationsResponse.parse({ locations: locations.map((location) => ({
      id: location.id, name: location.name, active: location.isActive,
    })) }));
  } catch (error) { failure(req, res, error); }
});

router.get("/shopify/products", async (req, res): Promise<void> => {
  if (!session(req, res)) return;
  const parsed = SearchShopifyProductsQueryParams.safeParse({
    search: typeof req.query.search === "string" ? req.query.search.trim() : "",
    after: req.query.after,
  });
  if (!parsed.success || (req.query.after !== undefined && typeof req.query.after !== "string")) {
    res.status(400).json({ error: "Enter at least 2 characters from a product name." });
    return;
  }
  try {
    const result = await searchShopifyProducts(parsed.data.search.trim(), parsed.data.after ?? null);
    res.json(SearchShopifyProductsResponse.parse(result));
  } catch (error) { failure(req, res, error); }
});

router.get("/shopify/collections", async (req, res): Promise<void> => {
  if (!session(req, res)) return;
  const parsed = GetShopifyCollectionsQueryParams.safeParse({ after: req.query.after });
  if (!parsed.success || (req.query.after !== undefined && typeof req.query.after !== "string")) {
    res.status(400).json({ error: "Reload collections and try again." });
    return;
  }
  try {
    const result = await readShopifyCollections(parsed.data.after ?? null);
    res.json(GetShopifyCollectionsResponse.parse(result));
  } catch (error) { failure(req, res, error); }
});

router.get("/shopify/collection-products", async (req, res): Promise<void> => {
  if (!session(req, res)) return;
  const collectionId = req.query.collectionId;
  const after = req.query.after;
  if (typeof collectionId !== "string" || !getShopifyCollectionProductsQueryCollectionIdRegExp.test(collectionId) ||
      (after !== undefined && (typeof after !== "string" || after.length > 500))) {
    res.status(400).json({ error: "Select a valid Shopify collection and try again." });
    return;
  }
  try {
    const result = await readShopifyCollectionProducts(collectionId, typeof after === "string" ? after : null);
    if (!result) {
      res.status(404).json({ error: "This Shopify collection no longer exists. Reload collections." });
      return;
    }
    res.json(GetShopifyCollectionProductsResponse.parse(result));
  } catch (error) { failure(req, res, error); }
});

router.get("/shopify/product-variants", async (req, res): Promise<void> => {
  if (!session(req, res)) return;
  const productId = req.query.productId;
  if (typeof productId !== "string" || !getShopifyProductVariantsQueryProductIdRegExp.test(productId)) {
    res.status(400).json({ error: "Select a valid Shopify product and try again." });
    return;
  }
  const after = req.query.after;
  if (after !== undefined && (typeof after !== "string" || after.length > 500)) {
    res.status(400).json({ error: "Reload the product sizes and try again." });
    return;
  }
  try {
    const result = await readShopifyProductVariants(productId, typeof after === "string" ? after : null);
    if (!result) {
      res.status(404).json({ error: "This Shopify product no longer exists. Search again." });
      return;
    }
    res.json(GetShopifyProductVariantsResponse.parse(result));
  } catch (error) { failure(req, res, error); }
});

router.post("/shopify/preview", async (req, res): Promise<void> => {
  const sessionId = session(req, res, true);
  if (!sessionId) return;
  const parsed = PreviewOrdersBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter order numbers and choose Sold Out or In Stock." });
    return;
  }
  let orders: ReturnType<typeof parseOrders>;
  try { orders = parseOrders(parsed.data.orders); }
  catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid order numbers." });
    return;
  }
  try {
    const result = await buildStockPreview(orders, parsed.data.action);
    res.json(savePreview(sessionId, parsed.data.action, result));
  } catch (error) { failure(req, res, error); }
});

router.post("/shopify/product-preview", async (req, res): Promise<void> => {
  const sessionId = session(req, res, true);
  if (!sessionId) return;
  const parsed = PreviewShopifyProductStockBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Select between 1 and 25 sizes from one product." });
    return;
  }
  if (new Set(parsed.data.variantIds).size !== parsed.data.variantIds.length) {
    res.status(400).json({ error: "Duplicate sizes were selected. Reload the product and try again." });
    return;
  }
  try {
    const result = await buildProductStockPreview(
      parsed.data.productId, parsed.data.variantIds, parsed.data.action,
    );
    res.json(PreviewShopifyProductStockResponse.parse(
      savePreview(sessionId, parsed.data.action, result),
    ));
  } catch (error) { failure(req, res, error); }
});

router.post("/shopify/apply", async (req, res): Promise<void> => {
  const sessionId = session(req, res, true);
  if (!sessionId) return;
  const parsed = ApplyChangesBody.safeParse(req.body);
  if (!parsed.success || parsed.data.confirmed !== true) {
    res.status(400).json({ error: "Explicit confirmation of a fresh preview is required." });
    return;
  }
  const stored = previews.get(parsed.data.previewId);
  if (!stored || stored.data.expiresAt.getTime() <= Date.now()) {
    previews.delete(parsed.data.previewId);
    res.status(410).json({ error: "Preview expired. Create a fresh preview." });
    return;
  }
  if (stored.sessionId !== sessionId) {
    res.status(404).json({ error: "This preview is not available in your session." });
    return;
  }
  if (stored.consumed) {
    res.status(409).json({ error: "This preview was already applied. Create a fresh preview." });
    return;
  }
  if (stored.data.blockingIssues.length) {
    res.status(409).json({ error: "This preview is blocked by missing Shopify location permission. No inventory or tracking was changed. Configure read_locations and create a fresh preview." });
    return;
  }
  stored.consumed = true;
  try {
    await assertShopifyPermissions();
    // Only Sold Out writes location quantities. In Stock changes tracking only.
    const locations = stored.data.action === "sold_out" ? await discoverLocations() : [];
    const variants = [];
    for (const item of stored.data.variants) {
      const changedLocation = stored.data.action === "sold_out" && item.locations.some((entry) => {
        const current = locations.find((location) => location.id === entry.locationId);
        return !current || current.isActive !== entry.active;
      });
      variants.push(changedLocation
        ? { ...item, updateStatus: "failed" as const, updateMessage: "Location status changed after preview. No update attempted; preview again." }
        : await applyStockVariant(item, stored.data.action, stored.data.previewId));
    }
    res.json(ApplyChangesResponse.parse({
      previewId: stored.data.previewId, action: stored.data.action, variants,
      summary: stockSummary(stored.data.orders, variants),
    }));
  } catch (error) { failure(req, res, error); }
});

export default router;
