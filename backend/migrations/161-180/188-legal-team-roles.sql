-- ============================================================
-- Migration 188: Legal Team roles — legal_head, legal_person
-- Workflow spec: "LEGAL TEAM (A SENIOR USER LOGIN) -> A LEGAL PERSON WILL
-- ARRANGE/PREPARE THE PAPERS WORKS -> APPROVAL (SENIOR LOGIN IN LEGAL TEAM)".
-- Audit finding #3: no dedicated Legal role existed — agreement prep/approval
-- was gated only by the generic crm-agreements page right, open to any staff
-- member with that permission. This adds two real, scoped roles, mirroring
-- the sales_team_lead/sales_person pattern (backend/migrations/260628/141,
-- 143): DB Role rows + RoleRights baselines + demo users.
--
-- Scope: legal_head gets full CRUD on crm-agreements/crm-documents/
-- crm-legal-milestones/crm-noc/crm-sales-deed (+ view-only crm-dashboard,
-- crm-bookings for context) and is added as an APPROVER on crm-agreements in
-- approvalService.js's MODULE_APPROVER_ROLE_OVERRIDES (code change, not this
-- migration). legal_person (the drafter) gets create/edit on agreements/
-- documents/legal-milestones only — no NOC/Sale Deed, no approve rights.
-- Idempotent: roles guarded by NOT EXISTS; rights use DELETE + re-insert;
-- users guarded by NOT EXISTS on email.
-- ============================================================

-- ── Roles ────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE RName = 'legal_head')
  INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy, RCreatedAt)
  VALUES ('legal_head', 'LGH', 'Legal Head - senior approver for Agreement legal paperwork, NOC, Sale Deed', 'migration', SYSDATETIME());

IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE RName = 'legal_person')
  INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy, RCreatedAt)
  VALUES ('legal_person', 'LGP', 'Legal Person - drafts/prepares Agreement paperwork', 'migration', SYSDATETIME());
GO

-- ── Role Rights ──────────────────────────────────────────────
DECLARE @LghId INT = (SELECT RId FROM dbo.Role WHERE RName = 'legal_head');
DECLARE @LgpId INT = (SELECT RId FROM dbo.Role WHERE RName = 'legal_person');

DELETE FROM dbo.RoleRights WHERE RoleId = @LghId;
INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete) VALUES
  (@LghId, 'CRM', 'crm-dashboard',        1, 0, 0, 0),
  (@LghId, 'CRM', 'crm-bookings',         1, 0, 0, 0),
  (@LghId, 'CRM', 'crm-agreements',       1, 1, 1, 0),
  (@LghId, 'CRM', 'crm-documents',        1, 1, 1, 1),
  (@LghId, 'CRM', 'crm-legal-milestones', 1, 1, 1, 0),
  (@LghId, 'CRM', 'crm-noc',              1, 1, 1, 0),
  (@LghId, 'CRM', 'crm-sales-deed',       1, 1, 1, 0);

DELETE FROM dbo.RoleRights WHERE RoleId = @LgpId;
INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete) VALUES
  (@LgpId, 'CRM', 'crm-dashboard',        1, 0, 0, 0),
  (@LgpId, 'CRM', 'crm-bookings',         1, 0, 0, 0),
  (@LgpId, 'CRM', 'crm-agreements',       1, 1, 1, 0),
  (@LgpId, 'CRM', 'crm-documents',        1, 1, 1, 0),
  (@LgpId, 'CRM', 'crm-legal-milestones', 1, 1, 1, 0);
GO

-- ── Demo Users ───────────────────────────────────────────────
-- Passwords (bcrypt cost=10):
--   legal.head@civilier.com    → LegalHead@123
--   legal.person1@civilier.com → LegalP1@123
DECLARE @LghRoleId INT = (SELECT RId FROM dbo.Role WHERE RName = 'legal_head');
DECLARE @LgpRoleId INT = (SELECT RId FROM dbo.Role WHERE RName = 'legal_person');

IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE email = 'legal.head@civilier.com')
  INSERT INTO dbo.Users (name, email, password, RoleId, role, created_datetime, discontinue, can_accept_tickets)
  VALUES ('Legal Head', 'legal.head@civilier.com',
          '$2b$10$UCep/QVen6snO.p39o4iY.2/yIjZ4nmi7FP7ZHMzVHftC4VXbNR..',
          @LghRoleId, 'legal_head', GETDATE(), 0, 0);

IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE email = 'legal.person1@civilier.com')
  INSERT INTO dbo.Users (name, email, password, RoleId, role, created_datetime, discontinue, can_accept_tickets)
  VALUES ('Legal Person 1', 'legal.person1@civilier.com',
          '$2b$10$Zk46CUG4gyFgevEYyJH60epCiOEivv93E4UvAWP5FX6gf4Ky.bW2C',
          @LgpRoleId, 'legal_person', GETDATE(), 0, 0);
GO

PRINT '188-legal-team-roles: done';
