-- Migration 576: how much a credit note actually took off its milestone.
--
-- Applying a credit-note adjustment reduces the milestone's AmountDue, but
-- never below zero - so when the note was larger than what the milestone
-- still had due, less than the note's total came off. Cancelling the note
-- added the FULL total back, leaving the milestone higher than it ever was.
-- The real reduction is now stored at apply time and used on cancel (older
-- notes fall back to their total, as before). Safe to run again.
IF COL_LENGTH(N'dbo.CrmGstNote', N'DueReducedBy') IS NULL
  ALTER TABLE dbo.CrmGstNote ADD DueReducedBy DECIMAL(18, 2) NULL;
GO
