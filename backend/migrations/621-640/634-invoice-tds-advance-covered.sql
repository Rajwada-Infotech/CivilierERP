-- Migration 634: how much of an invoice was covered by advance payments that already had TDS deducted.
-- TDS on an invoice is then deducted only on the rest (services/tds.js computeAdvanceTdsCover), and each advance is
-- used up once across a party's invoices (getAdvanceTdsAvailable sums this column). Existing invoices stay at 0.
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'ExpenseBooking' AND COLUMN_NAME = 'TDSAdvanceCovered')
  ALTER TABLE dbo.ExpenseBooking ADD TDSAdvanceCovered DECIMAL(18,2) NOT NULL CONSTRAINT DF_ExpenseBooking_TDSAdvanceCovered DEFAULT 0;
GO
