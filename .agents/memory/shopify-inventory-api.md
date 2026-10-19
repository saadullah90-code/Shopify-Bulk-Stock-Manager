---
name: Shopify inventory API cautions
description: Avoid outdated examples when upgrading Shopify inventory mutations.
---

Read the version-specific requirements before copying Shopify inventory mutation examples. Some examples omit mandatory idempotency directives.

**Why:** Shopify's 2026-10 documentation states that inventory quantity setting and activation require field-level `@idempotent` keys from 2026-04 onward, while some example queries on the same pages omit them.

**How to apply:** Follow the versioned description and cautions, verify uncertain fields with read-only schema checks, and do not add blind write retries. A safe idempotent retry must reuse the original operation's key.

An ID-only location query does not prove access to location details.

**Why:** On this store, the token could resolve `Location.id` while Shopify denied `Location.name` and `Location.isActive`. A minimal successful query led to an incorrect conclusion that full location access worked.

**How to apply:** Verify the actual fields needed for active/inactive inventory handling. Do not bypass missing location permissions, infer active status, or tell the user access is sufficient based only on IDs.

Keep location-detail permissions specific to Sold Out, not to tracking-only In Stock.

**Why:** The owner confirmed that In Stock works properly after its unnecessary location-name/status lookup was removed. Changing tracking is variant-wide and does not require choosing active locations.

**How to apply:** Preserve that working In Stock behavior. For Sold Out, unknown location status must block Apply; a read-only diagnostic preview is not permission to write inventory.

Customer scopes and protected customer-data approval are separate restrictions.

**Why:** Reading an order's customer required `read_customers`; an independent order billing-name query also failed because Shopify had not approved access to personally identifiable customer data. Granting a scope alone must not be promised to unlock names.

**How to apply:** Keep purchaser-name access isolated from stock previews. Show the real name only when Shopify returns it; otherwise explain the missing scope/approval. Never invent a name or substitute a shipping recipient.
