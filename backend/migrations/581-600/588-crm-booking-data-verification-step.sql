-- Migration 588: "CRM Booking — Data Verification" becomes an Approval Setup step.
--
-- The booking's Data Review — ticking / flagging the checklist and "Verify & Send for
-- Approval" — is now done by whoever Approval Setup names for "crm-booking-verification"
-- (roles or specific people), through the same shared approval engine as every other
-- approval; a super admin can always do it. Correcting a flagged item stays with whoever
-- may edit the booking.
--
-- No one is named here: the step is created empty so the right people are chosen in
-- Admin → Approval → Approval Setup. Until then only a super admin can verify.
-- Safe to run again.

IF NOT EXISTS (SELECT 1 FROM dbo.ApprovalWorkflows WHERE active = 1 AND modules LIKE N'%"crm-booking-verification"%')
  INSERT INTO dbo.ApprovalWorkflows (Name, type, modules, LevelsData, active, CreatedBy, CreatedAt, Module, Levels, Status)
  VALUES (N'CRM Booking — Data Verification', 'sequential', N'["crm-booking-verification"]',
          N'[{"id":1,"label":"Data Verification","mode":"any","roles":[],"userIds":[]}]',
          1, N'migration 588', SYSDATETIME(), N'crm-booking-verification', 1, 'Active');
GO
