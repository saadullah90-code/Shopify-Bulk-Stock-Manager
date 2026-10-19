# Safe manual test checklist

Use a test store or an explicitly authorized test order. Both stock actions change real inventory. Note the intended test location and final quantity before beginning.

- [ ] Without `APP_PASSWORD` or `SESSION_SECRET`, login shows a clear setup error. In direct-token mode, a missing domain/token pair also shows a safe setup error.
- [ ] Invalid direct credentials or revoked connection access gives a safe authentication error, without returning a token.
- [ ] A wrong app password is rejected; correct login works; logout prevents reuse of the old session.
- [ ] One known test order resolves to the exact Shopify order name and expected variants.
- [ ] Lines, commas, and spaces work; `#1001` and `1001` are deduplicated.
- [ ] An unknown/ambiguous/inaccessible order cannot add variants to the update.
- [ ] A variant shared by multiple entered orders appears once, with all its associated order numbers.
- [ ] Confirm in Shopify that Preview makes no inventory, tracking, or activation changes.
- [ ] Choose one location. Sold Out changes only confirmed variants there to exactly `0`; other variants and locations are unchanged.
- [ ] In Stock defaults to `10`, accepts another positive integer, warns about overwriting, and sets the exact chosen amount.
- [ ] An untracked test variant shows the warning, enables tracking on apply, and verifies its quantity.
- [ ] A variant not stocked at the selected active location shows activation in the preview; deleted/unresolvable variants are skipped with reasons.
- [ ] Deactivated or restricted locations fail safely; CONTINUE inventory policy displays its selling limitation.
- [ ] A stale or expired preview cannot overwrite changed inventory; changed form inputs require another preview.
- [ ] Cancel the confirmation dialog: nothing changes. A preview cannot be applied a second time.
- [ ] Permission/user errors, partial failures, and verification failures are shown per item, with accurate updated/failed/skipped totals.
- [ ] Browser code, responses, and logs contain no access token, password, session cookie value, or customer details.
- [ ] Desktop and phone layouts allow login, location choice, preview review, apply confirmation, and logout.
