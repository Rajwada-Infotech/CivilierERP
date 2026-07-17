-- Migration 113: Drop legacy PAN and GST columns and true merge into pan_no and gst_no
--
-- This script:
-- 1. Merges data from b_sub_identity_type -> gst_no and pan -> pan_no
-- 2. Drops covering indexes that rely on the old columns
-- 3. Drops the pan and b_sub_identity_type columns
-- 4. Recreates the covering indexes using the new columns

PRINT '=== Migration 113: Dropping legacy PAN/GST columns ===';

-- 1. Safely migrate any existing data into the new columns
PRINT '1. Merging legacy data into pan_no and gst_no...';
UPDATE dbo.enterprise
SET 
  gst_no = COALESCE(gst_no, b_sub_identity_type),
  pan_no = COALESCE(pan_no, pan);
GO

-- 2. Drop existing covering indexes that reference the old columns
PRINT '2. Dropping old covering indexes...';
IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.enterprise') AND name = N'IX_enterprise_list_covering')
  DROP INDEX IX_enterprise_list_covering ON dbo.enterprise;
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.enterprise') AND name = N'IX_enterprise_C_covering')
  DROP INDEX IX_enterprise_C_covering ON dbo.enterprise;
GO

-- 3. Drop the legacy columns
PRINT '3. Dropping legacy columns pan and b_sub_identity_type...';
ALTER TABLE dbo.enterprise
DROP COLUMN pan, b_sub_identity_type;
GO

-- 4. Recreate the covering indexes using only the new columns
PRINT '4. Recreating covering indexes without legacy columns...';

-- IX_enterprise_list_covering
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.enterprise') AND name = N'IX_enterprise_list_covering')
  CREATE NONCLUSTERED INDEX IX_enterprise_list_covering
    ON dbo.enterprise (business_type, discontinue, name)
    INCLUDE (
      id, short_name, business_identity, entity_type,
      belongs_to,
      address, address_line2, city, state, country, pincode,
      phone_number, email, website,
      pan_no, tan, cin, gst_type, gst_no, gst_issue_date, trade_license,
      currency, fiscal_year_start, start_date, date_of_entry
    );
GO

-- IX_enterprise_C_covering
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.enterprise') AND name = N'IX_enterprise_C_covering')
  CREATE NONCLUSTERED INDEX IX_enterprise_C_covering
    ON dbo.enterprise (business_type, name)
    INCLUDE (
      id, business_identity, description, short_name,
      entity_type, cr_code, date_of_establishment,
      cin, pan_no, tan, gst_type, gst_no, gst_issue_date,
      trade_license, rera_date,
      address, address_line2, city, state, country, pincode,
      phone_number, fax, email, website,
      authorized_capital, paid_up_capital, currency, fiscal_year_start,
      auditor_name, discontinue, remarks, logo, status, belongs_to
    );
GO

-- Update statistics
UPDATE STATISTICS dbo.enterprise;
GO

PRINT '=== Migration 113 COMPLETE ===';
GO
