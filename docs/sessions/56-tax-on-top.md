# 56. Tax goes on top of the price (2026-10-24)
- Branch / PR: feat/tax-on-top. The owner found absorbing tax too expensive and chose "always tax on top".
- Done: every Polar product is now made with its price `tax_behavior: "exclusive"`: Polar adds the subscriber's local tax on top and shows the total on its own page. The member's share is still a percent of Polar's `net_amount`, which is now the whole price, so a $5.00 price at 50% earns $2.50 (it was $2.12 after tax when prices were inclusive). Polar's fee estimate is on the same base. The revenue maths needed no change: collected is what the subscriber paid, tax is taken out, and the parts still add up.
- Existing products: migration 0023 forgets our stored Polar products (`DELETE FROM polar_products`) so they are made again, tax on top, on the next Subscribe. Subscriptions already running keep their old tax-inclusive product, so their split is still worked out on what was left after tax.
- Copy changed on the price page, the Subscribe box and the Payments example. PRD 8.14 updated.
- Test: the product request now carries `tax_behavior: "exclusive"`. The revenue and subscription browser tests still feed an order with $0.75 of tax inside a $5.00 payment; the maths is the same either way, so they stay.
- Not tested against the real Polar. Owner should run one real sandbox Subscribe and check the checkout shows the total with tax, and that the Revenue page matches Polar.
- Next: subscriber-only posts (step 3), only on the owner's go.
