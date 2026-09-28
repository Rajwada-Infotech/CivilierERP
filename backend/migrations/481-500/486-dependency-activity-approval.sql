-- Migration 486: Civil Work DPR — the per-assignment approval workflow
-- (ApprovalLevelsJson, set in Work Allocation's mini Approval Setup)
-- actually gets enforced now. Once QC passes a Completed activity, it no
-- longer jumps straight to Status='APPROVED' if levels are configured —
-- it stays Completed until every level here is satisfied, and only then
-- flips to APPROVED. Each row is one named approver clearing one level.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DependencyActivityApproval' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.DependencyActivityApproval (
    Id             INT IDENTITY(1,1) PRIMARY KEY,
    AssignmentId   INT           NOT NULL,
    LevelId        NVARCHAR(50)  NOT NULL,
    LevelIndex     INT           NOT NULL,
    ApproverUserId INT           NOT NULL,
    ApprovedAt     DATETIME2(3)  NOT NULL CONSTRAINT DF_DependencyActivityApproval_ApprovedAt DEFAULT SYSDATETIME(),
    CONSTRAINT FK_DependencyActivityApproval_Assignment
      FOREIGN KEY (AssignmentId) REFERENCES dbo.DependencyActivityAssignment (Id),
    CONSTRAINT FK_DependencyActivityApproval_User
      FOREIGN KEY (ApproverUserId) REFERENCES dbo.users (id),
    CONSTRAINT UX_DependencyActivityApproval_Assignment_Level_User UNIQUE (AssignmentId, LevelId, ApproverUserId)
  );
  CREATE INDEX IX_DependencyActivityApproval_Assignment ON dbo.DependencyActivityApproval (AssignmentId);
END
GO

PRINT '486-dependency-activity-approval applied successfully.';
GO
