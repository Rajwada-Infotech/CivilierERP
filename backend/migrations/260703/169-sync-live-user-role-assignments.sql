-- ============================================================
-- Fix: local dev DB and live server DB are two separate databases
-- (confirmed: local dev connects to 192.168.0.205, live server
-- connects to its own DB). Several users had their role manually
-- reassigned via the Manage Users UI on the local dev DB — which
-- writes both dbo.users.RoleId and the denormalized dbo.users.role
-- text column (see routes/users.js PUT /:id) — but that same
-- reassignment was never applied on the live server, since there is
-- no sync mechanism between the two independently administered
-- databases. This script brings the live server's role assignments
-- in line with the current local dev state for the specific accounts
-- confirmed mismatched by screenshot comparison:
--   engineer@civilier.com        user -> Engineer
--   kuntal@civilier.in           user -> Accountant
--   mainab@civillier.in          user -> Accountant
--   rohit@civilier.in            user -> Accountant
--
-- Idempotent: creates the Engineer/Accountant Role rows only if they
-- don't already exist, and only updates users whose current role
-- actually differs from the intended one.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE LOWER(RName) = 'engineer')
    INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy)
    VALUES ('Engineer', 'ENG', 'Site engineer', 'system');

IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE LOWER(RName) = 'accountant')
    INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy)
    VALUES ('Accountant', 'ACC', 'Accountant', 'system');

DECLARE @engRoleId INT = (SELECT RId FROM dbo.Role WHERE LOWER(RName) = 'engineer');
DECLARE @accRoleId INT = (SELECT RId FROM dbo.Role WHERE LOWER(RName) = 'accountant');

UPDATE dbo.users
SET RoleId = @engRoleId, role = 'Engineer'
WHERE LOWER(email) = 'engineer@civilier.com' AND RoleId <> @engRoleId;

UPDATE dbo.users
SET RoleId = @accRoleId, role = 'Accountant'
WHERE LOWER(email) IN ('kuntal@civilier.in', 'mainab@civillier.in', 'rohit@civilier.in')
  AND RoleId <> @accRoleId;

-- Verify
SELECT u.id, u.name, u.email, u.RoleId, r.RName AS RoleName, u.role AS RoleTextColumn
FROM dbo.users u
LEFT JOIN dbo.Role r ON r.RId = u.RoleId
WHERE LOWER(u.email) IN (
  'engineer@civilier.com', 'kuntal@civilier.in', 'mainab@civillier.in', 'rohit@civilier.in'
)
ORDER BY u.id;
