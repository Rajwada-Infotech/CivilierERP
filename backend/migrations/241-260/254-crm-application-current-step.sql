-- The Application wizard's Resume button always reopened on Parking
-- (step 2) the moment a Project/Unit existed, regardless of how much
-- further staff had actually gotten (Bank/KYC, Co-Applicant, Attachments,
-- even Details awaiting approval) — there was no column to remember it.
-- CurrentStep tracks the furthest step the wizard has reached for this
-- Application (1-6, see crmApplications.js PUT /:id — it only ever moves
-- forward). Defaults to 1 so every existing row (already fully filed) is
-- harmless: loadApplicationIntoWizard in CrmApplication.tsx clamps a
-- default-1 value back up to step 2 once a Project/Unit is on the record,
-- same as before this change for anything that predates it.
USE Civilier;
GO

ALTER TABLE dbo.CrmApplication ADD
  CurrentStep TINYINT NOT NULL CONSTRAINT DF_CrmApplication_CurrentStep DEFAULT 1;
GO