IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'CompanyMaster' AND xtype = 'U')
BEGIN
  CREATE TABLE dbo.CompanyMaster (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    Code NVARCHAR(50) NULL,
    Name NVARCHAR(255) NULL,
    LegalName NVARCHAR(255) NULL,
    ShortName NVARCHAR(100) NULL,
    Type NVARCHAR(100) NULL,
    Industry NVARCHAR(100) NULL,
    IncorporationDate DATE NULL,
    CIN NVARCHAR(50) NULL,
    PAN NVARCHAR(20) NULL,
    TAN NVARCHAR(20) NULL,
    GST NVARCHAR(20) NULL,
    GSTType NVARCHAR(50) NULL,
    GSTDate DATE NULL,
    TradeLicenseNo NVARCHAR(100) NULL,
    TradeLicenseDate DATE NULL,
    RegisteredAddress NVARCHAR(500) NULL,
    City NVARCHAR(100) NULL,
    State NVARCHAR(100) NULL,
    Country NVARCHAR(100) NULL DEFAULT 'India',
    Pincode NVARCHAR(10) NULL,
    Phone NVARCHAR(30) NULL,
    Fax NVARCHAR(30) NULL,
    Email NVARCHAR(200) NULL,
    Website NVARCHAR(255) NULL,
    AuthorizedCapital DECIMAL(18,2) NULL,
    PaidUpCapital DECIMAL(18,2) NULL,
    Currency NVARCHAR(10) NULL DEFAULT 'INR',
    FiscalYearStart NVARCHAR(20) NULL DEFAULT 'April',
    AuditorName NVARCHAR(200) NULL,
    IsActive BIT NOT NULL DEFAULT 1,
    Remarks NVARCHAR(500) NULL,
    LogoUrl NVARCHAR(MAX) NULL,
    IsDeleted BIT NOT NULL DEFAULT 0,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    UpdatedAt DATETIME2 NULL
  );

  CREATE INDEX IX_CompanyMaster_IsDeleted_CreatedAt
    ON dbo.CompanyMaster(IsDeleted, CreatedAt DESC);
END
