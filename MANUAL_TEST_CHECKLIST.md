# Safe manual test checklist

Use an explicitly authorized test order. Both actions change real Shopify settings. Sold Out affects every active stocked location for the confirmed variants; In Stock disables tracking without quantity writes. Review the entire scope before beginning.

- [ ] Without `APP_PASSWORD` or `SESSION_SECRET`, login shows a clear setup error. Missing Shopify Secrets names are shown explicitly when loading locations or previewing, with no fallback store.
- [ ] Invalid custom app credentials give a safe authentication error; missing permissions are named explicitly, without returning credentials.
- [ ] A wrong app password is rejected; correct login works; logout prevents reuse of the old session.
- [ ] One known test order resolves to the exact Shopify order name and expected variants.
- [ ] Lines, commas, and spaces work; `#1001` and `1001` are deduplicated.
- [ ] An unknown/ambiguous/inaccessible order cannot add variants to the update.
- [ ] A variant shared by multiple entered orders appears once, with all its associated order numbers.
- [ ] Confirm in Shopify that Preview makes no inventory, tracking, or activation changes.
- [ ] There is no location dropdown or quantity input. Locations are discovered and paginated on the backend.
- [ ] Sold Out enables tracking and zeros only the confirmed variants at all active stocked locations. Verify the final read finds no positive/nonzero available inventory at another active location.
- [ ] In Stock disables tracking, confirms `tracked: false`, and performs no quantity mutation or restoration. Already-disabled variants are skipped.
- [ ] An untracked test variant shows the tracking transition and all relevant locations before apply.
- [ ] Unstocked locations are not activated to create zeros; deleted/unresolvable variants are skipped with reasons.
- [ ] Deactivated or restricted locations fail safely; CONTINUE inventory policy displays its selling limitation.
- [ ] A stale or expired preview cannot overwrite changed inventory; changed form inputs require another preview.
- [ ] Cancel the confirmation dialog: nothing changes. A preview cannot be applied a second time.
- [ ] Permission/user errors, partial failures, and verification failures are shown per item, with accurate updated/failed/skipped totals.
- [ ] Browser code, responses, and logs contain no access token, password, session cookie value, or customer details.
- [ ] Desktop and phone layouts allow login, order entry, action choice, automatic location review, apply confirmation, and logout.
