import { randomUUID } from "node:crypto";

export const SHOPIFY_API_VERSION = "2026-10";
const GRAPHQL_PATH = `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

export function getShopifySetupError(): string | null {
  const domain = process.env.SHOPIFY_STORE_DOMAIN?.trim();
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim();
  const missing = [
    !domain ? "SHOPIFY_STORE_DOMAIN" : null,
    !token ? "SHOPIFY_ADMIN_ACCESS_TOKEN" : null,
  ].filter(Boolean);
  if (missing.length) {
    return `Shopify setup is incomplete. Add ${missing.join(" and ")} in Replit Secrets. This app uses only your existing custom app credentials; there is no connector or OAuth fallback.`;
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
    const mentioned = [...new Set(messages.match(/\b(?:read|write)_[a-z_]+\b/g) ?? [])];
    return `Shopify denied this request. Enable ${mentioned.length ? mentioned.join(", ") : "read_orders, read_products, read_inventory, write_inventory, and read_locations"} in your Shopify custom app's Admin API permissions and update SHOPIFY_ADMIN_ACCESS_TOKEN in Replit Secrets if Shopify issues a replacement. Orders older than 60 days also require approved read_all_orders access.`;
  }
  if (codes.includes("THROTTLED") || /throttl|rate limit/i.test(messages)) {
    return "Shopify is rate-limiting requests. Wait a moment and try again.";
  }
  return "Shopify returned a GraphQL error. Verify your custom app's Admin API permissions and the configured store. No success can be confirmed for this request.";
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
      response = await fetch(
        `https://${process.env.SHOPIFY_STORE_DOMAIN!.trim()}${GRAPHQL_PATH}`,
        {
          ...requestOptions,
          redirect: "error",
          headers: {
            ...requestOptions.headers,
            "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!.trim(),
          },
        },
      );
    } catch {
      if (readOnly && attempt < attempts - 1) {
        await wait(350 * 2 ** attempt);
        continue;
      }
      throw new ShopifyApiError(
        "Could not reach Shopify before the request timed out or the connection failed. Verify SHOPIFY_STORE_DOMAIN in Replit Secrets and try again. If this was an update, preview again before retrying because its outcome may be unknown.",
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

    if (response.status === 401) {
      throw new ShopifyApiError(
        "Shopify rejected SHOPIFY_ADMIN_ACCESS_TOKEN. Verify that it is an active Admin API access token belonging to SHOPIFY_STORE_DOMAIN, and update these values privately in Replit Secrets.",
      );
    }
    if (response.status === 403) {
      throw new ShopifyApiError(
        "Shopify denied access. Check your custom app's read_orders, read_products, read_inventory, write_inventory, and read_locations permissions, then update SHOPIFY_ADMIN_ACCESS_TOKEN if required.",
      );
    }
    if (!response.ok) {
      throw new ShopifyApiError(
        `Shopify returned HTTP ${response.status}. Verify SHOPIFY_STORE_DOMAIN, the store's availability, and your custom app's Admin API permissions.`,
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

export async function assertShopifyPermissions(): Promise<void> {
  const result = await shopifyGraphql<{
    currentAppInstallation: { accessScopes: Array<{ handle: string }> } | null;
  }>(`query InventoryToolPermissions {
    currentAppInstallation { accessScopes { handle } }
  }`);
  if (!result.currentAppInstallation) {
    throw new ShopifyApiError("Shopify could not identify your custom app installation. Verify SHOPIFY_ADMIN_ACCESS_TOKEN.");
  }
  const granted = new Set(result.currentAppInstallation.accessScopes.map((scope) => scope.handle));
  const required = ["read_orders", "read_products", "read_inventory", "write_inventory", "read_locations"];
  const missing = required.filter((scope) =>
    !granted.has(scope) && !(scope.startsWith("read_") && granted.has(scope.replace(/^read_/, "write_"))),
  );
  if (missing.length) {
    throw new ShopifyApiError(
      `Your Shopify custom app is missing these Admin API permissions: ${missing.join(", ")}. Enable them in Shopify and update SHOPIFY_ADMIN_ACCESS_TOKEN in Replit Secrets if a replacement token is issued.`,
    );
  }
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
  let message = messages.join("; ") || "Shopify rejected this update.";
  for (const value of [process.env.SHOPIFY_STORE_DOMAIN, process.env.SHOPIFY_ADMIN_ACCESS_TOKEN]) {
    if (value?.trim()) message = message.split(value.trim()).join("[redacted]");
  }
  return message;
}
