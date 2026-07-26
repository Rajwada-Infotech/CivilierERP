-- Migration 256: Add ApplicationId FK to CrmCoApplicant
-- Allows co-applicants to be captured at the Application stage
-- (before a Booking is created), with each Application maintaining
-- its own independent set of co-applicants.
--
-- Existing rows: ApplicationId = NULL (backward compatible — they were
-- created via the Welcome Call / Booking workflow and remain valid).
-- New flow: ApplicationId set at Application stage; BookingId filled in
-- later by crmEntityCreation.js when the Application is converted to a Booking.

IF COL_LENGTH('dbo.CrmCoApplicant', 'ApplicationId') IS NULL
BEGIN
  ALTER TABLE dbo.CrmCoApplicant
    ADD ApplicationId INT NULL REFERENCES dbo.CrmApplication(Id);

  CREATE INDEX IX_CrmCoApplicant_Application
    ON dbo.CrmCoApplicant(ApplicationId)
    WHERE ApplicationId IS NOT NULL;

  PRINT 'Migration 256: ApplicationId column + index added to CrmCoApplicant.';
END
ELSE
BEGIN
  PRINT 'Migration 256: ApplicationId already exists — skipping.';
END

-- Extended profile columns for the Application wizard's full co-applicant form
-- (previously the table only had Name, Relation, Mobile, Email, PAN, Aadhaar, Notes)
IF COL_LENGTH('dbo.CrmCoApplicant', 'DateOfBirth') IS NULL
  ALTER TABLE dbo.CrmCoApplicant ADD DateOfBirth  DATE          NULL;
IF COL_LENGTH('dbo.CrmCoApplicant', 'Gender') IS NULL
  ALTER TABLE dbo.CrmCoApplicant ADD Gender       NVARCHAR(10)  NULL;
IF COL_LENGTH('dbo.CrmCoApplicant', 'Occupation') IS NULL
  ALTER TABLE dbo.CrmCoApplicant ADD Occupation   NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.CrmCoApplicant', 'AnnualIncome') IS NULL
  ALTER TABLE dbo.CrmCoApplicant ADD AnnualIncome DECIMAL(18,2) NULL;
IF COL_LENGTH('dbo.CrmCoApplicant', 'Address') IS NULL
  ALTER TABLE dbo.CrmCoApplicant ADD [Address]    NVARCHAR(300) NULL;
IF COL_LENGTH('dbo.CrmCoApplicant', 'City') IS NULL
  ALTER TABLE dbo.CrmCoApplicant ADD City         NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.CrmCoApplicant', 'State') IS NULL
  ALTER TABLE dbo.CrmCoApplicant ADD [State]      NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.CrmCoApplicant', 'Pincode') IS NULL
  ALTER TABLE dbo.CrmCoApplicant ADD Pincode      NVARCHAR(10)  NULL;
