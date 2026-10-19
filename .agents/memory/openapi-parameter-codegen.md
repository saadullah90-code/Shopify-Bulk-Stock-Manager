---
name: OpenAPI parameter codegen
description: Avoid duplicate parameter exports in this workspace's Orval output.
---

New GET endpoints with path parameters can produce duplicate `*Params` exports in the generated Zod barrel.

**Why:** The current generator gives a path-parameter Zod schema and its generated TypeScript interface the same exported name. Adding query parameters to that endpoint exposed the collision during the library typecheck.

**How to apply:** For new read-only ID lookups, validated query parameters work with the current setup and generate distinct query-schema names. If path parameters are needed, address the generator naming collision rather than manually editing generated files. Regenerate the API contract and verify the library typecheck.
