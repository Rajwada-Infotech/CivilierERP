IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'Signatures' AND xtype = 'U')
BEGIN
  CREATE TABLE dbo.Signatures (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    Name NVARCHAR(200) NOT NULL,
    Owner NVARCHAR(200) NULL,
    Status NVARCHAR(20) NOT NULL DEFAULT 'active',
    ImageData NVARCHAR(MAX) NULL,
    IsDeleted BIT NOT NULL DEFAULT 0,
    AddedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    UpdatedAt DATETIME2 NULL
  );

  CREATE INDEX IX_Signatures_IsDeleted_AddedAt
    ON dbo.Signatures(IsDeleted, AddedAt DESC);
END
