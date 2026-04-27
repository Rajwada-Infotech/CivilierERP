# Document Number Integration — Implementation TODO

## Goal
Make the `DocNumberPreview` dropdown populate the **main number input field directly** (GRNNo, PurchaseOrderNo, DocumentNumber, BookingReference, doc_no) across GRN, Purchase Order, Work Order, Debit Note, and Expense Booking. Keep the field editable. Backend must lock sequences via `DocNumberSequence`.

## Backend Tasks
- [x] 1. Create `backend/utils/docNumberLock.js` — shared helper (user provided)
- [ ] 2. Update `backend/routes/purchaseOrders.js` — use helper in POST (user provided)
- [ ] 3. Update `backend/routes/grns.js` — use helper in POST + back-patch
- [ ] 4. Update `backend/routes/workOrder.js` — use helper in POST + back-patch
- [ ] 5. Update `backend/routes/debitNote.js` — use helper in POST + back-patch
- [ ] 6. Update `backend/routes/expenseBooking.js` — refactor to use shared helper

## Frontend Tasks
- [ ] 7. Update `src/pages/material/GRN.tsx` — doc type selection populates `grnNo` directly
- [ ] 8. Update `src/pages/material/PurchaseOrderMaster.tsx` — doc type populates `poNumber`
- [ ] 9. Update `src/pages/material/WorkOrderMaster.tsx` — doc type populates `docNumber`, make editable
- [ ] 10. Update `src/pages/masters/DebitNoteMaster.tsx` — doc type integration with MasterPage
- [ ] 11. Update `src/pages/material/MaterialExpenseBooking.tsx` — align with same pattern

