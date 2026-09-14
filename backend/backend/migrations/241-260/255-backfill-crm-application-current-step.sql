-- Migration 254 added CrmApplication.CurrentStep defaulted to 1, which is
-- correct for anything created from here on (advanceStep in
-- CrmApplication.tsx keeps it current) but wrong for every application that
-- was already further along the wizard before this column existed — those
-- rows all sat at the default 1, so Resume (and the stepper tabs) kept
-- treating them as if only Parking had ever been reached, e.g. APP-2026-00037.
--
-- One-time backfill: infer the furthest step each such application actually
-- reached from the child data that step's Next action is known to produce,
-- and only touch rows still sitting at the untouched default (CurrentStep = 1)
-- so nothing genuinely new since migration 254 gets overwritten.
--   - dbo.CrmBookingDocument row exists      -> Attachments' Next was taken -> Details (6)
--   - dbo.CrmCoApplicant   row exists        -> reached Co-Applicant        -> Attachments (5)
--   - dbo.CrmCustomerBankDetail row exists   -> Bank/KYC's Next was taken   -> Co-Applicant (4)
--   - dbo.CrmParkingAllotment row exists     -> reached Parking             -> Bank/KYC (3)
--   - Company/Project/Unit all set           -> Step 1 done                -> Parking (2)
--   - otherwise                                                            -> Project/Unit (1)
USE Civilier;
GO

UPDATE a SET
  CurrentStep = CASE
    WHEN EXISTS (SELECT 1 FROM dbo.CrmBookingDocument d WHERE d.ApplicationId = a.Id) THEN 6
    WHEN EXISTS (SELECT 1 FROM dbo.CrmCoApplicant co WHERE co.ApplicationId = a.Id AND co.IsActive = 1) THEN 5
    WHEN EXISTS (SELECT 1 FROM dbo.CrmCustomerBankDetail b WHERE b.ApplicationId = a.Id) THEN 4
    WHEN EXISTS (SELECT 1 FROM dbo.CrmParkingAllotment p WHERE p.ApplicationId = a.Id AND p.IsActive = 1) THEN 3
    WHEN a.CompanyId IS NOT NULL AND a.ProjectId IS NOT NULL AND a.PreferredUnitId IS NOT NULL THEN 2
    ELSE 1
  END
FROM dbo.CrmApplication a
WHERE a.CurrentStep = 1;
GO