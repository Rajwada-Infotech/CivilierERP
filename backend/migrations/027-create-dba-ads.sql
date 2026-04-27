IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'DbaAds' AND xtype = 'U')
BEGIN
  CREATE TABLE dbo.DbaAds (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    tenant_id NVARCHAR(100) NULL,
    tenant_name NVARCHAR(255) NULL,
    title NVARCHAR(255) NOT NULL,
    description NVARCHAR(MAX) NULL,
    budget DECIMAL(18,2) NOT NULL DEFAULT 0,
    spent DECIMAL(18,2) NOT NULL DEFAULT 0,
    impressions INT NOT NULL DEFAULT 0,
    clicks INT NOT NULL DEFAULT 0,
    status NVARCHAR(20) NOT NULL DEFAULT 'active',
    start_date DATE NULL,
    end_date DATE NULL,
    category NVARCHAR(100) NULL,
    creative_type NVARCHAR(50) NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    updated_at DATETIME2 NULL
  );

  CREATE INDEX IX_DbaAds_Status_CreatedAt
    ON dbo.DbaAds(status, created_at DESC);
END
