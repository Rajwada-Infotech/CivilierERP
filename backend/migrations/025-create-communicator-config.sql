IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'CommunicatorConfig' AND xtype = 'U')
BEGIN
  CREATE TABLE dbo.CommunicatorConfig (
    ConfigId INT IDENTITY(1,1) PRIMARY KEY,
    Channel NVARCHAR(50) NOT NULL,
    ConfigJson NVARCHAR(MAX) NOT NULL DEFAULT '{}',
    IsActive BIT NOT NULL DEFAULT 1,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    UpdatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy NVARCHAR(100) NULL,
    CONSTRAINT UQ_CommunicatorConfig_Channel UNIQUE (Channel)
  );

  INSERT INTO dbo.CommunicatorConfig (Channel)
  VALUES ('email'), ('sms'), ('whatsapp');
END
