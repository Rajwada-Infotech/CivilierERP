-- Migration 048: Covering indexes for slow list endpoints
-- Targets: WorkOrderHeader, GoodsReceiptNotes, NewPayment, TDSMaster, Tasks
-- All indexes are conditional (IF NOT EXISTS) so re-running is safe.

-- ─── WorkOrderHeader ──────────────────────────────────────────────────────────
-- GET /api/work-orders paginates ORDER BY h.CreatedAt DESC.
-- The GROUP BY + COUNT(DISTINCT) on WorkOrderActivities was doing a full scan
-- because there was no index on WorkOrderActivities.WorkOrderHeaderId.

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_WorkOrderHeader_CreatedAt_Covering'
    AND object_id = OBJECT_ID('dbo.WorkOrderHeader')
)
CREATE INDEX IX_WorkOrderHeader_CreatedAt_Covering
  ON dbo.WorkOrderHeader (CreatedAt DESC)
  INCLUDE (Id, DocumentNumber, DocumentDate, TotalAmount, Status,
           CompanyId, ProjectId, ContractorId, SupplierId,
           Remarks, TermsAndConditions, CreatedBy, UpdatedBy,
           DocTypeId, DocNo, GST, UpdatedAt);

-- Speeds up the COUNT(DISTINCT a.Id) join on WorkOrderActivities
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_WorkOrderActivities_HeaderId'
    AND object_id = OBJECT_ID('dbo.WorkOrderActivities')
)
CREATE INDEX IX_WorkOrderActivities_HeaderId
  ON dbo.WorkOrderActivities (WorkOrderHeaderId)
  INCLUDE (Id);

-- ─── GoodsReceiptNotes ────────────────────────────────────────────────────────
-- GET /api/grns paginates ORDER BY grn.GRNID DESC.
-- The LEFT JOIN on PurchaseOrders (POID) and AccountHeadMaster (SupplierID)
-- were unindexed on the FK side of GRN.

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_GRN_GRNID_Covering'
    AND object_id = OBJECT_ID('dbo.GoodsReceiptNotes')
)
CREATE INDEX IX_GRN_GRNID_Covering
  ON dbo.GoodsReceiptNotes (GRNID DESC)
  INCLUDE (GRNNo, GRNDate, SupplierID, POID, Status, Remarks,
           CreatedDate, DocTypeId, DocNo, TotalAmount, GRNItems);

-- FK lookup: GRN → PurchaseOrders
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_GRN_POID'
    AND object_id = OBJECT_ID('dbo.GoodsReceiptNotes')
)
CREATE INDEX IX_GRN_POID
  ON dbo.GoodsReceiptNotes (POID)
  WHERE POID IS NOT NULL;

-- ─── NewPayment ───────────────────────────────────────────────────────────────
-- GET /api/new-payment paginates ORDER BY PPaymentID DESC.
-- COUNT(*) + paginated SELECT are both full scans without an index on the PK.

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_NewPayment_PaymentID_Covering'
    AND object_id = OBJECT_ID('dbo.NewPayment')
)
CREATE INDEX IX_NewPayment_PaymentID_Covering
  ON dbo.NewPayment (PPaymentID DESC)
  INCLUDE (PPaymentName, DocNo, PExpenseRef, PProject, PCompany, PBankName,
           PPaymentDate, PAmount, PPaymentMode, PStatus, CreatedAt);

-- Search filter: LIKE on PPaymentName / DocNo
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_NewPayment_PaymentName'
    AND object_id = OBJECT_ID('dbo.NewPayment')
)
CREATE INDEX IX_NewPayment_PaymentName
  ON dbo.NewPayment (PPaymentName)
  INCLUDE (PPaymentID, DocNo, PProject, PCompany, PBankName, PStatus);

-- ─── TDSMaster ────────────────────────────────────────────────────────────────
-- SELECT * FROM dbo.TDSMaster — small table, but no clustered index order hint.
-- Add a covering index so the query doesn't need a table scan + sort.

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_TDSMaster_TDSId'
    AND object_id = OBJECT_ID('dbo.TDSMaster')
)
CREATE INDEX IX_TDSMaster_TDSId
  ON dbo.TDSMaster (TDSId)
  INCLUDE (Nature, Name, Percentage, Status, CreatedAt, UpdatedAt);

-- ─── Tasks ────────────────────────────────────────────────────────────────────
-- GET /api/tasks — filter by AssignedTo / CreatedBy, ORDER BY CreatedAt DESC.

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_Tasks_CreatedAt_Covering'
    AND object_id = OBJECT_ID('dbo.Tasks')
)
CREATE INDEX IX_Tasks_CreatedAt_Covering
  ON dbo.Tasks (CreatedAt DESC)
  INCLUDE (Id, Title, Description, Module, Priority, Status,
           AssignedTo, CreatedBy, ReviewedBy,
           DueDate, QualityCriteria, ReminderSent,
           ClosedAt, ReviewedAt);

-- Non-admin filter: AssignedTo + CreatedBy
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_Tasks_AssignedTo_CreatedBy'
    AND object_id = OBJECT_ID('dbo.Tasks')
)
CREATE INDEX IX_Tasks_AssignedTo_CreatedBy
  ON dbo.Tasks (AssignedTo, CreatedBy, CreatedAt DESC)
  INCLUDE (Id, Title, Priority, Status, DueDate);

-- Reminders filter: Status + DueDate
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_Tasks_Status_DueDate'
    AND object_id = OBJECT_ID('dbo.Tasks')
)
CREATE INDEX IX_Tasks_Status_DueDate
  ON dbo.Tasks (Status, DueDate)
  INCLUDE (Id, Title, Priority, AssignedTo);

-- TaskComments FK lookup
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_TaskComments_TaskId'
    AND object_id = OBJECT_ID('dbo.TaskComments')
)
CREATE INDEX IX_TaskComments_TaskId
  ON dbo.TaskComments (TaskId, CreatedAt ASC)
  INCLUDE (Id, UserId, Text);

-- ─── RoleRights ───────────────────────────────────────────────────────────────
-- checkPermission does: WHERE RoleId=? AND Module=? AND SubModule=?
-- Now cached in-process but the first hit still needs a fast lookup.

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_RoleRights_RoleModule'
    AND object_id = OBJECT_ID('dbo.RoleRights')
)
CREATE INDEX IX_RoleRights_RoleModule
  ON dbo.RoleRights (RoleId, Module, SubModule)
  INCLUDE (CanView, CanAdd, CanEdit, CanDelete);
