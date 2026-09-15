-- Migration 426: dbo.FeatureAnnouncement — drives the "New: X just
-- launched" badge on the Login page dynamically instead of a hardcoded
-- string in Login.tsx.
--
-- Row is added going forward whenever a genuinely new, marquee-worthy
-- user-facing feature ships (not every bug fix) — typically as part of
-- that feature's own migration, or a standalone one like this pattern.
-- GET /api/feature-announcement returns the latest row, but only while
-- it's within the auto-hide window (see routes/featureAnnouncement.js),
-- so a forgotten announcement doesn't linger forever.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID('dbo.FeatureAnnouncement'))
BEGIN
  CREATE TABLE dbo.FeatureAnnouncement (
    AnnouncementId INT IDENTITY(1,1) PRIMARY KEY,
    Title          NVARCHAR(300) NOT NULL,
    LaunchedAt     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CreatedBy      NVARCHAR(150) NULL
  );

  INSERT INTO dbo.FeatureAnnouncement (Title, CreatedBy)
  VALUES ('L1 Chart & Supplier Portal just launched', 'migration');

  PRINT 'Created dbo.FeatureAnnouncement and seeded the current announcement';
END
ELSE
  PRINT 'dbo.FeatureAnnouncement already exists — skipped.';
GO
