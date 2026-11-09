-- Migration 626: a credit note on a Final invoice records how it was spread over the booking's milestones.
--
-- A Final invoice has no single milestone, so a credit note on one used to lower the invoice and the books while the
-- customer received no credit: nothing reached their account and Refunds had nothing to pay it from. The reduction now
-- comes off the milestones, last first, exactly as a credit note on one milestone does. This column remembers which
-- milestones moved and by how much, so cancelling the note can put each one back.
--
-- Additive and safe to run again. Credit notes already issued are not changed.
IF COL_LENGTH('dbo.CrmGstNote', 'MilestoneSpread') IS NULL
  ALTER TABLE dbo.CrmGstNote ADD MilestoneSpread NVARCHAR(MAX) NULL;
GO
