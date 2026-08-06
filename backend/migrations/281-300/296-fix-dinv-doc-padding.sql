-- Migration 296: Align DINV's DocNoPadding with actual code behaviour
--
-- Migration 291 seeded Direct Expense Booking (DINV) with DocNoPadding = 5,
-- but the ExpenseBooking numbering code (backend/routes/expenseBooking.js)
-- has always hardcoded 6-digit padding for this doc-number family and does
-- not read DocNoPadding at all. That mismatch meant the "next number"
-- preview shown while composing an invoice (which DOES read DocNoPadding
-- via backend/utils/docNumberLock.js) displayed a 5-digit number that never
-- matched what was actually saved (6-digit) — a source of confusion on top
-- of the separate MAX-sequence parsing bug fixed alongside this migration.
--
-- This just corrects the stored config to reflect reality; it does not
-- change any existing ExpenseBooking rows.

UPDATE dbo.TypeOfDoc
SET DocNoPadding = 6
WHERE DocNoPrefix = 'DINV' AND CompanyId IS NULL AND ProjectId IS NULL;
GO

PRINT '296-fix-dinv-doc-padding applied successfully.';
GO
