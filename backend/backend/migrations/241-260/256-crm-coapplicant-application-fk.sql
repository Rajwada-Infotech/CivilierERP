-- Migration 256: Let CrmCoApplicant be captured at Application stage, with
-- the fuller KYC-style field set backend/routes/crmCoApplicant.js already
-- assumes exists.
--
-- Co-Applicant used to be an intake-time convenience on CrmCustomer
-- (CoApplicantName/Mobile/PanNo/Relation), auto-seeded into a CrmCoApplicant
-- row only once a Booking existed. That capture point has moved forward to a
-- new "Co-Applicant" tab on the Application wizard itself (a real list, not
-- a single row), which reads/writes dbo.CrmCoApplicant directly by
-- ApplicationId, before any Booking exists yet -- the same dual-key shape
-- already used by CrmCustomerBankDetail / CrmBookingDocument /
-- CrmParkingAllotment (ApplicationId set first, BookingId backfilled once
-- the Booking is created).
--
-- Every column added below is guarded with its own existence check, so this
-- is safe to run whether or not an earlier migration already applied some or
-- all of it -- this codebase has a known recurring issue of migrations not
-- having been run against every environment, so "the route file already
-- references it" is deliberately NOT treated as proof the column exists.
-- CrmCustomer.CoApplicant* columns are left in place (dormant, historical
-- data only) -- this migration does not touch or drop them.

-- 1) ApplicationId, nullable (legacy rows predate this and only ever had a
--    BookingId).
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmCoApplicant') AND name = 'ApplicationId'
)
BEGIN
  ALTER TABLE dbo.CrmCoApplicant ADD ApplicationId INT NULL;
  PRINT 'Added CrmCoApplicant.ApplicationId';
END
ELSE
BEGIN
  PRINT 'CrmCoApplicant.ApplicationId already exists - skipped';
END

-- 2) BookingId must now be optional -- an Application-stage row is created
--    before any Booking exists, exactly like CrmCustomerBankDetail.BookingId.
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmCoApplicant') AND name = 'BookingId' AND is_nullable = 0
)
BEGIN
  ALTER TABLE dbo.CrmCoApplicant ALTER COLUMN BookingId INT NULL;
  PRINT 'CrmCoApplicant.BookingId is now nullable';
END
ELSE
BEGIN
  PRINT 'CrmCoApplicant.BookingId already nullable - skipped';
END

-- 3) FK to CrmApplication, matching the existing FK style to CrmBooking.
IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_CrmCoApplicant_Application'
)
BEGIN
  ALTER TABLE dbo.CrmCoApplicant
    ADD CONSTRAINT FK_CrmCoApplicant_Application FOREIGN KEY (ApplicationId)
    REFERENCES dbo.CrmApplication(Id);
  PRINT 'Added FK_CrmCoApplicant_Application';
END
ELSE
BEGIN
  PRINT 'FK_CrmCoApplicant_Application already exists - skipped';
END

-- 4) Backfill ApplicationId onto any existing (Booking-only) rows via their
--    Booking's own ApplicationId, so historical co-applicants remain
--    reachable by the new Application-keyed routes too.
UPDATE ca
SET ca.ApplicationId = b.ApplicationId
FROM dbo.CrmCoApplicant ca
JOIN dbo.CrmBooking b ON b.Id = ca.BookingId
WHERE ca.ApplicationId IS NULL AND ca.BookingId IS NOT NULL;

-- 5) Index for the new Application-keyed lookups.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.CrmCoApplicant') AND name = 'IX_CrmCoApplicant_ApplicationId'
)
BEGIN
  CREATE INDEX IX_CrmCoApplicant_ApplicationId ON dbo.CrmCoApplicant(ApplicationId);
  PRINT 'Created IX_CrmCoApplicant_ApplicationId';
END
ELSE
BEGIN
  PRINT 'IX_CrmCoApplicant_ApplicationId already exists - skipped';
END

-- 6) The fuller field set backend/routes/crmCoApplicant.js's Application-scoped
--    GET/POST already reads and writes: Email, AadhaarNo, DateOfBirth,
--    Gender, Occupation, AnnualIncome, Address, City, State, Pincode. The
--    original CustomerIntake-era seed only ever used Name/Relation/Mobile/
--    PanNo/Notes/SourceType, so these are genuinely new columns, not a
--    re-declaration of ones already guaranteed to exist.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCoApplicant') AND name = 'Email')
BEGIN
  ALTER TABLE dbo.CrmCoApplicant ADD Email NVARCHAR(200) NULL;
  PRINT 'Added CrmCoApplicant.Email';
END
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCoApplicant') AND name = 'AadhaarNo')
BEGIN
  ALTER TABLE dbo.CrmCoApplicant ADD AadhaarNo NVARCHAR(20) NULL;
  PRINT 'Added CrmCoApplicant.AadhaarNo';
END
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCoApplicant') AND name = 'DateOfBirth')
BEGIN
  ALTER TABLE dbo.CrmCoApplicant ADD DateOfBirth DATE NULL;
  PRINT 'Added CrmCoApplicant.DateOfBirth';
END
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCoApplicant') AND name = 'Gender')
BEGIN
  ALTER TABLE dbo.CrmCoApplicant ADD Gender NVARCHAR(10) NULL;
  PRINT 'Added CrmCoApplicant.Gender';
END
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCoApplicant') AND name = 'Occupation')
BEGIN
  ALTER TABLE dbo.CrmCoApplicant ADD Occupation NVARCHAR(100) NULL;
  PRINT 'Added CrmCoApplicant.Occupation';
END
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCoApplicant') AND name = 'AnnualIncome')
BEGIN
  ALTER TABLE dbo.CrmCoApplicant ADD AnnualIncome DECIMAL(18, 2) NULL;
  PRINT 'Added CrmCoApplicant.AnnualIncome';
END
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCoApplicant') AND name = 'Address')
BEGIN
  ALTER TABLE dbo.CrmCoApplicant ADD Address NVARCHAR(300) NULL;
  PRINT 'Added CrmCoApplicant.Address';
END
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCoApplicant') AND name = 'City')
BEGIN
  ALTER TABLE dbo.CrmCoApplicant ADD City NVARCHAR(100) NULL;
  PRINT 'Added CrmCoApplicant.City';
END
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCoApplicant') AND name = 'State')
BEGIN
  ALTER TABLE dbo.CrmCoApplicant ADD [State] NVARCHAR(100) NULL;
  PRINT 'Added CrmCoApplicant.State';
END
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCoApplicant') AND name = 'Pincode')
BEGIN
  ALTER TABLE dbo.CrmCoApplicant ADD Pincode NVARCHAR(10) NULL;
  PRINT 'Added CrmCoApplicant.Pincode';
END