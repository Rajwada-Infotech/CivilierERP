-- CrmCoApplicant rows auto-seeded from the Customer's intake-time
-- CoApplicant* fields (see seedPrimaryCoApplicantFromCustomer in
-- crmEntityCreation.js) were only ever identifiable by matching the free-text
-- Notes string "Auto-seeded from customer intake" — fragile, and breaks the
-- moment staff edit that Notes field. SourceType is an explicit, stable
-- marker so a later edit to the Customer's co-applicant fields can find and
-- re-sync exactly that row (and only that row — manually-added co-applicants
-- must never be silently overwritten).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCoApplicant') AND name = 'SourceType')
  ALTER TABLE dbo.CrmCoApplicant ADD SourceType NVARCHAR(20) NULL;
GO

UPDATE dbo.CrmCoApplicant SET SourceType = 'CustomerIntake'
WHERE SourceType IS NULL AND Notes = 'Auto-seeded from customer intake';
GO
