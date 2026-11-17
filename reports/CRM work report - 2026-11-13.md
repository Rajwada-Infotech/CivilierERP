# CRM Work Report — 13 November 2026

## Change Unit workflow

- Continued the full-page Change Unit flow in CRM. The unit-change application supports repricing the destination unit and carrying forward or editing parking and extra charges; this is not treated as a discount or a separate unit-change fee.
- Kept the approval boundary clear: approving the unit change authorizes the move, but does not approve the new booking.
- Corrected unit-change execution so the new booking starts at **Pending · Review**. The normal booking verification checklist, Marketing Head approval, and Director approval are still required. Approval timestamps are not pre-filled.
- Added a booking-page note explaining that a unit-change approval does not approve the new booking.

## Existing booking correction

- Audited booking **BKG-2026-00138** (ID 269), created from unit-change request **UCR-2026-00001**.
- Confirmed it had no booking approval audit rows, welcome calls, agreements, invoices, or money receipts. The only carried amount was the ₹1,00,000 rebooking credit.
- With the user's approval, reset the booking from **Approved · Confirmed** to **Pending · Review**, cleared the confirmation and approval fields, and added a stage-history entry documenting the correction.
- The unit-change request remains Completed; its move is complete, while the new booking continues through its own review and approvals.

## Payment clarity and reconciliation

- Traced booking 214's ₹1,00,000 receipt through the source on-account entry, unit-change hold, transfer, and destination booking.
- Confirmed the source credit is offset by a ₹1,00,000 debit adjustment and the destination booking carries one ₹1,00,000 credit. The customer's net on-account balance is ₹1,00,000, and the General Ledger has one ₹1,00,000 receipt voucher.
- Updated the old booking payment view to mark its schedule as historical, distinguish the carried credit from a collectible balance, and show the receipt → internal hold → destination credit journey. Added links to the request and destination booking.
- Clarified gross receipts versus net credit on the payment trail. The receipt total now states that it includes amounts later refunded, reserved, or transferred; a second line reconciles gross receipts to adjusted + on-account credit and amounts no longer on the booking. Renamed the outflow status to “Out of this booking” and changed the top figure to “counted toward due.”
- Audited booking BKG-2026-00131 (ID 211) to resolve the remaining “adjusted vs refunded” question: ₹1,17,87,500 gross receipts, ₹82,35,000 adjusted, ₹35,52,500 actually refunded (three Paid refunds), ₹0 still reserved/moved, and ₹0 on account. The ₹82,35,000 adjustment equals the post-waiver billable amount. Updated the trail to separate paid refunds from reserved/moved funds and show that reconciliation.
- Left the existing 5% GST calculation unchanged, as requested.

## Verification

- `npm run build` completed successfully after the frontend and workflow changes.
- `node --check backend/services/crmEntityCreation.js` passed.
- The earlier Change Unit backend E2E run was recorded as 78/78 before the latest booking-stage correction. It was not rerun after that correction.
