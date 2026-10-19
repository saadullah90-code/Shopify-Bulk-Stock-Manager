import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  ApplyChangesBody,
  ApplyChangesResponse,
  GetLocationsResponse,
  PreviewOrdersBody,
  PreviewOrdersResponse,
} from "@workspace/api-zod";
import { getAppSession, hasSameOrigin } from "../lib/app-session";
import {
  ShopifyApiError,
  shopifyGraphql,
  shopifyMutation,
  shopifyUserErrors,
} from "../lib/shopify-client";

const router: IRouter = Router();
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_LIVE_PREVIEWS = 100;
const previews = new Map<string, StoredPreview>();

type Action = "sold_out" | "in_stock";
type UpdateStatus = "pending" | "success" | "failed" | "skipped";

interface Location {
  id: string;
  name: string;
  active: boolean;
}

interface OrderResult {
  entered: string;
  status: "found" | "not_found" | "ambiguous" | "inaccessible";
  orderName: string | null;
  reason: string | null;
}

interface VariantResult {
  inventoryItemId: string;
  productTitle: string;
  variantTitle: string;
  orderNumbers: string[];
  currentQuantity: number | null;
  tracked: boolean;
  inventoryPolicy: "DENY" | "CONTINUE" | null;
  targetQuantity: number | null;
  eligible: boolean;
  skipReason: string | null;
  requiresActivation: boolean;
  trackingWillBeEnabled: boolean;
  warning: string | null;
  updateStatus: UpdateStatus;
  updateMessage: string | null;
}

interface StoredPreview {
  previewId: string;
  sessionId: string;
  action: Action;
  locationId: string;
  locationName: string;
  orders: OrderResult[];
  variants: VariantResult[];
  createdAt: string;
  expiresAt: string;
  consumed: boolean;
}

