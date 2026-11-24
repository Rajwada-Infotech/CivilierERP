-- Migration 717: residents' complaints about security guards (Civilier Security app).
-- A resident raises a complaint about a guard (or "not sure who") at a gate of their project, optionally about one
-- visitor request; security admins review it (open -> in review -> resolved / dismissed) with a note the resident sees.
-- Also gives the Security Super Admin role its default rights on the five security-* pages (where it has none yet).
-- Safe to re-run.

IF OBJECT_ID('dbo.SecurityComplaint', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SecurityComplaint (
    ComplaintId      INT IDENTITY(1,1) PRIMARY KEY,
    ProjectId        INT             NOT NULL,
    CustomerId       INT             NOT NULL,   -- the resident who raised it (dbo.CrmCustomer.Id)
    Block            NVARCHAR(50)    NOT NULL CONSTRAINT DF_SecurityComplaint_Block DEFAULT (N''),
    FlatNo           NVARCHAR(50)    NOT NULL,
    GuardUserId      INT             NULL,       -- NULL: the resident doesn't know which guard
    GateId           INT             NULL,
    RequestId        INT             NULL,       -- the visitor request it is about, if any
    Category         NVARCHAR(30)    NOT NULL,
    Description      NVARCHAR(1000)  NOT NULL,
    IncidentAt       DATETIME2(0)    NULL,
    Status           NVARCHAR(12)    NOT NULL CONSTRAINT DF_SecurityComplaint_Status DEFAULT (N'OPEN'),
    AdminNote        NVARCHAR(1000)  NULL,
    HandledByUserId  INT             NULL,
    HandledAt        DATETIME2(0)    NULL,
    CreatedAt        DATETIME2(0)    NOT NULL CONSTRAINT DF_SecurityComplaint_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_SecurityComplaint_Status CHECK (Status IN (N'OPEN', N'IN_REVIEW', N'RESOLVED', N'DISMISSED')),
    CONSTRAINT CK_SecurityComplaint_Category CHECK (Category IN (N'RUDE', N'ABSENT', N'SLEEPING', N'LET_IN_WITHOUT_APPROVAL', N'DENIED_WRONGLY', N'SLOW', N'OTHER'))
  );
  CREATE INDEX IX_SecurityComplaint_Project ON dbo.SecurityComplaint (ProjectId, Status, CreatedAt DESC);
  CREATE INDEX IX_SecurityComplaint_Customer ON dbo.SecurityComplaint (CustomerId, CreatedAt DESC);
  CREATE INDEX IX_SecurityComplaint_Guard ON dbo.SecurityComplaint (GuardUserId, CreatedAt DESC);
END
GO

-- Default rights for the Security Super Admin role (found by name): every Civilier Security page, every action.
-- Only pages the role has no row for yet, so rights already set in Role Rights are left as they are.
DECLARE @ssa INT = (SELECT TOP 1 RId FROM dbo.Role WHERE LOWER(LTRIM(RTRIM(RName))) = N'security super admin');
IF @ssa IS NOT NULL
  INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
  SELECT @ssa, N'Maintenance', p.PageKey, 1, 1, 1, 1, 1, 1, 0
  FROM (VALUES (N'security-gates'), (N'security-guards'), (N'security-residents'), (N'security-live'), (N'security-geofences')) AS p (PageKey)
  WHERE NOT EXISTS (SELECT 1 FROM dbo.RoleRights rr WHERE rr.RoleId = @ssa AND rr.SubModule = p.PageKey);
GO

PRINT 'Migration 717: Security complaints.';
GO
