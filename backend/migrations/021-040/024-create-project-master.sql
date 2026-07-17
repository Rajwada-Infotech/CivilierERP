IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'ProjectMaster' AND xtype = 'U')
BEGIN
  CREATE TABLE dbo.ProjectMaster (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    EnterpriseId INT NULL,
    Code NVARCHAR(50) NULL,
    Name NVARCHAR(255) NULL,
    ShortName NVARCHAR(100) NULL,
    Type NVARCHAR(100) NULL,
    BusinessUnit NVARCHAR(200) NULL,
    ClientName NVARCHAR(200) NULL,
    ClientCode NVARCHAR(50) NULL,
    TeamSize INT NULL,
    StartDate DATE NULL,
    EndDate DATE NULL,
    Currency NVARCHAR(10) NULL DEFAULT 'INR',
    Status NVARCHAR(50) NULL DEFAULT 'Planning',
    Priority NVARCHAR(50) NULL DEFAULT 'Medium',
    Location NVARCHAR(255) NULL,
    Description NVARCHAR(MAX) NULL,
    Remarks NVARCHAR(500) NULL,
    IsActive BIT NOT NULL DEFAULT 1,
    ProjectImage NVARCHAR(MAX) NULL,
    IsDeleted BIT NOT NULL DEFAULT 0,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    UpdatedAt DATETIME2 NULL
  );

  CREATE INDEX IX_ProjectMaster_IsDeleted_CreatedAt
    ON dbo.ProjectMaster(IsDeleted, CreatedAt DESC);
  CREATE INDEX IX_ProjectMaster_EnterpriseId ON dbo.ProjectMaster(EnterpriseId);
END
