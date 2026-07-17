-- Migration 152: Create dbo.Version table for tracking DB and app release versions

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID('dbo.Version'))
BEGIN
  CREATE TABLE dbo.Version (
    version_id          INT IDENTITY(1,1) PRIMARY KEY,
    tenant_id           INT           NOT NULL DEFAULT 1,
    db_version          NVARCHAR(50)  NOT NULL,
    application_version NVARCHAR(50)  NOT NULL,
    created_date        DATETIME2     NOT NULL DEFAULT SYSDATETIME()
  );

  -- Seed the initial version row
  INSERT INTO dbo.Version (tenant_id, db_version, application_version)
  VALUES (1, '152', '1.0.0');

  PRINT 'Created dbo.Version and seeded initial row';
END
