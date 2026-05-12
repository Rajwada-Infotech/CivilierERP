-- Migration 039: Project Master — address_line3 + Joint Venture columns
-- Adds three columns to dbo.enterprise used exclusively by business_type = 'P' rows.
-- Safe to run multiple times (all guarded with IF NOT EXISTS).

-- address_line3: third address line for project location
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'dbo.enterprise') AND name = N'address_line3'
)
  ALTER TABLE dbo.enterprise ADD address_line3 NVARCHAR(500) NULL;
GO

-- jv_enabled: Joint Venture toggle (0 = disabled, 1 = enabled)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'dbo.enterprise') AND name = N'jv_enabled'
)
  ALTER TABLE dbo.enterprise ADD jv_enabled BIT NOT NULL DEFAULT 0;
GO

-- jv_company_name: manually entered JV partner name (only relevant when jv_enabled = 1)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'dbo.enterprise') AND name = N'jv_company_name'
)
  ALTER TABLE dbo.enterprise ADD jv_company_name NVARCHAR(255) NULL;
GO

PRINT '039-project-master-address-jv applied successfully.';
GO
