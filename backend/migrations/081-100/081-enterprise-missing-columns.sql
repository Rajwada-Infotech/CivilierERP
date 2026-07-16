-- Migration 081: Add missing columns to dbo.enterprise
-- Adds: gst_no, pan_no, contact_person, phone
-- These are referenced in GET /api/enterprises but were never formally migrated.

-- gst_no
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'gst_no'
)
  ALTER TABLE dbo.enterprise ADD gst_no NVARCHAR(20) NULL;
GO

-- pan_no  
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'pan_no'
)
  ALTER TABLE dbo.enterprise ADD pan_no NVARCHAR(20) NULL;
GO

-- contact_person
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'contact_person'
)
  ALTER TABLE dbo.enterprise ADD contact_person NVARCHAR(200) NULL;
GO

-- phone (separate from phone_number — used as a secondary/mobile contact)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'phone'
)
  ALTER TABLE dbo.enterprise ADD phone NVARCHAR(20) NULL;
GO

-- Bump cache so the next GET /api/enterprises hits the DB fresh
-- (no SQL needed — handled by bumpCacheVersion in enterprise.js on restart)

PRINT '081-enterprise-missing-columns applied: gst_no, pan_no, contact_person, phone added to dbo.enterprise';
GO
