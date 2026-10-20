---
name: Railway hosting
description: Identify the Railway deployment separately from the older Replit-published copy.
---

The user requested deployment to Railway. The verified app URL is https://bulk-stock-manager-production.up.railway.app, in the Railway project “Shopify Bulk Stock Manager,” service “bulk-stock-manager.”

**Why:** A separate Replit-published copy also exists. Its status and logs do not describe the Railway deployment.

**How to apply:** When investigating this Railway deployment, use Railway's status and logs rather than Replit's deployment tools. If the user names another hosting target, follow that target.

For release verification, compare the authenticated GitHub branch head and Railway's deployed commit instead of relying only on the local `origin/<branch>` tracking ref.

**Why:** The local tracking ref can be stale, and a Git CLI push may reject its cached credential even when GitHub already has the exact local commit and Railway has deployed it.

**How to apply:** Before retrying a push or redeploy, fetch the branch head through the authorized GitHub connection; if it matches the local commit, verify the Railway deployment commit and health rather than sending duplicate writes.
