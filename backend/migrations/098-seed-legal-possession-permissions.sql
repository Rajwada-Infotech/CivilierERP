-- Migration 098: Seed RoleRights for LegalMilestones, PrePossession, PossessionNotice
-- Uses same pattern as 094-seed-welcome-calls-permissions.sql

-- Seed LegalMilestones for any role that has Followup/Agreements rights
INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
SELECT DISTINCT rr.RoleId, 'Followup', 'LegalMilestones', 1, 1, 1, 1
FROM dbo.RoleRights rr
WHERE rr.Module = 'Followup' AND rr.SubModule = 'Agreements'
  AND NOT EXISTS (
    SELECT 1 FROM dbo.RoleRights rr2
    WHERE rr2.RoleId = rr.RoleId AND rr2.Module = 'Followup' AND rr2.SubModule = 'LegalMilestones'
  );

-- Seed PrePossession for any role that has Followup/Handover rights
INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
SELECT DISTINCT rr.RoleId, 'Followup', 'PrePossession', 1, 1, 1, 1
FROM dbo.RoleRights rr
WHERE rr.Module = 'Followup' AND rr.SubModule = 'Handover'
  AND NOT EXISTS (
    SELECT 1 FROM dbo.RoleRights rr2
    WHERE rr2.RoleId = rr.RoleId AND rr2.Module = 'Followup' AND rr2.SubModule = 'PrePossession'
  );

-- Seed PossessionNotice for any role that has Followup/Handover rights
INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
SELECT DISTINCT rr.RoleId, 'Followup', 'PossessionNotice', 1, 1, 1, 1
FROM dbo.RoleRights rr
WHERE rr.Module = 'Followup' AND rr.SubModule = 'Handover'
  AND NOT EXISTS (
    SELECT 1 FROM dbo.RoleRights rr2
    WHERE rr2.RoleId = rr.RoleId AND rr2.Module = 'Followup' AND rr2.SubModule = 'PossessionNotice'
  );

-- Verify all three were seeded:
SELECT RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete
FROM dbo.RoleRights
WHERE Module = 'Followup'
  AND SubModule IN ('LegalMilestones', 'PrePossession', 'PossessionNotice')
ORDER BY RoleId, SubModule;