interface OrderSearchData {
  orders: {
    edges: Array<{ cursor: string; node: { id: string; name: string } }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

interface OrderLinesData {
  order: {
    id: string;
    name: string;
    lineItems: {
      edges: Array<{
        cursor: string;
        node: {
          id: string;
          title: string;
          variant: {
            id: string;
            title: string;
            inventoryPolicy: "DENY" | "CONTINUE";
            product: { title: string } | null;
            inventoryItem: {
              id: string;
              tracked: boolean | null;
              inventoryLevels: {
                edges: Array<{
                  node: {
                    location: { id: string; name: string; isActive: boolean };
                    quantities: Array<{ name: string; quantity: number }>;
                  };
                }>;
              };
            } | null;
          } | null;
        };
      }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  } | null;
}

interface LocationsData {
  locations: {
    edges: Array<{ cursor: string; node: { id: string; name: string; isActive: boolean } }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

interface InventoryItemData {
  inventoryItem: {
    id: string;
    tracked: boolean | null;
    inventoryLevels: {
      edges: Array<{
        node: {
          quantities: Array<{ name: string; quantity: number }>;
        };
      }>;
    };
  } | null;
}

interface InventoryItemUpdateData {
  inventoryItemUpdate: {
    inventoryItem: { id: string; tracked: boolean } | null;
    userErrors: Array<{ field?: string[] | null; message: string }>;
  };
}

interface InventoryActivateData {
  inventoryActivate: {
    inventoryLevel: {
      quantities: Array<{ name: string; quantity: number }>;
    } | null;
    userErrors: Array<{ field?: string[] | null; message: string }>;
  };
}

interface InventorySetData {
  inventorySetQuantities: {
    inventoryAdjustmentGroup: { id: string } | null;
    userErrors: Array<{ field?: string[] | null; message: string }>;
  };
}

interface GroupedVariant {
  inventoryItemId: string;
  productTitle: string;
  variantTitle: string;
  orderNumbers: Set<string>;
  currentQuantity: number | null;
  tracked: boolean;
  inventoryPolicy: "DENY" | "CONTINUE" | null;
  eligible: boolean;
  skipReason: string | null;
  requiresActivation: boolean;
}

const LOCATIONS_QUERY = `
  query Locations($after: String) {
    locations(first: 250, after: $after) {
      edges {
        cursor
        node { id name isActive }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const ORDER_SEARCH_QUERY = `
  query SearchOrders($after: String, $query: String!) {
    orders(first: 250, after: $after, query: $query) {
      edges { cursor node { id name } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const ORDER_LINES_QUERY = `
  query OrderLines($id: ID!, $after: String, $locationId: ID!) {
    order(id: $id) {
      id
      name
      lineItems(first: 250, after: $after) {
        edges {
          cursor
          node {
            id
            title
            variant {
              id
              title
              inventoryPolicy
              product { title }
              inventoryItem {
                id
                tracked
                inventoryLevels(first: 1, locationIds: [$locationId]) {
                  edges {
                    node {
                      location { id name isActive }
                      quantities(names: ["available"]) { name quantity }
                    }
                  }
                }
              }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const INVENTORY_ITEM_QUERY = `
  query InventoryItemAtLocation($id: ID!, $locationId: ID!) {
    inventoryItem(id: $id) {
      id
      tracked
      inventoryLevels(first: 1, locationIds: [$locationId]) {
        edges {
          node { quantities(names: ["available"]) { name quantity } }
        }
      }
    }
  }
`;

function setError(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function requireSession(req: Request, res: Response): string | null {
  const session = getAppSession(req);
  if (!session) {
    setError(res, 401, "Your session has expired. Sign in again.");
    return null;
  }
  return session.id;
}

function requireSameOrigin(req: Request, res: Response): boolean {
  if (hasSameOrigin(req)) return true;
  setError(res, 403, "Cross-origin requests are not allowed.");
  return false;
}

function handleShopifyError(req: Request, res: Response, error: unknown): void {
  if (error instanceof ShopifyApiError) {
    req.log.warn({ message: error.message }, "Shopify request failed");
    setError(res, 502, error.message);
    return;
  }
  req.log.error({ err: error }, "Unexpected inventory operation failure");
  setError(res, 502, "The Shopify request failed. Try again shortly.");
}

async function fetchLocations(): Promise<Location[]> {
  const results: Location[] = [];
  let after: string | null = null;
  do {
    const data = await shopifyGraphql<LocationsData>(LOCATIONS_QUERY, { after });
    for (const edge of data.locations.edges) {
      if (edge.node.isActive) {
        results.push({
          id: edge.node.id,
          name: edge.node.name,
          active: edge.node.isActive,
        });
      }
    }
    after = data.locations.pageInfo.hasNextPage
      ? data.locations.pageInfo.endCursor
      : null;
  } while (after);
  return results;
}

function parseOrders(raw: string): Array<{ entered: string; number: string }> {
  const tokens = raw
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const deduped = new Map<string, { entered: string; number: string }>();

  for (const entered of tokens) {
    const number = entered.replace(/^#/, "");
    if (!/^\d{1,20}$/.test(number)) {
      throw new Error(`"${entered}" is not a valid numeric Shopify order number.`);
    }
    if (!deduped.has(number)) deduped.set(number, { entered, number });
  }

  if (deduped.size === 0) throw new Error("Enter at least one order number.");
  if (deduped.size > 100) {
    throw new Error("Preview at most 100 unique order numbers at a time.");
  }
  return [...deduped.values()];
}

async function findExactOrder(number: string): Promise<
  | { status: "found"; id: string; name: string }
  | { status: "not_found" }
  | { status: "ambiguous" }
> {
  let after: string | null = null;
  const exact: Array<{ id: string; name: string }> = [];
  let pages = 0;
  do {
    const data = await shopifyGraphql<OrderSearchData>(ORDER_SEARCH_QUERY, {
      after,
      query: `name:#${number}`,
    });
    for (const { node } of data.orders.edges) {
      if (node.name.replace(/^#/, "") === number) {
        exact.push(node);
        if (exact.length > 1) return { status: "ambiguous" };
      }
    }
    after = data.orders.pageInfo.hasNextPage
      ? data.orders.pageInfo.endCursor
      : null;
    pages += 1;
    if (pages > 100) {
      throw new ShopifyApiError(
        "Shopify returned too many order search pages to safely verify an exact match.",
      );
    }
  } while (after);

  if (exact.length === 0) return { status: "not_found" };
  return { status: "found", ...exact[0] };
}

function getAvailableQuantity(
  levels:
    | {
        edges: Array<{
          node: { quantities: Array<{ name: string; quantity: number }> };
        }>;
      }
    | null
    | undefined,
): number | null {
  const available = levels?.edges[0]?.node.quantities.find(
    (quantity) => quantity.name === "available",
  );
  return typeof available?.quantity === "number" ? available.quantity : null;
}

async function addOrderLines(
  order: { id: string; name: string },
  entered: string,
  locationId: string,
  grouped: Map<string, GroupedVariant>,
): Promise<boolean> {
  let after: string | null = null;
  let pageCount = 0;

  do {
    const data = await shopifyGraphql<OrderLinesData>(ORDER_LINES_QUERY, {
      id: order.id,
      after,
      locationId,
    });
    if (!data.order) return false;

    for (const edge of data.order.lineItems.edges) {
      const line = edge.node;
      const variant = line.variant;
      const inventoryItem = variant?.inventoryItem;
      const itemId = inventoryItem?.id ?? `unavailable:${order.id}:${line.id}`;
      const existing = grouped.get(itemId);
      if (existing) {
        existing.orderNumbers.add(entered);
        continue;
      }

      const level = inventoryItem?.inventoryLevels.edges[0]?.node;
      grouped.set(itemId, {
        inventoryItemId: itemId,
        productTitle: variant?.product?.title ?? line.title ?? "Deleted product",
        variantTitle: variant?.title ?? line.title ?? "Unavailable variant",
        orderNumbers: new Set([entered]),
        currentQuantity: getAvailableQuantity(inventoryItem?.inventoryLevels),
        tracked: inventoryItem?.tracked === true,
        inventoryPolicy: variant?.inventoryPolicy ?? null,
        eligible: Boolean(inventoryItem?.id),
        skipReason: inventoryItem?.id
          ? null
          : "The product variant or inventory item was deleted or could not be resolved.",
        requiresActivation: Boolean(inventoryItem?.id && !level),
      });
    }

    after = data.order.lineItems.pageInfo.hasNextPage
      ? data.order.lineItems.pageInfo.endCursor
      : null;
    pageCount += 1;
    if (pageCount > 100) {
      throw new ShopifyApiError(
        "Shopify returned too many line-item pages to safely preview this order.",
      );
    }
  } while (after);

  return true;
}

function toVariantResult(
  item: GroupedVariant,
  action: Action,
  quantity: number,
): VariantResult {
  const warning = [
    item.inventoryPolicy === "CONTINUE"
      ? "This variant is set to continue selling when out of stock; zero inventory may not block new sales."
      : null,
    item.requiresActivation
      ? "Applying will activate inventory for this variant at the selected location."
      : null,
    !item.tracked && item.eligible
      ? "Inventory tracking is currently off and will be enabled for this variant."
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    inventoryItemId: item.inventoryItemId,
    productTitle: item.productTitle,
    variantTitle: item.variantTitle,
    orderNumbers: [...item.orderNumbers],
    currentQuantity: item.currentQuantity,
    tracked: item.tracked,
    inventoryPolicy: item.inventoryPolicy,
    targetQuantity: item.eligible ? (action === "sold_out" ? 0 : quantity) : null,
    eligible: item.eligible,
    skipReason: item.skipReason,
    requiresActivation: item.requiresActivation,
    trackingWillBeEnabled: item.eligible && !item.tracked,
    warning: warning || null,
    updateStatus: item.eligible ? "pending" : "skipped",
    updateMessage: item.eligible ? null : item.skipReason,
  };
}

function makeSummary(
  inputOrders: number,
  validOrders: number,
  variants: VariantResult[],
) {
  return {
    inputOrders,
    validOrders,
    variantsFound: variants.length,
    successfulUpdates: variants.filter((item) => item.updateStatus === "success")
      .length,
    failedUpdates: variants.filter((item) => item.updateStatus === "failed")
      .length,
    skippedItems: variants.filter((item) => item.updateStatus === "skipped")
      .length,
  };
}

function cleanOldPreviews(): void {
  const now = Date.now();
  for (const [id, preview] of previews) {
    if (Date.parse(preview.expiresAt) <= now || preview.consumed) {
      previews.delete(id);
    }
  }
  while (previews.size >= MAX_LIVE_PREVIEWS) {
    const oldest = previews.keys().next().value;
    if (!oldest) break;
    previews.delete(oldest);
  }
}

router.get("/shopify/locations", async (req, res): Promise<void> => {
  if (!requireSession(req, res)) return;
  try {
    const locations = await fetchLocations();
    res.json(GetLocationsResponse.parse({ locations }));
  } catch (error) {
    handleShopifyError(req, res, error);
  }
});

router.post("/shopify/preview", async (req, res): Promise<void> => {
  const sessionId = requireSession(req, res);
  if (!sessionId) return;
  if (!requireSameOrigin(req, res)) return;

  const parsed = PreviewOrdersBody.safeParse(req.body);
  if (!parsed.success) {
    setError(res, 400, "Check the order numbers, action, quantity, and location.");
    return;
  }
  let enteredOrders: Array<{ entered: string; number: string }>;
  try {
    enteredOrders = parseOrders(parsed.data.orders);
  } catch (error) {
    setError(res, 400, error instanceof Error ? error.message : "Invalid orders.");
    return;
  }

  const action = parsed.data.action as Action;
  const quantity = action === "sold_out" ? 0 : (parsed.data.quantity ?? 10);
  if (action === "in_stock" && (!Number.isSafeInteger(quantity) || quantity <= 0)) {
    setError(res, 400, "The in-stock quantity must be a positive whole number.");
    return;
  }

  try {
    const locations = await fetchLocations();
    const location = locations.find((candidate) => candidate.id === parsed.data.locationId);
    if (!location) {
      setError(res, 400, "Choose an active Shopify inventory location.");
      return;
    }

    const orders: OrderResult[] = [];
    const grouped = new Map<string, GroupedVariant>();

    for (const enteredOrder of enteredOrders) {
      const found = await findExactOrder(enteredOrder.number);
      if (found.status !== "found") {
        orders.push({
          entered: enteredOrder.entered,
          status: found.status,
          orderName: null,
          reason:
            found.status === "ambiguous"
              ? "More than one exact Shopify order match was returned; no variant from this order will be changed."
              : "No exact order-number match was found. It may be inaccessible or outside the connected account's permissions.",
        });
        continue;
      }

      const resolved = await addOrderLines(
        found,
        enteredOrder.entered,
        location.id,
        grouped,
      );
      orders.push({
        entered: enteredOrder.entered,
        status: resolved ? "found" : "inaccessible",
        orderName: resolved ? found.name : null,
        reason: resolved
          ? null
          : "The order was found, but its line items could not be read. Check read_orders and read_products permissions.",
      });
    }

    const variants = [...grouped.values()].map((item) =>
      toVariantResult(item, action, quantity),
    );
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS).toISOString();
    const previewId = randomUUID();
    const preview: StoredPreview = {
      previewId,
      sessionId,
      action,
      locationId: location.id,
      locationName: location.name,
      orders,
      variants,
      createdAt,
      expiresAt,
      consumed: false,
    };

    cleanOldPreviews();
    previews.set(previewId, preview);
    res.json(
      PreviewOrdersResponse.parse({
        previewId,
        action,
        locationId: location.id,
        locationName: location.name,
        orders,
        variants,
        summary: makeSummary(
          enteredOrders.length,
          orders.filter((order) => order.status === "found").length,
          variants,
        ),
        createdAt,
        expiresAt,
      }),
    );
  } catch (error) {
    handleShopifyError(req, res, error);
  }
});

async function readInventoryItem(
  inventoryItemId: string,
  locationId: string,
): Promise<InventoryItemData["inventoryItem"]> {
  const data = await shopifyGraphql<InventoryItemData>(INVENTORY_ITEM_QUERY, {
    id: inventoryItemId,
    locationId,
  });
  return data.inventoryItem;
}

async function updateVariant(
  item: VariantResult,
  locationId: string,
  previewId: string,
): Promise<VariantResult> {
  if (!item.eligible || item.targetQuantity === null) {
    return {
      ...item,
      updateStatus: "skipped",
      updateMessage: item.skipReason ?? "This variant cannot be updated.",
    };
  }

  try {
    const initial = await readInventoryItem(item.inventoryItemId, locationId);
    if (!initial) {
      return {
        ...item,
        updateStatus: "failed",
        updateMessage: "The inventory item no longer exists; preview the order again.",
      };
    }
    const initialQuantity = getAvailableQuantity(initial.inventoryLevels);
    if (
      (initial.tracked === true) !== item.tracked ||
      initialQuantity !== item.currentQuantity
    ) {
      return {
        ...item,
        updateStatus: "failed",
        updateMessage:
          "Inventory changed after preview. No change was applied; create a fresh preview.",
      };
    }

    if (initial.tracked !== true) {
      const trackingData = await shopifyGraphql<InventoryItemUpdateData>(
        `
          mutation EnableInventoryTracking($id: ID!, $input: InventoryItemInput!) {
            inventoryItemUpdate(id: $id, input: $input) {
              inventoryItem { id tracked }
              userErrors { field message }
            }
          }
        `,
        {
          id: item.inventoryItemId,
          input: { tracked: true },
        },
        { readOnly: false },
      );
      const trackingError = shopifyUserErrors(
        trackingData.inventoryItemUpdate.userErrors,
      );
      if (trackingError || !trackingData.inventoryItemUpdate.inventoryItem?.tracked) {
        return {
          ...item,
          updateStatus: "failed",
          updateMessage: trackingError ?? "Shopify did not enable inventory tracking.",
        };
      }
    }

    const current = await readInventoryItem(item.inventoryItemId, locationId);
    if (!current) {
      return {
        ...item,
        updateStatus: "failed",
        updateMessage: "The inventory item disappeared before its quantity was set.",
      };
    }

    const activeQuantity = getAvailableQuantity(current.inventoryLevels);
    if (!current.inventoryLevels.edges.length) {
      const activationData = await shopifyMutation<InventoryActivateData>(
        (key) => `
          mutation ActivateInventory($inventoryItemId: ID!, $locationId: ID!, $available: Int)
            @idempotent(key: "${key}") {
            inventoryActivate(
              inventoryItemId: $inventoryItemId,
              locationId: $locationId,
              available: $available
            ) {
              inventoryLevel { quantities(names: ["available"]) { name quantity } }
              userErrors { field message }
            }
          }
        `,
        {
          inventoryItemId: item.inventoryItemId,
          locationId,
          available: item.targetQuantity,
        },
      );
      const activation = activationData.inventoryActivate;
      const activationError = shopifyUserErrors(activation.userErrors);
      if (activationError || !activation.inventoryLevel) {
        return {
          ...item,
          updateStatus: "failed",
          updateMessage: activationError ?? "Shopify did not activate inventory at the selected location.",
        };
      }
    } else {
      if (activeQuantity === null) {
        return {
          ...item,
          updateStatus: "failed",
          updateMessage:
            "Shopify did not return the current available quantity. No update was attempted.",
        };
      }
      const input = {
        name: "available",
        reason: "correction",
        referenceDocumentUri: `logistics://bulk-stock-manager/${previewId}/${randomUUID()}`,
        quantities: [
          {
            inventoryItemId: item.inventoryItemId,
            locationId,
            quantity: item.targetQuantity,
            compareQuantity: activeQuantity,
          },
        ],
      };
      const setData = await shopifyMutation<InventorySetData>(
        (key) => `
          mutation SetAvailableQuantity($input: InventorySetQuantitiesInput!)
            @idempotent(key: "${key}") {
            inventorySetQuantities(input: $input) {
              inventoryAdjustmentGroup { id }
              userErrors { field message }
            }
          }
        `,
        { input },
      );
      const setResult = setData.inventorySetQuantities;
      const setError = shopifyUserErrors(setResult.userErrors);
      if (setError || !setResult.inventoryAdjustmentGroup) {
        return {
          ...item,
          updateStatus: "failed",
          updateMessage: setError ?? "Shopify did not confirm the inventory adjustment.",
        };
      }
    }

    const verified = await readInventoryItem(item.inventoryItemId, locationId);
    const resultingQuantity = getAvailableQuantity(verified?.inventoryLevels);
    if (resultingQuantity !== item.targetQuantity) {
      return {
        ...item,
        updateStatus: "failed",
        updateMessage: `Shopify did not confirm the target quantity of ${item.targetQuantity}. Current quantity: ${resultingQuantity ?? "unknown"}.`,
      };
    }
    return {
      ...item,
      tracked: true,
      currentQuantity: resultingQuantity,
      requiresActivation: false,
      trackingWillBeEnabled: false,
      updateStatus: "success",
      updateMessage: `Verified at ${resultingQuantity} available.`,
    };
  } catch (error) {
    return {
      ...item,
      updateStatus: "failed",
      updateMessage:
        error instanceof ShopifyApiError
          ? error.message
          : "The Shopify update failed. Preview again before retrying.",
    };
  }
}

router.post("/shopify/apply", async (req, res): Promise<void> => {
  const sessionId = requireSession(req, res);
  if (!sessionId) return;
  if (!requireSameOrigin(req, res)) return;

  const parsed = ApplyChangesBody.safeParse(req.body);
  if (!parsed.success || parsed.data.confirmed !== true) {
    setError(res, 400, "Explicitly confirm the inventory changes before applying.");
    return;
  }

  const preview = previews.get(parsed.data.previewId);
  if (!preview || Date.parse(preview.expiresAt) <= Date.now()) {
    previews.delete(parsed.data.previewId);
    setError(res, 410, "This preview expired. Create a new preview before applying.");
    return;
  }
  if (preview.sessionId !== sessionId) {
    setError(res, 404, "This preview is not available in the current session.");
    return;
  }
  if (preview.consumed) {
    setError(res, 409, "This preview has already been applied. Create a new preview.");
    return;
  }

  try {
    const locations = await fetchLocations();
    if (!locations.some((location) => location.id === preview.locationId)) {
      setError(
        res,
        409,
        "The selected location is no longer active. Create a new preview and select an active location.",
      );
      return;
    }

    preview.consumed = true;
    const variants: VariantResult[] = [];
    for (const item of preview.variants) {
      if (!item.eligible) {
        variants.push({
          ...item,
          updateStatus: "skipped",
          updateMessage: item.skipReason,
        });
      } else {
        variants.push(
          await updateVariant(item, preview.locationId, preview.previewId),
        );
      }
    }

    const response = {
      previewId: preview.previewId,
      action: preview.action,
      locationName: preview.locationName,
      variants,
      summary: makeSummary(
        preview.orders.length,
        preview.orders.filter((order) => order.status === "found").length,
        variants,
      ),
    };
    res.json(ApplyChangesResponse.parse(response));
  } catch (error) {
    handleShopifyError(req, res, error);
  }
});

export default router;
