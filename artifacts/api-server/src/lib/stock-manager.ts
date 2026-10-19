import { randomUUID } from "node:crypto";
import type { VariantResult, InventoryLocationResult, OrderResult } from "@workspace/api-zod";
import { assertShopifyPermissions, ShopifyApiError, shopifyGraphql, shopifyMutation, shopifyUserErrors } from "./shopify-client";

export type StockAction = "sold_out" | "in_stock";
interface PageInfo { hasNextPage: boolean; endCursor: string | null }
interface Connection<T> { nodes: T[]; pageInfo: PageInfo }
interface Location { id: string; name: string; isActive: boolean | null }
interface Level {
  location: Location;
  quantities: Array<{ name: string; quantity: number }>;
}
interface Inventory { id: string; tracked: boolean; levels: Level[] }
interface Line {
  id: string;
  title: string;
  variant: {
    id: string; title: string; inventoryPolicy: "DENY" | "CONTINUE";
    product: { title: string; status: string } | null;
    inventoryItem: { id: string } | null;
  } | null;
}

function nextPage(page: PageInfo, previous: string | null): string | null {
  if (!page.hasNextPage) return null;
  if (!page.endCursor || page.endCursor === previous) {
    throw new ShopifyApiError("Shopify pagination did not advance. The operation stopped rather than omit inventory.");
  }
  return page.endCursor;
}

export async function discoverLocations(): Promise<Location[]> {
  await assertShopifyPermissions();
  const locations: Location[] = [];
  let after: string | null = null;
  do {
    const data: { locations: Connection<Location> } = await shopifyGraphql(`
      query AllInventoryLocations($after: String) {
        locations(first: 100, after: $after, includeInactive: true, includeLegacy: true) {
          nodes { id name isActive } pageInfo { hasNextPage endCursor }
        }
      }`, { after });
    locations.push(...data.locations.nodes);
    after = nextPage(data.locations.pageInfo, after);
  } while (after);
  return locations;
}

export async function readInventory(id: string, locationDetails = true): Promise<Inventory | null> {
  const levels: Level[] = [];
  let after: string | null = null;
  let tracked: boolean | undefined;
  do {
    const data: { inventoryItem: {
      id: string; tracked: boolean; inventoryLevels: Connection<Level>;
    } | null } = await shopifyGraphql(`
      query AllVariantInventory($id: ID!, $after: String) {
        inventoryItem(id: $id) {
          id tracked
          inventoryLevels(first: 100, after: $after, includeInactive: true) {
            nodes {
              location { id ${locationDetails ? "name isActive" : ""} }
              quantities(names: ["available"]) { name quantity }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`, { id, after });
    if (!data.inventoryItem) return null;
    if (tracked !== undefined && tracked !== data.inventoryItem.tracked) {
      throw new ShopifyApiError("Tracking changed while inventory pages were being read. Preview again.");
    }
    tracked = data.inventoryItem.tracked;
    levels.push(...data.inventoryItem.inventoryLevels.nodes.map((level) => ({
      ...level,
      location: {
        id: level.location.id,
        name: locationDetails ? level.location.name
          : `Location ${level.location.id.split("/").pop()} (name not requested)`,
        isActive: locationDetails ? level.location.isActive : null,
      },
    })));
    after = nextPage(data.inventoryItem.inventoryLevels.pageInfo, after);
  } while (after);
  return { id, tracked: tracked === true, levels };
}

const available = (level: Level): number | null =>
  level.quantities.find((quantity) => quantity.name === "available")?.quantity ?? null;

