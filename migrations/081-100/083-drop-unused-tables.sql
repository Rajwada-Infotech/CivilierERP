-- 083-drop-unused-tables.sql
-- Drops payment link tables (from 082), CompanyMaster, and ProjectMaster.
-- FK constraints are dropped explicitly before their parent tables.

-- ── 1. BookingPaymentTerms & UnitPaymentTerms (added in 082) ─────────────────
IF OBJECT_ID('dbo.UnitPaymentTerms',    'U') IS NOT NULL DROP TABLE dbo.UnitPaymentTerms;
IF OBJECT_ID('dbo.BookingPaymentTerms', 'U') IS NOT NULL DROP TABLE dbo.BookingPaymentTerms;

-- ── 2. Drop FKs referencing CompanyMaster ────────────────────────────────────
IF OBJECT_ID('dbo.FK_FollowupApplicants_CompanyMaster',    'F') IS NOT NULL
  ALTER TABLE dbo.FollowupApplicants    DROP CONSTRAINT FK_FollowupApplicants_CompanyMaster;

IF OBJECT_ID('dbo.FK_FollowupUnitSelections_CompanyMaster','F') IS NOT NULL
  ALTER TABLE dbo.FollowupUnitSelections DROP CONSTRAINT FK_FollowupUnitSelections_CompanyMaster;

IF OBJECT_ID('dbo.FK_FollowupAgreements_CompanyMaster',    'F') IS NOT NULL
  ALTER TABLE dbo.FollowupAgreements    DROP CONSTRAINT FK_FollowupAgreements_CompanyMaster;

IF OBJECT_ID('dbo.FK_FollowupBookings_Company',            'F') IS NOT NULL
  ALTER TABLE dbo.FollowupBookings      DROP CONSTRAINT FK_FollowupBookings_Company;

-- ── 3. Drop FKs referencing ProjectMaster ────────────────────────────────────
IF OBJECT_ID('dbo.FK_FollowupApplicants_ProjectMaster',    'F') IS NOT NULL
  ALTER TABLE dbo.FollowupApplicants    DROP CONSTRAINT FK_FollowupApplicants_ProjectMaster;

IF OBJECT_ID('dbo.FK_FollowupUnitSelections_ProjectMaster','F') IS NOT NULL
  ALTER TABLE dbo.FollowupUnitSelections DROP CONSTRAINT FK_FollowupUnitSelections_ProjectMaster;

IF OBJECT_ID('dbo.FK_FollowupAgreements_ProjectMaster',    'F') IS NOT NULL
  ALTER TABLE dbo.FollowupAgreements    DROP CONSTRAINT FK_FollowupAgreements_ProjectMaster;

IF OBJECT_ID('dbo.FK_FollowupBookings_Project',            'F') IS NOT NULL
  ALTER TABLE dbo.FollowupBookings      DROP CONSTRAINT FK_FollowupBookings_Project;

-- ── 4. Drop the tables ────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.CompanyMaster', 'U') IS NOT NULL DROP TABLE dbo.CompanyMaster;
IF OBJECT_ID('dbo.ProjectMaster', 'U') IS NOT NULL DROP TABLE dbo.ProjectMaster;
