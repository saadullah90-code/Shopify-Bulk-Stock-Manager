import app from "./app";
import { logger } from "./lib/logger";
import { getShopifySetupError } from "./lib/shopify-client";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

const shopifySetupError = getShopifySetupError();
if (shopifySetupError) logger.warn(shopifySetupError);
if (!process.env.APP_PASSWORD || !process.env.SESSION_SECRET) {
  logger.warn("App setup is incomplete: APP_PASSWORD and SESSION_SECRET are required.");
}

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
