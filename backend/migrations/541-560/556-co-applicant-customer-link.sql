-- Migration 556: every co-applicant is a customer too.
--
-- The 1st applicant is the application's own customer (CrmApplication.
-- CustomerId); co-applicants are Applicant 2, 3 … (numbered by the order they
-- were added, worked out when read). CrmCoApplicant.CustomerId links each
-- co-applicant to its row in the customer pool (dbo.CrmCustomer) — matched on
-- mobile / PAN / email, or created. Existing co-applicants are left as they
-- are (NULL); the link is made when a co-applicant is added or edited.

IF COL_LENGTH('dbo.CrmCoApplicant', 'CustomerId') IS NULL
  ALTER TABLE dbo.CrmCoApplicant ADD CustomerId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.CrmCoApplicant') AND name = 'IX_CrmCoApplicant_Customer')
  CREATE INDEX IX_CrmCoApplicant_Customer ON dbo.CrmCoApplicant (CustomerId) WHERE CustomerId IS NOT NULL;
GO