function locationResults(
  inventory: Inventory, locations: Location[], action: StockAction,
): InventoryLocationResult[] {
  const all = new Map(locations.map((location) => [location.id, location]));
  const levels = new Map(inventory.levels.map((level) => [level.location.id, level]));
  for (const level of inventory.levels) all.set(level.location.id, level.location);
  return [...all.values()].map((location): InventoryLocationResult => {
    const level = levels.get(location.id);
    const willSet = action === "sold_out" && location.isActive && Boolean(level);
    return {
      locationId: location.id, name: location.name, active: location.isActive,
      stocked: Boolean(level), currentQuantity: level ? available(level) : null,
      targetQuantity: willSet ? 0 : null,
      updateStatus: willSet ? "pending" : "skipped",
      updateMessage: action === "in_stock" ? "No quantity writes; inventory tracking will be disabled for the variant."
        : location.isActive === null ? "Active status is unknown: location permission is required. No changes permitted."
        : !location.isActive ? "Inactive location: not currently sellable; no quantity write."
        : !level ? "Not stocked here. No inventory activation is needed for zero stock." : null,
    };
  }).sort((a, b) => a.locationId.localeCompare(b.locationId));
}

export function parseOrders(raw: string): Array<{ entered: string; number: string }> {
  const unique = new Map<string, { entered: string; number: string }>();
  for (const entered of raw.split(/[\s,]+/).filter(Boolean)) {
    const number = entered.replace(/^#/, "");
    if (!/^\d{1,20}$/.test(number)) throw new Error(`"${entered}" is not a valid numeric Shopify order number.`);
    if (!unique.has(number)) unique.set(number, { entered, number });
  }
  if (!unique.size) throw new Error("Enter at least one order number.");
  if (unique.size > 100) throw new Error("Preview at most 100 unique order numbers at a time.");
  return [...unique.values()];
}

async function exactOrder(number: string): Promise<Array<{ id: string; name: string }>> {
  const matches: Array<{ id: string; name: string }> = [];
  let after: string | null = null;
  do {
    const data: { orders: Connection<{ id: string; name: string }> } = await shopifyGraphql(`
      query ExactOrderSearch($query: String!, $after: String) {
        orders(first: 100, query: $query, after: $after) {
          nodes { id name } pageInfo { hasNextPage endCursor }
        }
      }`, { query: `name:#${number}`, after });
    matches.push(...data.orders.nodes.filter((order) => order.name.replace(/^#/, "") === number));
    if (matches.length > 1) return matches;
    after = nextPage(data.orders.pageInfo, after);
  } while (after);
  return matches;
}

async function orderLines(id: string): Promise<Line[] | null> {
  const lines: Line[] = [];
  let after: string | null = null;
  do {
    const data: { order: { lineItems: Connection<Line> } | null } = await shopifyGraphql(`
      query OrderVariantLines($id: ID!, $after: String) {
        order(id: $id) {
          lineItems(first: 100, after: $after) {
            nodes {
              id title
              variant {
                id title inventoryPolicy product { title status }
                inventoryItem { id }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`, { id, after });
    if (!data.order) return null;
    lines.push(...data.order.lineItems.nodes);
    after = nextPage(data.order.lineItems.pageInfo, after);
  } while (after);
  return lines;
}

export async function buildStockPreview(
  enteredOrders: ReturnType<typeof parseOrders>, action: StockAction,
): Promise<{ orders: OrderResult[]; variants: VariantResult[]; blockingIssues: string[] }> {
  await assertShopifyPermissions();
  const orders: OrderResult[] = [];
  const grouped = new Map<string, { line: Line; orderNumbers: Set<string> }>();
  // Resolve the entered orders only; never enumerate or process all store orders.
  for (const entered of enteredOrders) {
    const matches = await exactOrder(entered.number);
    const match = matches.length === 1 ? matches[0] : null;
    const lines = match ? await orderLines(match.id) : null;
    let purchaserName: string | null = null;
    let purchaserNameReason: string | null = null;
    if (match) {
      // Isolate protected customer fields: name access must never break order
      // resolution or inventory previews. Never substitute a shipping recipient.
      try {
        const buyer = await shopifyGraphql<{
          order: { customer: { firstName: string | null; lastName: string | null } | null } | null;
        }>(`query OrderPurchaser($id: ID!) {
          order(id: $id) { customer { firstName lastName } }
        }`, { id: match.id });
        const customer = buyer.order?.customer;
        purchaserName = [customer?.firstName, customer?.lastName].filter(Boolean).join(" ").trim() || null;
        if (!purchaserName) purchaserNameReason = "Shopify did not return a purchaser name for this order.";
      } catch (error) {
        purchaserNameReason = error instanceof ShopifyApiError && /read_customers/i.test(error.message)
          ? "Shopify requires read_customers permission and approved customer-data access to show purchaser names."
          : error instanceof ShopifyApiError && /not approved|PII|protected customer/i.test(error.message)
            ? "Shopify has not approved this app to read customer names. Check protected customer-data access in your existing custom app."
            : error instanceof ShopifyApiError ? `Purchaser name unavailable: ${error.message}`
              : "Purchaser name could not be read from Shopify.";
      }
    }
    orders.push({
      entered: entered.entered, orderName: lines && match ? match.name : null,
      purchaserName, purchaserNameReason,
      status: matches.length > 1 ? "ambiguous" : !match ? "not_found" : !lines ? "inaccessible" : "found",
      reason: matches.length > 1 ? "Multiple exact order matches; no updates are permitted."
        : !match ? "No exact match in the configured store. Older orders require approved read_all_orders access."
        : !lines ? "Order line items are inaccessible; no updates are permitted." : null,
    });
    for (const line of lines ?? []) {
      const key = line.variant?.inventoryItem?.id ?? `unavailable:${match!.id}:${line.id}`;
      const existing = grouped.get(key);
      if (existing) existing.orderNumbers.add(entered.entered);
      else grouped.set(key, { line, orderNumbers: new Set([entered.entered]) });
    }
  }
  // Tracking is variant-wide. In Stock does not depend on location metadata
  // and must not require read_locations just to set tracked:false.
  let locations: Location[] = [];
  const blockingIssues: string[] = [];
  if (action === "sold_out") {
    try {
      locations = await discoverLocations();
    } catch (error) {
      if (!(error instanceof ShopifyApiError)
        || !/read_locations/i.test(error.message)
        || !/permission|access denied/i.test(error.message)) throw error;
      blockingIssues.push("Sold Out requires read_locations permission in your existing Shopify custom app. Add and approve this permission, update the token privately only if Shopify issues a replacement, then create a fresh preview. Active locations cannot yet be verified, so Apply is blocked.");
    }
  }
  const variants: VariantResult[] = [];
  for (const [id, group] of grouped) {
    const variant = group.line.variant;
    const inventory = variant?.product && variant.inventoryItem
      ? await readInventory(id, action === "sold_out" && blockingIssues.length === 0) : null;
    const entries = inventory ? locationResults(inventory, locations, action) : [];
    const unreadable = action === "sold_out" && entries.some((entry) => entry.active && entry.stocked && entry.currentQuantity === null);
    const skipReason = blockingIssues.length ? "Blocked: location access is required before Sold Out can change inventory."
      : !inventory ? "The variant, product, or inventory item was deleted or is inaccessible."
      : unreadable ? "An active stocked location has an unknown available quantity. No safe comparison is possible." : null;
    const warnings = [
      action === "sold_out" && variant?.inventoryPolicy === "CONTINUE" ? "Shopify's CONTINUE policy still permits selling at zero. This tool does not change that policy." : null,
      action === "in_stock" ? "Disabling tracking does not publish products or change sales channels. Availability remains subject to product status and Shopify settings; quantities are not restored or invented." : null,
      variant?.product?.status !== "ACTIVE" ? `Product status is ${variant?.product?.status ?? "unknown"}; availability is not guaranteed.` : null,
      entries.some((entry) => entry.active === false && entry.stocked) ? "Inactive location quantities are shown and skipped. They are not currently sellable." : null,
    ].filter(Boolean).join(" ");
    variants.push({
      inventoryItemId: id, productTitle: variant?.product?.title ?? group.line.title,
      variantTitle: variant?.title ?? "Unavailable variant",
      productStatus: variant?.product?.status ?? null, orderNumbers: [...group.orderNumbers],
      tracked: inventory?.tracked ?? false, targetTracked: action === "sold_out",
      inventoryPolicy: variant?.inventoryPolicy ?? null, locations: entries,
      eligible: !skipReason, skipReason, warning: warnings || null,
      updateStatus: skipReason ? "skipped" : "pending", updateMessage: skipReason,
    });
  }
  return { orders, variants, blockingIssues };
}

function sameSnapshot(item: VariantResult, current: Inventory): boolean {
  if (item.tracked !== current.tracked) return false;
  const before = item.locations.filter((location) => location.stocked);
  if (before.length !== current.levels.length) return false;
  return current.levels.every((level) => {
    const previous = before.find((location) => location.locationId === level.location.id);
    return previous && previous.active === level.location.isActive && previous.currentQuantity === available(level);
  });
}

async function setTracking(id: string, tracked: boolean): Promise<void> {
  const data = await shopifyGraphql<{
    inventoryItemUpdate: {
      inventoryItem: { tracked: boolean } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(`mutation SetVariantTracking($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem { tracked } userErrors { message }
    }
  }`, { id, input: { tracked } }, { readOnly: false });
  const error = shopifyUserErrors(data.inventoryItemUpdate.userErrors);
  if (error || data.inventoryItemUpdate.inventoryItem?.tracked !== tracked) {
    throw new ShopifyApiError(error ?? "Shopify did not confirm the requested tracking state.");
  }
}

async function setZero(id: string, locationId: string, quantity: number, previewId: string): Promise<void> {
  const data = await shopifyMutation<{
    inventorySetQuantities: {
      inventoryAdjustmentGroup: { id: string } | null;
      userErrors: Array<{ message: string }>;
    };
  }>((key) => `mutation ZeroVariantAtLocation($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) @idempotent(key: "${key}") {
      inventoryAdjustmentGroup { id } userErrors { message }
    }
  }`, {
    input: {
      name: "available", reason: "correction",
      referenceDocumentUri: `logistics://bulk-stock-manager/${previewId}/${randomUUID()}`,
      quantities: [{ inventoryItemId: id, locationId, quantity: 0, changeFromQuantity: quantity }],
    },
  });
  const error = shopifyUserErrors(data.inventorySetQuantities.userErrors);
  if (error || !data.inventorySetQuantities.inventoryAdjustmentGroup) {
    throw new ShopifyApiError(error ?? "Shopify did not confirm this location's inventory adjustment.");
  }
}

export async function applyStockVariant(
  item: VariantResult, action: StockAction, previewId: string,
): Promise<VariantResult> {
  if (!item.eligible) return { ...item, updateStatus: "skipped", updateMessage: item.skipReason };
  const result: VariantResult = { ...item, locations: item.locations.map((location) => ({ ...location })) };
  let changed = false;
  const errors: string[] = [];
  try {
    const initial = await readInventory(item.inventoryItemId, action === "sold_out");
    if (!initial) throw new ShopifyApiError("Inventory item no longer exists. Preview again.");
    if (action === "sold_out" ? !sameSnapshot(item, initial) : item.tracked !== initial.tracked) {
      throw new ShopifyApiError("Inventory or tracking changed after preview. No update was attempted; create a fresh preview.");
    }
    const targetTracked = action === "sold_out";
    if (initial.tracked !== targetTracked) {
      await setTracking(item.inventoryItemId, targetTracked);
      changed = true;
      result.tracked = targetTracked;
    }
    if (action === "sold_out") {
      const current = await readInventory(item.inventoryItemId);
      if (!current?.tracked) throw new ShopifyApiError("Tracking could not be verified before setting quantities.");
      if (initial.tracked && !sameSnapshot(item, current)) {
        throw new ShopifyApiError("Inventory changed while applying. No quantity was overwritten; preview again.");
      }
      for (const level of current.levels) {
        const location = result.locations.find((entry) => entry.locationId === level.location.id);
        if (!location || !location.stocked || location.active !== level.location.isActive) {
          throw new ShopifyApiError("Stocked locations changed after preview or after enabling tracking. No unreviewed inventory level will be updated; preview again.");
        }
      }
      for (const level of current.levels) {
        const location = result.locations.find((entry) => entry.locationId === level.location.id)!;
        if (!level.location.isActive) continue;
        const quantity = available(level);
        try {
          if (quantity === null) throw new ShopifyApiError("Available quantity is unknown; no safe update attempted.");
          if (quantity !== 0) {
            await setZero(item.inventoryItemId, level.location.id, quantity, previewId);
            changed = true;
          }
          location.updateMessage = quantity === 0 ? "Already zero; verification pending." : "Shopify accepted zero; verification pending.";
        } catch (error) {
          const message = error instanceof ShopifyApiError ? error.message : "Location update failed.";
          location.updateStatus = "failed";
          location.updateMessage = message;
          errors.push(`${location.name}: ${message}`);
        }
      }
    }
    const verified = await readInventory(item.inventoryItemId, action === "sold_out");
    if (!verified || verified.tracked !== targetTracked) {
      throw new ShopifyApiError("Shopify did not verify the target tracking state.");
    }
    result.tracked = verified.tracked;
    // The final read includes every inventory-level page, not just locations written.
    for (const level of verified.levels) {
      if (!result.locations.some((location) => location.locationId === level.location.id)) {
        if (action === "sold_out") errors.push("A new inventory location appeared during verification. Preview again.");
        result.locations.push({
          locationId: level.location.id, name: level.location.name, active: level.location.isActive,
          stocked: true, currentQuantity: available(level), targetQuantity: null,
          updateStatus: action === "sold_out" ? "failed" : "skipped",
          updateMessage: "New location was not changed; no quantity write was performed there.",
        });
      }
    }
    for (const location of result.locations) {
      const level = verified.levels.find((candidate) => candidate.location.id === location.locationId);
      location.stocked = Boolean(level);
      location.currentQuantity = level ? available(level) : null;
      if (level) location.active = level.location.isActive;
      if (action === "in_stock") {
        location.updateStatus = "skipped";
        location.updateMessage = "Tracking disabled; no quantity write was performed.";
      } else if (level?.location.isActive) {
        if (available(level) !== 0) {
          errors.push(`${location.name}: nonzero or unknown available inventory remains.`);
          location.updateStatus = "failed";
          location.updateMessage = "Zero could not be verified. Stock may remain sellable here.";
        } else if (location.updateStatus !== "failed") {
          location.updateStatus = "success";
          location.targetQuantity = 0;
          location.updateMessage = "Verified exactly 0 available.";
        }
      }
    }
    if (errors.length) throw new ShopifyApiError(errors.join(" "));
    return {
      ...result, updateStatus: changed ? "success" : "skipped",
      updateMessage: action === "in_stock"
        ? changed ? "Shopify confirmed tracking disabled. No quantities were written; availability depends on product/channel settings."
          : "Tracking was already disabled. No change was needed; no quantities were written."
        : `${changed ? "Shopify confirmed the changes." : "No change was needed."} Tracking is enabled and every active stocked location was verified at exactly 0 available. Inactive locations are skipped.${item.inventoryPolicy === "CONTINUE" ? " CONTINUE policy still permits selling at zero." : ""}`,
    };
  } catch (error) {
    return {
      ...result, updateStatus: "failed",
      updateMessage: `${changed ? "Some changes were confirmed before this failure. " : ""}${error instanceof ShopifyApiError ? error.message : "Unexpected inventory failure."} Review all location results and preview again before retrying.`,
      locations: result.locations.map((location) => location.updateStatus === "pending"
        ? { ...location, updateStatus: "failed", updateMessage: "The final outcome was not verified. Preview again." }
        : location),
    };
  }
}

export function stockSummary(orders: OrderResult[], variants: VariantResult[]) {
  return {
    inputOrders: orders.length, validOrders: orders.filter((order) => order.status === "found").length,
    variantsFound: variants.length,
    successfulUpdates: variants.filter((variant) => variant.updateStatus === "success").length,
    failedUpdates: variants.filter((variant) => variant.updateStatus === "failed").length,
    skippedItems: variants.filter((variant) => variant.updateStatus === "skipped").length,
  };
}
