-- Migration 049: Covering indexes for remaining slow endpoints
-- purchase-orders (7145ms), expense-booking (3625ms), hsn (3205ms),
-- cheque-master (3423ms), user-activity (2548ms), fin-year (1854ms)
-- All conditional — safe to re-run.

-- ─── PurchaseOrders ───────────────────────────────────────────────────────────
-- GET /api/purchase-orders paginates ORDER BY PurchaseOrderID DESC with
-- COUNT(*) OVER() and four LEFT JOINs. Needs:
--   1. An index on PurchaseOrderID DESC so the paginated seek is cheap.
--   2. FK-side indexes so the LEFT JOINs are lookups, not scans.

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PO_ID_Covering'
    AND object_id = OBJECT_ID('dbo.PurchaseOrders')
)
CREATE INDEX IX_PO_ID_Covering
  ON dbo.PurchaseOrders (PurchaseOrderID DESC)
  INCLUDE (PurchaseOrderNo, PODate, ExpectedDeliveryDate, SupplierID,
           CompanyId, ProjectId, ItemDescription, Quantity, Unit, Rate,
           SubtotalAmount, TotalAmount, HsnCode, GstType, GstRate,
           PaymentTerms, Remarks, Status, CreatedBy, CreatedAt, UpdatedAt,
           ApprovedBy, ApprovedAt, DocTypeId, DocNo, ParentDocNo,
           RootExBDocNo, fy_id, SequenceNo, Discount, GST,
           SourceWOId, SourceWODocNo);

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PO_SourceWOId'
    AND object_id = OBJECT_ID('dbo.PurchaseOrders')
)
CREATE INDEX IX_PO_SourceWOId
  ON dbo.PurchaseOrders (SourceWOId)
  WHERE SourceWOId IS NOT NULL;

-- ─── ExpenseBooking ───────────────────────────────────────────────────────────
-- GET /api/expense-booking paginates ORDER BY Eid DESC.
-- The TRY_CAST(EProjectName AS INT) in the JOIN was already fixed in the route;
-- this index covers the paginated scan.

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_ExpenseBooking_Eid_Covering'
    AND object_id = OBJECT_ID('dbo.ExpenseBooking')
)
CREATE INDEX IX_ExpenseBooking_Eid_Covering
  ON dbo.ExpenseBooking (Eid DESC)
  INCLUDE (EProjectName, EDocumentType, EDocDate, EAmount, ENetAmount,
           ECgstRate, ESgstRate, EDocNo, EEmiPayment, EInstallmentCount,
           EEmiAmount, EEmiStartDate, EReminder, ERemarks, EStatus,
           ECreatedAt, EUpdatedAt, ECompanyId, EDocTypeId, EFinYear,
           ECreatedBy, ESourceType, ESourceId, EName, ETCId, ETCName);

-- JOIN target: enterprise.id (used by both CompanyId and projected EProjectName)
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_Enterprise_Id_Name'
    AND object_id = OBJECT_ID('dbo.enterprise')
)
CREATE INDEX IX_Enterprise_Id_Name
  ON dbo.enterprise (id)
  INCLUDE (name, business_type);

-- ─── HSN ──────────────────────────────────────────────────────────────────────
-- SELECT all columns — small table but no explicit ordering index.

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_HSN_HCode'
    AND object_id = OBJECT_ID('dbo.HSN')
)
CREATE INDEX IX_HSN_HCode
  ON dbo.HSN (HCode)
  INCLUDE (HDescription, HShortDescription, HCGST, HSGST, HIGST,
           HStatus, HIsEdited, CreatedBy, CreatedAt, UpdatedBy, UpdatedAt,
           ApprovedBy, ApprovedAt);

-- ─── ChequeMaster ─────────────────────────────────────────────────────────────
-- SELECT with several JOINs — needs covering index on CId DESC.

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_ChequeMaster_CId_Covering'
    AND object_id = OBJECT_ID('dbo.ChequeMaster')
)
CREATE INDEX IX_ChequeMaster_CId_Covering
  ON dbo.ChequeMaster (CId DESC)
  INCLUDE (CompanyId, BankId, AccountNumber, IFSCCode,
           ChequeLotNumber, ChequeStartNumber, ChequeEndNumber,
           Status, CreatedBy, UpdatedBy, CreatedAt, UpdatedAt);

