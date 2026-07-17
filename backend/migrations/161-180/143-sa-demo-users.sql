-- 04-sa-demo-users.sql
-- Seeds demo SA users and wires team membership.
-- Passwords (bcrypt cost=10):
--   marketing.head@civilier.com → Marketing@123
--   sales.lead@civilier.com     → SalesLead@123
--   sales.sp1@civilier.com      → SalesSP1@123
--   sales.sp2@civilier.com      → SalesSP2@123
-- Idempotent: all inserts guarded by NOT EXISTS on email.

DECLARE @MhdRoleId INT = (SELECT RId FROM dbo.Role WHERE RName = 'marketing_head');
DECLARE @StlRoleId INT = (SELECT RId FROM dbo.Role WHERE RName = 'sales_team_lead');
DECLARE @SpRoleId  INT = (SELECT RId FROM dbo.Role WHERE RName = 'sales_person');

IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE email = 'marketing.head@civilier.com')
  INSERT INTO dbo.Users (name, email, password, RoleId, role, created_datetime, discontinue, can_accept_tickets)
  VALUES ('Marketing Head', 'marketing.head@civilier.com',
          '$2b$10$MjBYm4ZXUCka7vxI4D8BneG4L9Kutq9q8b0lEcIliA/OC2usoIX0.',
          @MhdRoleId, 'marketing_head', GETDATE(), 0, 0);

IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE email = 'sales.lead@civilier.com')
  INSERT INTO dbo.Users (name, email, password, RoleId, role, created_datetime, discontinue, can_accept_tickets)
  VALUES ('Sales Team Lead', 'sales.lead@civilier.com',
          '$2b$10$NmuXiXUD7XR15l49fPcJpOKj2sbvpZ35g8CJPUWISYJUiTSHN08IC',
          @StlRoleId, 'sales_team_lead', GETDATE(), 0, 0);

IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE email = 'sales.sp1@civilier.com')
  INSERT INTO dbo.Users (name, email, password, RoleId, role, created_datetime, discontinue, can_accept_tickets)
  VALUES ('Sales Person 1', 'sales.sp1@civilier.com',
          '$2b$10$/Lavaw.zuLsWIX0VefBkNO0ihOI/F6WvaaV43Lk8TUuytp53xNuTq',
          @SpRoleId, 'sales_person', GETDATE(), 0, 0);

IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE email = 'sales.sp2@civilier.com')
  INSERT INTO dbo.Users (name, email, password, RoleId, role, created_datetime, discontinue, can_accept_tickets)
  VALUES ('Sales Person 2', 'sales.sp2@civilier.com',
          '$2b$10$EfIcMhmNasd16D33AHtHUetrgo0NCNOtylCQVL/g30N/ea4se1wWK',
          @SpRoleId, 'sales_person', GETDATE(), 0, 0);

-- Wire both SPs under the team lead
DECLARE @TlId  INT = (SELECT id FROM dbo.Users WHERE email = 'sales.lead@civilier.com');
DECLARE @Sp1Id INT = (SELECT id FROM dbo.Users WHERE email = 'sales.sp1@civilier.com');
DECLARE @Sp2Id INT = (SELECT id FROM dbo.Users WHERE email = 'sales.sp2@civilier.com');

IF NOT EXISTS (SELECT 1 FROM dbo.SaSalesTeam WHERE TeamLeadUserId = @TlId AND MemberUserId = @Sp1Id)
  INSERT INTO dbo.SaSalesTeam (TeamLeadUserId, MemberUserId, IsActive) VALUES (@TlId, @Sp1Id, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.SaSalesTeam WHERE TeamLeadUserId = @TlId AND MemberUserId = @Sp2Id)
  INSERT INTO dbo.SaSalesTeam (TeamLeadUserId, MemberUserId, IsActive) VALUES (@TlId, @Sp2Id, 1);
GO

PRINT '04-sa-demo-users: done';
