---
name: Target Shopify store
description: The user's intended store for the inventory tool.
---

Connect this inventory tool to the user's existing Shopify store, not a newly provisioned store.

**Why:** The user explicitly confirmed that they want their existing store connected after the provisioned store showed an unfamiliar default location and did not contain their order.

**How to apply:** Treat unfamiliar default locations and missing known orders as possible wrong-store symptoms. Verify the intended store read-only before diagnosing order matching; never substitute a newly provisioned store. Authentication constraints are in replit.md.