-- ─── UserActivityLog ──────────────────────────────────────────────────────────
-- GET /api/user-activity paginates ORDER BY CreatedAt DESC with period/role filters.

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_UserActivityLog_CreatedAt_Covering'
    AND object_id = OBJECT_ID('dbo.UserActivityLog')
)
CREATE INDEX IX_UserActivityLog_CreatedAt_Covering
  ON dbo.UserActivityLog (CreatedAt DESC)
  INCLUDE (Id, UserId, UserName, UserEmail, UserRole, EventType,
           IpAddress, DeviceInfo, DeviceFingerprint,
           ActionType, Resource, Details,
           SessionId, SessionDuration, RequestMethod, RequestUrl);

-- Period filter uses CreatedAt range — above index covers it.
-- Role filter: WHERE UserRole = ?
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_UserActivityLog_Role_CreatedAt'
    AND object_id = OBJECT_ID('dbo.UserActivityLog')
)
CREATE INDEX IX_UserActivityLog_Role_CreatedAt
  ON dbo.UserActivityLog (UserRole, CreatedAt DESC)
  INCLUDE (Id, UserId, UserName, UserEmail, EventType, ActionType, Resource);

-- ─── FinYear ──────────────────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_FinYear_FId'
    AND object_id = OBJECT_ID('dbo.FinYear')
)
CREATE INDEX IX_FinYear_FId
  ON dbo.FinYear (FId)
  INCLUDE (FName, FStartDate, FEndDate, FStatus, FisLocked,
           FCreatedBy, FCreatedAt, FUpdatedBy, FUpdatedAt);

-- ─── AccountHeadMaster ────────────────────────────────────────────────────────
-- Joined by LHeadId in PO, GRN, WO, ChequeMaster, etc. If not already indexed.

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_AccountHeadMaster_LHeadId_Name'
    AND object_id = OBJECT_ID('dbo.AccountHeadMaster')
)
BEGIN
  IF COL_LENGTH('dbo.AccountHeadMaster', 'LHeadShortName') IS NOT NULL
     AND COL_LENGTH('dbo.AccountHeadMaster', 'LGroupId') IS NOT NULL
    CREATE INDEX IX_AccountHeadMaster_LHeadId_Name
      ON dbo.AccountHeadMaster (LHeadId)
      INCLUDE (LHeadName, LHeadShortName, LGroupId);
  ELSE IF COL_LENGTH('dbo.AccountHeadMaster', 'LHeadShortName') IS NOT NULL
    CREATE INDEX IX_AccountHeadMaster_LHeadId_Name
      ON dbo.AccountHeadMaster (LHeadId)
      INCLUDE (LHeadName, LHeadShortName);
  ELSE IF COL_LENGTH('dbo.AccountHeadMaster', 'LGroupId') IS NOT NULL
    CREATE INDEX IX_AccountHeadMaster_LHeadId_Name
      ON dbo.AccountHeadMaster (LHeadId)
      INCLUDE (LHeadName, LGroupId);
  ELSE
    CREATE INDEX IX_AccountHeadMaster_LHeadId_Name
      ON dbo.AccountHeadMaster (LHeadId)
      INCLUDE (LHeadName);
END;

-- ─── TypeOfDoc ────────────────────────────────────────────────────────────────
-- Joined by TypeOfDocId in PO, WO, GRN, ExpenseBooking.

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_TypeOfDoc_Id_Covering'
    AND object_id = OBJECT_ID('dbo.TypeOfDoc')
)
BEGIN
  IF COL_LENGTH('dbo.TypeOfDoc', 'ModuleTag') IS NOT NULL
    CREATE INDEX IX_TypeOfDoc_Id_Covering
      ON dbo.TypeOfDoc (TypeOfDocId)
      INCLUDE (Prefix, Description, ModuleTag);
  ELSE
    CREATE INDEX IX_TypeOfDoc_Id_Covering
      ON dbo.TypeOfDoc (TypeOfDocId)
      INCLUDE (Prefix, Description);
END;
