-- Migration 082: Add remaining missing columns to dbo.enterprise
-- Fixes: SELECT query in GET /api/enterprises failing with "Invalid column name"
-- when these columns don't exist, returning 0 records to the Enterprise page.

-- address_line3
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'address_line3')
  ALTER TABLE dbo.enterprise ADD address_line3 NVARCHAR(500) NULL;
GO

-- fax
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'fax')
  ALTER TABLE dbo.enterprise ADD fax NVARCHAR(50) NULL;
GO

-- end_date
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'end_date')
  ALTER TABLE dbo.enterprise ADD end_date DATE NULL;
GO

-- auditor_name
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'auditor_name')
  ALTER TABLE dbo.enterprise ADD auditor_name NVARCHAR(200) NULL;
GO

-- authorized_capital
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'authorized_capital')
  ALTER TABLE dbo.enterprise ADD authorized_capital DECIMAL(18,2) NULL;
GO

-- paid_up_capital
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'paid_up_capital')
  ALTER TABLE dbo.enterprise ADD paid_up_capital DECIMAL(18,2) NULL;
GO

-- client_name
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'client_name')
  ALTER TABLE dbo.enterprise ADD client_name NVARCHAR(200) NULL;
GO

-- client_code
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'client_code')
  ALTER TABLE dbo.enterprise ADD client_code NVARCHAR(50) NULL;
GO

-- team_size
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'team_size')
  ALTER TABLE dbo.enterprise ADD team_size INT NULL;
GO

-- jv_enabled
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'jv_enabled')
  ALTER TABLE dbo.enterprise ADD jv_enabled BIT NULL DEFAULT 0;
GO

-- jv_company_name
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'jv_company_name')
  ALTER TABLE dbo.enterprise ADD jv_company_name NVARCHAR(200) NULL;
GO

-- remarks
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'remarks')
  ALTER TABLE dbo.enterprise ADD remarks NVARCHAR(MAX) NULL;
GO

-- tds_limit
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'tds_limit')
  ALTER TABLE dbo.enterprise ADD tds_limit DECIMAL(18,2) NULL;
GO

-- description (in case it's also missing)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'description')
  ALTER TABLE dbo.enterprise ADD description NVARCHAR(MAX) NULL;
GO

PRINT '082-enterprise-extra-columns applied: all missing enterprise columns added.';
GO
