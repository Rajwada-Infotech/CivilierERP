-- Migration 040: Performance indexes — fixes 3-9 s response times
-- Addresses: /api/enterprises, /api/company-master, /api/project-master,
--            /api/purchase-orders, /api/work-orders
-- All statements are guarded — safe to re-run.

-- ── 1. enterprise: filter by business_type (used by ALL three slow routes) ────
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.enterprise') AND name = N'IX_enterprise_type_active'
)
  CREATE INDEX IX_enterprise_type_active
    ON dbo.enterprise(business_type, discontinue)
    INCLUDE (id, name, short_name, logo, business_identity, entity_type,
             address, address_line2, address_line3, city, state, pincode,
             latitude, longitude, date_of_entry);
GO

-- ── 2. PurchaseOrders: JOIN to enterprise on CompanyId / ProjectId ────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.PurchaseOrders') AND name = N'IX_PurchaseOrders_Company_Project'
)
  CREATE INDEX IX_PurchaseOrders_Company_Project
    ON dbo.PurchaseOrders(CompanyId, ProjectId);
GO

-- ── 3. WorkOrderHeader: JOIN to enterprise on CompanyId / ProjectId ───────────
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.WorkOrderHeader') AND name = N'IX_WorkOrderHeader_Company_Project'
)
  CREATE INDEX IX_WorkOrderHeader_Company_Project
    ON dbo.WorkOrderHeader(CompanyId, ProjectId);
GO

PRINT 'Migration 040 applied — enterprise + PO + WO indexes created.';
GO
