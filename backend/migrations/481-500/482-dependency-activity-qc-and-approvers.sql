-- Migration 482: Civil Work DPR — QC assignees + per-assignment approver
-- config on the "Assign Engineers & Material" popup.
--
-- QC assignees: who will perform the quality check on this activity —
-- mirrors dbo.DependencyActivityEngineer exactly (same shape, same cascade),
-- just a different role. NOT the same table as dbo.DependencyActivityQc
-- (migration 479), which records an actual QC decision/checklist result
-- after the fact — this one is purely "who is assigned to do it".
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DependencyActivityQcAssignee' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.DependencyActivityQcAssignee (
    Id           INT IDENTITY(1,1) PRIMARY KEY,
    AssignmentId INT NOT NULL,
    QcUserId     INT NOT NULL,
    CONSTRAINT FK_DependencyActivityQcAssignee_Assignment
      FOREIGN KEY (AssignmentId) REFERENCES dbo.DependencyActivityAssignment(Id) ON DELETE CASCADE,
    CONSTRAINT FK_DependencyActivityQcAssignee_User
      FOREIGN KEY (QcUserId) REFERENCES dbo.users(id),
    CONSTRAINT UX_DependencyActivityQcAssignee_Assignment_User UNIQUE (AssignmentId, QcUserId)
  );
  CREATE INDEX IX_DependencyActivityQcAssignee_Assignment ON dbo.DependencyActivityQcAssignee(AssignmentId);
END
GO

-- Per-assignment approver config — replaces routing an engineer's own
-- assignment-confirmation through the shared Approval Inbox. Same JSON
-- shape as dbo.ApprovalWorkflows.LevelsData (src/pages/admin/ApprovalSetup.tsx's
-- ApprovalLevel[]: [{id, label, userIds:number[], mode:"all"|"any"}]) so the
-- mini editor embedded in this modal can reuse the same mental model —
-- "all" levels are sequential single/multi-approver steps, a final "any"
-- level lets one of several people approve. Scoped to THIS ONE assignment,
-- not a module-wide workflow — deliberately a plain column here rather than
-- a row in dbo.ApprovalWorkflows, which is resolved per-module globally
-- (approvalService.js's getWorkflow()) and has no per-record scoping.
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.DependencyActivityAssignment') AND name = 'ApprovalLevelsJson'
)
BEGIN
  ALTER TABLE dbo.DependencyActivityAssignment ADD ApprovalLevelsJson NVARCHAR(MAX) NULL;
END
GO

PRINT '482-dependency-activity-qc-and-approvers applied successfully.';
GO
