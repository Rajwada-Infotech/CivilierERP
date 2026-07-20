-- Migration 018: Add new columns to dbo.enterprise
-- Run: node run-migration.cjs 018-enterprise-new-fields.sql

USE [CivilierERP]; -- Update if your DB name differs

-- short_name
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'short_name')
  ALTER TABLE dbo.enterprise ADD short_name NVARCHAR(100) NULL;

-- entity_type: "Enterprise" | "Company" | "Business Unit"
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'entity_type')
  ALTER TABLE dbo.enterprise ADD entity_type NVARCHAR(50) NULL;

-- start_date
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'start_date')
  ALTER TABLE dbo.enterprise ADD start_date DATE NULL;

-- start_fin_year
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'start_fin_year')
  ALTER TABLE dbo.enterprise ADD start_fin_year NVARCHAR(20) NULL;

-- latitude / longitude
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'latitude')
  ALTER TABLE dbo.enterprise ADD latitude DECIMAL(10,7) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'longitude')
  ALTER TABLE dbo.enterprise ADD longitude DECIMAL(10,7) NULL;

-- address_line2
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'address_line2')
  ALTER TABLE dbo.enterprise ADD address_line2 NVARCHAR(500) NULL;

-- city / state / country / pincode
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'city')
  ALTER TABLE dbo.enterprise ADD city NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'state')
  ALTER TABLE dbo.enterprise ADD state NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'country')
  ALTER TABLE dbo.enterprise ADD country NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'pincode')
  ALTER TABLE dbo.enterprise ADD pincode NVARCHAR(20) NULL;

-- website
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'website')
  ALTER TABLE dbo.enterprise ADD website NVARCHAR(300) NULL;

-- gst_issue_date
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'gst_issue_date')
  ALTER TABLE dbo.enterprise ADD gst_issue_date DATE NULL;

-- tan
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'tan')
  ALTER TABLE dbo.enterprise ADD tan NVARCHAR(20) NULL;

-- rera_no
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'rera_no')
  ALTER TABLE dbo.enterprise ADD rera_no NVARCHAR(100) NULL;

-- rera_date
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'rera_date')
  ALTER TABLE dbo.enterprise ADD rera_date DATE NULL;

-- trade_license
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'trade_license')
  ALTER TABLE dbo.enterprise ADD trade_license NVARCHAR(200) NULL;

-- fiscal_year_start
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'fiscal_year_start')
  ALTER TABLE dbo.enterprise ADD fiscal_year_start NVARCHAR(20) NULL;

-- cost_center / profit_center
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'cost_center')
  ALTER TABLE dbo.enterprise ADD cost_center NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'profit_center')
  ALTER TABLE dbo.enterprise ADD profit_center NVARCHAR(100) NULL;

PRINT 'Migration 018 complete. Verify: SELECT TOP 1 * FROM dbo.enterprise';
