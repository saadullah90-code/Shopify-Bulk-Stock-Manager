---
name: Target Shopify store
description: The user's intended store for the inventory tool.
---

Connect this inventory tool to the user's existing Shopify store, not a newly provisioned store.

**Why:** The user explicitly confirmed that they want their existing store connected after the provisioned store showed an unfamiliar default location and did not contain their order.

**How to apply:** Use an existing-store Admin API connection. Do not provision another store, seed data, or assume the provisioned store contains the user's orders.
