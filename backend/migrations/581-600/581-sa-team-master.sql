-- 581-sa-team-master.sql
-- Teams become their own record: "Team A, led by X, members Y and Z".
-- Until now a team only existed implicitly as SaSalesTeam (lead -> member)
-- rows, with no name and nothing to create, edit or delete.
--
--   1. dbo.SaTeam — Name, TeamLeadUserId, IsActive. One active team per lead,
--      active team names unique.
--   2. dbo.SaSalesTeam.TeamId — which team a membership row belongs to.
--      TeamLeadUserId stays: every lead-scope query reads it.
--   3. UQ_SaSalesTeam_Member was UNIQUE(MemberUserId) over ALL rows, inactive
--      included — so re-adding or transferring anyone who had ever been in a
--      team failed on insert. Replaced by a filtered unique index (active rows
--      only): still one team per person at a time.
--   4. Every active team lead gets a team ("<name>'s team") and their current
--      members are linked to it, so nothing changes for existing data.
-- Idempotent: every step is guarded.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaTeam' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SaTeam (
    Id             INT           IDENTITY(1,1) PRIMARY KEY,
    Name           NVARCHAR(100) NOT NULL,
    TeamLeadUserId INT           NOT NULL,
    IsActive       BIT           NOT NULL CONSTRAINT DF_SaTeam_IsActive  DEFAULT (1),
    CreatedBy      INT           NULL,
    CreatedAt      DATETIME2(3)  NOT NULL CONSTRAINT DF_SaTeam_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy      INT           NULL,
    UpdatedAt      DATETIME2(3)  NULL
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_SaTeam_ActiveLead' AND object_id = OBJECT_ID('dbo.SaTeam'))
  CREATE UNIQUE INDEX UX_SaTeam_ActiveLead ON dbo.SaTeam(TeamLeadUserId) WHERE IsActive = 1;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_SaTeam_ActiveName' AND object_id = OBJECT_ID('dbo.SaTeam'))
  CREATE UNIQUE INDEX UX_SaTeam_ActiveName ON dbo.SaTeam(Name) WHERE IsActive = 1;
GO

IF COL_LENGTH('dbo.SaSalesTeam', 'TeamId') IS NULL
  ALTER TABLE dbo.SaSalesTeam ADD TeamId INT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'UQ_SaSalesTeam_Member' AND parent_object_id = OBJECT_ID('dbo.SaSalesTeam'))
  ALTER TABLE dbo.SaSalesTeam DROP CONSTRAINT UQ_SaSalesTeam_Member;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_SaSalesTeam_ActiveMember' AND object_id = OBJECT_ID('dbo.SaSalesTeam'))
  CREATE UNIQUE INDEX UX_SaSalesTeam_ActiveMember ON dbo.SaSalesTeam(MemberUserId) WHERE IsActive = 1;
GO

-- Seed one team per active team lead that has none.
INSERT INTO dbo.SaTeam (Name, TeamLeadUserId)
SELECT LEFT(u.name, 92) + N'''s team', u.id
FROM dbo.Users u
JOIN dbo.Role r ON r.RId = u.RoleId
WHERE LOWER(r.RName) = N'sales_team_lead' AND u.discontinue = 0
  AND NOT EXISTS (SELECT 1 FROM dbo.SaTeam t WHERE t.TeamLeadUserId = u.id AND t.IsActive = 1);
GO

-- Link existing active memberships to their lead's team.
UPDATE st
SET TeamId = t.Id
FROM dbo.SaSalesTeam st
JOIN dbo.SaTeam t ON t.TeamLeadUserId = st.TeamLeadUserId AND t.IsActive = 1
WHERE st.IsActive = 1 AND st.TeamId IS NULL;
GO
