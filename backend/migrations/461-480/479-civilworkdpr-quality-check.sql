-- Migration 479: Civil Work DPR > Quality Check. QC inspects activities that
-- are In Progress, signs off the activity's checklist, and either Approves
-- it or sends it back for Rework. Every decision is kept as history.

IF OBJECT_ID('dbo.DependencyActivityQc', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.DependencyActivityQc (
    Id           INT IDENTITY(1,1) PRIMARY KEY,
    AssignmentId INT           NOT NULL,
    Decision     NVARCHAR(10)  NOT NULL,
    Remarks      NVARCHAR(1000) NULL,
    QcBy         NVARCHAR(200) NULL,
    QcAt         DATETIME2(3)  NOT NULL CONSTRAINT DF_DependencyActivityQc_QcAt DEFAULT SYSDATETIME(),
    CONSTRAINT CK_DependencyActivityQc_Decision CHECK (Decision IN ('APPROVED', 'REWORK')),
    CONSTRAINT FK_DependencyActivityQc_Assignment FOREIGN KEY (AssignmentId) REFERENCES dbo.DependencyActivityAssignment (Id)
  );
  CREATE INDEX IX_DependencyActivityQc_Assignment ON dbo.DependencyActivityQc (AssignmentId);
END
GO

IF OBJECT_ID('dbo.DependencyActivityQcCheck', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.DependencyActivityQcCheck (
    Id                     INT IDENTITY(1,1) PRIMARY KEY,
    QcId                   INT           NOT NULL,
    AssignmentCheckpointId INT           NULL,
    FieldName              NVARCHAR(200) NOT NULL,
    Passed                 BIT           NOT NULL,
    Note                   NVARCHAR(500) NULL,
    CONSTRAINT FK_DependencyActivityQcCheck_Qc FOREIGN KEY (QcId) REFERENCES dbo.DependencyActivityQc (Id)
  );
  CREATE INDEX IX_DependencyActivityQcCheck_Qc ON dbo.DependencyActivityQcCheck (QcId);
END
GO

INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'civilworkdpr-quality-check', 'Quality Check', 'Civil Work DPR', 'Civil Work DPR', 'view,edit', 15, 1, 'migration-479', SYSUTCDATETIME()
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = 'civilworkdpr-quality-check' AND pd.IsActive = 1
);
GO

PRINT '479-civilworkdpr-quality-check applied successfully.';
GO
