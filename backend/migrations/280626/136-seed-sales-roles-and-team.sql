-- 136-seed-sales-roles-and-team.sql
-- Seeds Sales Team Lead (STL) and Sales Person (SP) roles into dbo.Roles
-- Creates dbo.SaSalesTeam for dynamic team lead -> salesperson membership
-- Users are created via the Admin UI or run136.js seed script

IF NOT EXISTS (SELECT 1 FROM dbo.Roles WHERE RCode = ''STL'')
  INSERT INTO dbo.Roles(RCode,RName,RDesc,RCreatedBy,RCreatedAt)
  VALUES(''STL'',''Sales Team Lead'',''Sales Team Leader role'',''migration-136'',SYSDATETIME());

IF NOT EXISTS (SELECT 1 FROM dbo.Roles WHERE RCode = ''SP'')
  INSERT INTO dbo.Roles(RCode,RName,RDesc,RCreatedBy,RCreatedAt)
  VALUES(''SP'',''Sales Person'',''Sales Person role'',''migration-136'',SYSDATETIME());

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = ''SaSalesTeam'' AND schema_id = SCHEMA_ID(''dbo''))
BEGIN
  CREATE TABLE dbo.SaSalesTeam (
    Id             INT          IDENTITY(1,1) PRIMARY KEY,
    TeamLeadUserId INT          NOT NULL,
    MemberUserId   INT          NOT NULL,
    IsActive       BIT          NOT NULL CONSTRAINT DF_SaSalesTeam_IsActive DEFAULT (1),
    CreatedBy      INT          NULL,
    CreatedAt      DATETIME2(3) NOT NULL CONSTRAINT DF_SaSalesTeam_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedAt      DATETIME2(3) NULL,
    CONSTRAINT UQ_SaSalesTeam_Member UNIQUE (MemberUserId)
  );
  CREATE INDEX IX_SaSalesTeam_Lead ON dbo.SaSalesTeam(TeamLeadUserId, IsActive);
END
GO
PRINT ''Migration 136: Sales roles and SaSalesTeam done'';