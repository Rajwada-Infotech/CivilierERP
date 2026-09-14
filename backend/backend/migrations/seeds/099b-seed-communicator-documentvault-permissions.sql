-- Migration 099b: Seed RoleRights for Communicator and DocumentVault submodules
-- Follows the same pattern as 098-seed-legal-possession-permissions.sql

-- ── Communicator ──────────────────────────────────────────────────────────────
-- Grant to any role that already has Followup/Agreements rights
INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
SELECT DISTINCT rr.RoleId, 'Followup', 'Communicator', 1, 1, 1, 0
FROM dbo.RoleRights rr
WHERE rr.Module = 'Followup' AND rr.SubModule = 'Agreements'
  AND NOT EXISTS (
    SELECT 1 FROM dbo.RoleRights rr2
    WHERE rr2.RoleId = rr.RoleId AND rr2.Module = 'Followup' AND rr2.SubModule = 'Communicator'
  );

-- ── DocumentVault ─────────────────────────────────────────────────────────────
-- Grant to any role that already has Followup/Agreements rights
INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
SELECT DISTINCT rr.RoleId, 'Followup', 'DocumentVault', 1, 1, 1, 1
FROM dbo.RoleRights rr
WHERE rr.Module = 'Followup' AND rr.SubModule = 'Agreements'
  AND NOT EXISTS (
    SELECT 1 FROM dbo.RoleRights rr2
    WHERE rr2.RoleId = rr.RoleId AND rr2.Module = 'Followup' AND rr2.SubModule = 'DocumentVault'
  );

-- Verify:
SELECT RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete
FROM dbo.RoleRights
WHERE Module = 'Followup'
  AND SubModule IN ('Communicator', 'DocumentVault')
ORDER BY RoleId, SubModule;
