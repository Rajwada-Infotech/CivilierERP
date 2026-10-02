-- Migration 526: per-activity discussion thread for Civil Work DPR's Work
-- Reporting ("Comments" tab). One thread per activity rung (it survives
-- rework attempts); only that activity's allocated engineers, its approvers
-- and super_admin may read or write it (enforced in the API, not here).
--
--   * Id is BIGINT and monotonic, so it doubles as the pagination / catch-up
--     cursor ("everything after Id N", "the 50 before Id N").
--   * ClientId makes a send idempotent: a retry after a dropped connection
--     returns the already-saved message instead of posting it twice.
-- Safe to re-run.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ActivityComment' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.ActivityComment (
    Id                          BIGINT IDENTITY(1,1) PRIMARY KEY,
    DependencyMasterActivityId  INT NOT NULL,
    AuthorUserId                INT NOT NULL,
    AuthorName                  NVARCHAR(200) NOT NULL,
    Body                        NVARCHAR(2000) NOT NULL,
    ClientId                    NVARCHAR(50) NULL,
    CreatedAt                   DATETIME2(3) NOT NULL CONSTRAINT DF_ActivityComment_CreatedAt DEFAULT SYSDATETIME(),
    CONSTRAINT FK_ActivityComment_Rung
      FOREIGN KEY (DependencyMasterActivityId) REFERENCES dbo.DependencyMasterActivity(Id) ON DELETE CASCADE
  );

  -- Every read is "this rung, ordered/compared by Id".
  CREATE INDEX IX_ActivityComment_Rung_Id ON dbo.ActivityComment (DependencyMasterActivityId, Id DESC);

  -- At most one row per (rung, author, ClientId) — the idempotency guard.
  CREATE UNIQUE INDEX UX_ActivityComment_Client
    ON dbo.ActivityComment (DependencyMasterActivityId, AuthorUserId, ClientId)
    WHERE ClientId IS NOT NULL;
END
GO

PRINT 'Migration 526: dbo.ActivityComment.';
GO
