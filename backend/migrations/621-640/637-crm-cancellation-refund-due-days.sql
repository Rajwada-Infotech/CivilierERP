-- Migration 637: the refund due days are set on the cancellation policy, not fixed in code.
--
-- The refund for an approved cancellation was always due 45 days later (RERA s.18), fixed in code. Business decision
-- 2026-11-12: it is part of the cancellation policy, set per slab on the new Cancellation Policy screen.
--   CrmCancellationPolicy.RefundDueDays: days after approval the refund is due; NULL = the default (45, in code).
--   CrmCancellation.RefundDueDays: the days that applied when the request was made, kept with it like its charge %.
-- Safe to run again.
IF COL_LENGTH('dbo.CrmCancellationPolicy', 'RefundDueDays') IS NULL
  ALTER TABLE dbo.CrmCancellationPolicy ADD RefundDueDays INT NULL;
GO
IF COL_LENGTH('dbo.CrmCancellation', 'RefundDueDays') IS NULL
  ALTER TABLE dbo.CrmCancellation ADD RefundDueDays INT NULL;
GO
