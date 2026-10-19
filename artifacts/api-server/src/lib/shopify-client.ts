import { randomUUID } from "node:crypto";
import { ReplitConnectors } from "@replit/connectors-sdk";

export const SHOPIFY_API_VERSION = "2026-10";
const GRAPHQL_PATH = `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
const connectors = new ReplitConnectors();

export function getShopifySetupError(): string | null {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (Boolean(domain) !== Boolean(token)) {
    return "Direct Shopify setup is incomplete. Set both SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN in Replit Secrets, or remove both to use the connected Shopify store.";
  }
  if (domain && !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(domain.trim())) {
    return "SHOPIFY_STORE_DOMAIN must be the store's plain name.myshopify.com domain, without a protocol or path.";
  }
  return null;
}

type ShopifyGraphQLError = {
  message?: string;
  extensions?: { code?: string };
};

type ShopifyEnvelope<T> = {
  data?: T;
  errors?: ShopifyGraphQLError[];
};

export class ShopifyApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyApiError";
  }
}

function safeErrorMessage(errors: ShopifyGraphQLError[]): string {
  const codes = errors.map((error) => error.extensions?.code);
  const messages = errors.map((error) => error.message ?? "").join(" ");
  if (
    codes.includes("ACCESS_DENIED") ||
    /access denied|permission|scope/i.test(messages)
  ) {
    return "Shopify denied this request. Check that the connected store has read_orders, read_products, read_inventory, write_inventory, and read_locations permissions, then reconnect it.";
  }
  if (codes.includes("THROTTLED") || /throttl|rate limit/i.test(messages)) {
    return "Shopify is rate-limiting requests. Wait a moment and try again.";
  }
  return "Shopify returned an error. Check the store connection and required permissions.";
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function shopifyGraphql<T>(
  query: string,
  variables: Record<string, unknown> = {},
  options: { readOnly?: boolean } = {},
): Promise<T> {
  const readOnly = options.readOnly ?? true;
  const setupError = getShopifySetupError();
  if (setupError) throw new ShopifyApiError(setupError);
  const attempts = readOnly ? 3 : 1;
  let lastError: ShopifyApiError | undefined;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response;
    try {
      const requestOptions = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(20000),
      };
      if (process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
        response = await fetch(
          `https://${process.env.SHOPIFY_STORE_DOMAIN.trim()}${GRAPHQL_PATH}`,
          {
            ...requestOptions,
            headers: {
              ...requestOptions.headers,
              "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
            },
          },
        );
      } else {
        response = await connectors.proxy("shopify-store", GRAPHQL_PATH, requestOptions);
      }
    } catch {
      if (readOnly && attempt < attempts - 1) {
        await wait(350 * 2 ** attempt);
        continue;
      }
      throw new ShopifyApiError(
        "Could not reach the connected Shopify store. Check its Replit connection and try again.",
      );
    }

    if (response.status === 429 || response.status >= 500) {
      lastError = new ShopifyApiError(
        response.status === 429
          ? "Shopify is rate-limiting requests. Wait a moment and try again."
          : "Shopify is temporarily unavailable. Try again shortly.",
      );
      if (readOnly && attempt < attempts - 1) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        await wait(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 5000)
            : 350 * 2 ** attempt,
        );
        continue;
      }
      throw lastError;
    }

    if (response.status === 401 || response.status === 403) {
      throw new ShopifyApiError(
        "Shopify authorization failed. Reconnect the store and confirm the required permissions are enabled.",
      );
    }
    if (!response.ok) {
      throw new ShopifyApiError(
        `Shopify returned HTTP ${response.status}. Check the store connection and try again.`,
      );
    }

    let envelope: ShopifyEnvelope<T>;
    try {
      envelope = (await response.json()) as ShopifyEnvelope<T>;
    } catch {
      throw new ShopifyApiError("Shopify returned an unreadable response.");
    }

    if (envelope.errors?.length) {
      const isThrottled = envelope.errors.some(
        (error) => error.extensions?.code === "THROTTLED",
      );
      lastError = new ShopifyApiError(safeErrorMessage(envelope.errors));
      if (readOnly && isThrottled && attempt < attempts - 1) {
        await wait(350 * 2 ** attempt);
        continue;
      }
      throw lastError;
    }
    if (!envelope.data) {
      throw new ShopifyApiError("Shopify returned no data for this request.");
    }
    return envelope.data;
  }

  throw lastError ?? new ShopifyApiError("Shopify request failed.");
}

export async function shopifyMutation<T>(
  queryForIdempotencyKey: (key: string) => string,
  variables: Record<string, unknown>,
): Promise<T> {
  return shopifyGraphql<T>(
    queryForIdempotencyKey(randomUUID()),
    variables,
    { readOnly: false },
  );
}

export function shopifyUserErrors(
  errors: Array<{ field?: string[] | null; message: string }> | null | undefined,
): string | null {
  if (!errors?.length) return null;
  const messages = errors.map((error) => error.message).filter(Boolean);
  if (
    messages.some((message) =>
      /access denied|permission|scope/i.test(message),
    )
  ) {
    return "Shopify denied this update. Confirm write_inventory permission and the store user's inventory access.";
  }
  return messages.join("; ") || "Shopify rejected this update.";
}
