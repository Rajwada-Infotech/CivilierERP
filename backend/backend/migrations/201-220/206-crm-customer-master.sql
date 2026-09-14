-- ============================================================
-- Migration 181: CRM Customer Master
-- Introduces dbo.CrmCustomer as the canonical identity record
-- (name/PAN/address/co-applicant) sitting *before* Application in
-- the workflow. CrmApplication keeps its own denormalized
-- ApplicantName/Mobile/Email columns unchanged (so the ~30 existing
-- queries across the CRM module that read them directly keep working
-- untouched) and gains a CustomerId link that's the new source of
-- truth going forward. Existing applications are backfilled into
-- auto-created Customer rows, deduped by Mobile (the same identity
-- key crmCustomer360.js already uses to resolve "this customer's
-- other bookings").
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmCustomer' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmCustomer (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    CustomerNo          NVARCHAR(30)      NOT NULL UNIQUE,
    LeadId              INT               NULL REFERENCES dbo.SaLead(Id),
    CustomerName        NVARCHAR(200)     NOT NULL,
    Mobile              NVARCHAR(20)      NOT NULL,
    AltMobile           NVARCHAR(20)      NULL,
    Email               NVARCHAR(200)     NULL,
    PanNo               NVARCHAR(20)      NULL,
    Address             NVARCHAR(500)     NULL,
    City                NVARCHAR(100)     NULL,
    State               NVARCHAR(100)     NULL,
    Pincode             NVARCHAR(10)      NULL,
    DateOfBirth         DATE              NULL,
    -- Co-applicant is a single optional secondary applicant — a proper
    -- multi-co-applicant table is a bigger feature than what's been asked
    -- for here, and can be layered on later without touching this row shape.
    CoApplicantName     NVARCHAR(200)     NULL,
    CoApplicantMobile   NVARCHAR(20)      NULL,
    CoApplicantPanNo    NVARCHAR(20)      NULL,
    CoApplicantRelation NVARCHAR(50)      NULL,
    Notes               NVARCHAR(MAX)     NULL,
    IsActive            BIT               NOT NULL DEFAULT 1,
    CreatedBy           INT               NULL,
    CreatedAt           DATETIME2(3)      NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy           INT               NULL,
    UpdatedAt           DATETIME2(3)      NULL
  );
  -- One live customer record per phone number — the same identity key
  -- Customer 360 already relies on. Enforced only while IsActive=1 so a
  -- soft-deleted/merged duplicate never blocks a legitimate re-entry.
  CREATE UNIQUE INDEX UQ_CrmCustomer_Mobile ON dbo.CrmCustomer(Mobile) WHERE IsActive = 1;
  PRINT 'Created dbo.CrmCustomer';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmApplication') AND name = 'CustomerId')
BEGIN
  ALTER TABLE dbo.CrmApplication ADD CustomerId INT NULL REFERENCES dbo.CrmCustomer(Id);
  PRINT 'Added CrmApplication.CustomerId';
END
GO

-- Backfill: one Customer per distinct Mobile among existing applications,
-- using the earliest application's details as the representative record
-- (PAN/Address are left NULL — that data was never collected historically,
-- and mandatory-on-create only applies going forward, not retroactively).
IF EXISTS (SELECT 1 FROM dbo.CrmApplication WHERE CustomerId IS NULL)
BEGIN
  ;WITH FirstPerMobile AS (
    SELECT Mobile, ApplicantName, AltMobile, Email, LeadId, CreatedBy,
           ROW_NUMBER() OVER (PARTITION BY Mobile ORDER BY CreatedAt ASC) AS rn
    FROM dbo.CrmApplication
    WHERE Mobile IS NOT NULL AND Mobile <> ''
  )
  INSERT INTO dbo.CrmCustomer (CustomerNo, LeadId, CustomerName, Mobile, AltMobile, Email, CreatedBy, CreatedAt, Notes)
  SELECT
    'CUST-BF-' + RIGHT('000000' + CAST(ROW_NUMBER() OVER (ORDER BY Mobile) AS VARCHAR(6)), 6),
    LeadId, ApplicantName, Mobile, AltMobile, Email, CreatedBy, SYSDATETIME(),
    'Backfilled from existing application(s) during migration 181'
  FROM FirstPerMobile
  WHERE rn = 1
    AND NOT EXISTS (SELECT 1 FROM dbo.CrmCustomer c WHERE c.Mobile = FirstPerMobile.Mobile);

  UPDATE a
  SET a.CustomerId = c.Id
  FROM dbo.CrmApplication a
  JOIN dbo.CrmCustomer c ON c.Mobile = a.Mobile
  WHERE a.CustomerId IS NULL;

  PRINT 'Backfilled CrmCustomer rows and linked existing applications';
END
GO

-- Register the new page in the permissions system (same MERGE pattern
-- migration 149 used for every other CRM page key) so Menu Rights can
-- assign view/create/edit rights to it immediately.
MERGE dbo.PageDefinitions AS tgt
USING (VALUES
  ('crm-customers', 'Customers', 'CRM', 'CRM Pipeline', 'view,create,edit', 605, 1, 'migration-181')
) AS src (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy)
ON tgt.PageKey = src.PageKey
WHEN NOT MATCHED THEN
  INSERT (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (src.PageKey, src.Label, src.Module, src.GroupName, src.Actions, src.SortOrder, src.IsActive, src.CreatedBy, GETDATE());
GO
