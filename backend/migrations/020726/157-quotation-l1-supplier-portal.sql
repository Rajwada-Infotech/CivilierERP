-- ============================================================
-- Migration 157: Quotation (QT) doc type, L1 Price Comparative
-- Chart tables, and Supplier Portal login support.
-- Safe to run multiple times.
-- ============================================================

SET NOCOUNT ON;
GO

-- ── 1. dbo.Role — add 'supplier' role ─────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE LOWER(RName) = 'supplier')
    INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy)
    VALUES ('supplier', 'SUP', 'External supplier portal user', 'system');
GO

-- ── 2. dbo.users — link supplier users to their AccountHeadMaster record ─────
IF COL_LENGTH('dbo.users', 'LinkedLHeadId') IS NULL
    ALTER TABLE dbo.users ADD LinkedLHeadId INT NULL;
GO

-- ── 3. dbo.Quotations (header) ────────────────────────────────────────────────
IF OBJECT_ID('dbo.Quotations', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Quotations (
        QuotationId       INT IDENTITY(1,1) PRIMARY KEY,
        DocNo             NVARCHAR(100)  NULL,
        DocTypeId         INT            NULL,
        CompanyId         INT            NULL,
        ProjectId         INT            NULL,
        FinYearId         INT            NULL,
        SourceMRId        INT            NULL,
        SourceMRDocNo     NVARCHAR(100)  NULL,
        DocDate           DATE           NOT NULL DEFAULT GETDATE(),
        DueDate           DATE           NULL,
        Remarks           NVARCHAR(MAX)  NULL,
        TermsConditionIds NVARCHAR(MAX)  NULL,
        Status            NVARCHAR(30)   NOT NULL DEFAULT 'Draft',
        CreatedBy         NVARCHAR(200)  NULL,
        UpdatedBy         NVARCHAR(200)  NULL,
        CreatedAt         DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        UpdatedAt         DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_Quotations_SourceMRId ON dbo.Quotations(SourceMRId) WHERE SourceMRId IS NOT NULL;
    CREATE INDEX IX_Quotations_CompanyProject ON dbo.Quotations(CompanyId, ProjectId);

    PRINT 'Created dbo.Quotations.';
END
ELSE
    PRINT 'dbo.Quotations already exists.';
GO

-- ── 4. dbo.QuotationItems ──────────────────────────────────────────────────────
IF OBJECT_ID('dbo.QuotationItems', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.QuotationItems (
        QuotationItemId INT IDENTITY(1,1) PRIMARY KEY,
        QuotationId      INT            NOT NULL REFERENCES dbo.Quotations(QuotationId) ON DELETE CASCADE,
        MRItemId         INT            NULL,
        ItemId           NVARCHAR(50)   NOT NULL,
        ItemName         NVARCHAR(200)  NULL,
        UOMCode          NVARCHAR(20)   NULL,
        Quantity         DECIMAL(18,4)  NOT NULL DEFAULT 0,
        Remarks          NVARCHAR(MAX)  NULL
    );

    CREATE INDEX IX_QuotationItems_QuotationId ON dbo.QuotationItems(QuotationId);

    PRINT 'Created dbo.QuotationItems.';
END
ELSE
    PRINT 'dbo.QuotationItems already exists.';
GO

-- ── 5. dbo.QuotationSuppliers (tagged/invited suppliers) ──────────────────────
IF OBJECT_ID('dbo.QuotationSuppliers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.QuotationSuppliers (
        Id               INT IDENTITY(1,1) PRIMARY KEY,
        QuotationId      INT            NOT NULL REFERENCES dbo.Quotations(QuotationId) ON DELETE CASCADE,
        SupplierLHeadId  INT            NOT NULL,
        Status           NVARCHAR(30)   NOT NULL DEFAULT 'Pending',
        InvitedAt        DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT UQ_QuotationSuppliers UNIQUE (QuotationId, SupplierLHeadId)
    );

    CREATE INDEX IX_QuotationSuppliers_SupplierLHeadId ON dbo.QuotationSuppliers(SupplierLHeadId);

    PRINT 'Created dbo.QuotationSuppliers.';
END
ELSE
    PRINT 'dbo.QuotationSuppliers already exists.';
GO

-- ── 6. dbo.QuotationSupplierPrices (per-item supplier response) ──────────────
IF OBJECT_ID('dbo.QuotationSupplierPrices', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.QuotationSupplierPrices (
        Id               INT IDENTITY(1,1) PRIMARY KEY,
        QuotationId      INT            NOT NULL REFERENCES dbo.Quotations(QuotationId),
        SupplierLHeadId  INT            NOT NULL,
        QuotationItemId  INT            NOT NULL REFERENCES dbo.QuotationItems(QuotationItemId) ON DELETE CASCADE,
        Rate             DECIMAL(18,2)  NOT NULL DEFAULT 0,
        SupplyDate       DATE           NULL,
        Quality          NVARCHAR(200)  NULL,
        SubmittedAt      DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT UQ_QuotationSupplierPrices UNIQUE (QuotationItemId, SupplierLHeadId)
    );

    CREATE INDEX IX_QuotationSupplierPrices_QuotationId ON dbo.QuotationSupplierPrices(QuotationId);
    CREATE INDEX IX_QuotationSupplierPrices_SupplierLHeadId ON dbo.QuotationSupplierPrices(SupplierLHeadId);

    PRINT 'Created dbo.QuotationSupplierPrices.';
END
ELSE
    PRINT 'dbo.QuotationSupplierPrices already exists.';
GO

-- ── 7. dbo.SupplierItemRates (standalone general rate card) ──────────────────
IF OBJECT_ID('dbo.SupplierItemRates', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.SupplierItemRates (
        Id               INT IDENTITY(1,1) PRIMARY KEY,
        SupplierLHeadId  INT            NOT NULL,
        ItemId           NVARCHAR(50)   NOT NULL,
        ItemName         NVARCHAR(200)  NULL,
        UOMCode          NVARCHAR(20)   NULL,
        Rate             DECIMAL(18,2)  NOT NULL DEFAULT 0,
        SupplyLeadTime   NVARCHAR(100)  NULL,
        Quality          NVARCHAR(200)  NULL,
        UpdatedAt        DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT UQ_SupplierItemRates UNIQUE (SupplierLHeadId, ItemId)
    );

    CREATE INDEX IX_SupplierItemRates_SupplierLHeadId ON dbo.SupplierItemRates(SupplierLHeadId);

    PRINT 'Created dbo.SupplierItemRates.';
END
ELSE
    PRINT 'dbo.SupplierItemRates already exists.';
GO

-- ── 8. dbo.PurchaseOrders — Quotation source-chain columns ───────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'SourceQTId'
)
BEGIN
  ALTER TABLE dbo.PurchaseOrders ADD SourceQTId INT NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'SourceQTDocNo'
)
BEGIN
  ALTER TABLE dbo.PurchaseOrders ADD SourceQTDocNo NVARCHAR(100) NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'IX_PurchaseOrders_SourceQTId'
)
BEGIN
  CREATE INDEX IX_PurchaseOrders_SourceQTId
    ON dbo.PurchaseOrders (SourceQTId)
    WHERE SourceQTId IS NOT NULL;
END;
GO

-- ── 9. Seed TypeOfDoc row for Quotation (QT) ──────────────────────────────────
DECLARE @QTEntryTypeId UNIQUEIDENTIFIER = ISNULL(
    (SELECT TOP 1 E_Id FROM dbo.Entry_Type
     WHERE EntryType LIKE '%Material%' OR EntryType LIKE '%Purchase%'
     ORDER BY E_CreatedAt),
    (SELECT TOP 1 E_Id FROM dbo.Entry_Type ORDER BY E_CreatedAt)
);

IF @QTEntryTypeId IS NOT NULL
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM dbo.TypeOfDoc
        WHERE links_to LIKE '%Quotation%' AND IsActive = 1
    )
    BEGIN
        INSERT INTO dbo.TypeOfDoc
            (Prefix, DocNoPrefix, Description, links_to, ModuleCode,
             FinYearReset, IsActive, EntryTypeId, CreatedBy, CreatedAt)
        VALUES
            ('QT', 'QT', 'Quotation', 'Quotation', 'QT',
             1, 1, @QTEntryTypeId, 'SYSTEM', SYSDATETIME());

        PRINT 'Seeded Quotation doc type (QT).';
    END
    ELSE
        PRINT 'Quotation doc type already exists — skipping seed.';
END
ELSE
    PRINT 'dbo.Entry_Type is empty — skipped seeding Quotation doc type. Add it later from Type Of Doc Master.';
GO

-- ── 10. Seed 2 demo suppliers in AccountHeadMaster (LHeadType = 'S') ─────────
DECLARE @HasPan BIT = CASE WHEN COL_LENGTH('dbo.AccountHeadMaster','LHeadPan') IS NOT NULL THEN 1 ELSE 0 END;
DECLARE @HasCategory BIT = CASE WHEN COL_LENGTH('dbo.AccountHeadMaster','LHeadCategory') IS NOT NULL THEN 1 ELSE 0 END;
DECLARE @HasDisplayName BIT = CASE WHEN COL_LENGTH('dbo.AccountHeadMaster','DisplayName') IS NOT NULL THEN 1 ELSE 0 END;

IF NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadName = N'Demo Steel Suppliers Pvt Ltd' AND LHeadType = 'S')
BEGIN
    DECLARE @sql1 NVARCHAR(MAX) =
        N'INSERT INTO dbo.AccountHeadMaster (LHeadName, LHeadCode, LHeadType, LHeadPhone, LHeadEmail, LHeadAddress, LHeadContactPerson, LHeadStatus, LHeadPaymentTerms'
        + CASE WHEN @HasPan = 1 THEN N', LHeadPan' ELSE N'' END
        + CASE WHEN @HasCategory = 1 THEN N', LHeadCategory' ELSE N'' END
        + CASE WHEN @HasDisplayName = 1 THEN N', DisplayName' ELSE N'' END
        + N') VALUES (N''Demo Steel Suppliers Pvt Ltd'', N''DEMOSUP1'', ''S'', ''9999900001'', N''supplier1@demo.com'', N''Demo Industrial Estate, Plot 1'', N''Demo Contact One'', 1, N''Net 30'''
        + CASE WHEN @HasPan = 1 THEN N', N''ABCDE1234F''' ELSE N'' END
        + CASE WHEN @HasCategory = 1 THEN N', N''Material Supplier''' ELSE N'' END
        + CASE WHEN @HasDisplayName = 1 THEN N', N''Demo Steel Suppliers''' ELSE N'' END
        + N');';
    EXEC sp_executesql @sql1;
    PRINT 'Seeded demo supplier: Demo Steel Suppliers Pvt Ltd.';
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadName = N'Demo Cement Traders Ltd' AND LHeadType = 'S')
BEGIN
    DECLARE @HasPan2 BIT = CASE WHEN COL_LENGTH('dbo.AccountHeadMaster','LHeadPan') IS NOT NULL THEN 1 ELSE 0 END;
    DECLARE @HasCategory2 BIT = CASE WHEN COL_LENGTH('dbo.AccountHeadMaster','LHeadCategory') IS NOT NULL THEN 1 ELSE 0 END;
    DECLARE @HasDisplayName2 BIT = CASE WHEN COL_LENGTH('dbo.AccountHeadMaster','DisplayName') IS NOT NULL THEN 1 ELSE 0 END;

    DECLARE @sql2 NVARCHAR(MAX) =
        N'INSERT INTO dbo.AccountHeadMaster (LHeadName, LHeadCode, LHeadType, LHeadPhone, LHeadEmail, LHeadAddress, LHeadContactPerson, LHeadStatus, LHeadPaymentTerms'
        + CASE WHEN @HasPan2 = 1 THEN N', LHeadPan' ELSE N'' END
        + CASE WHEN @HasCategory2 = 1 THEN N', LHeadCategory' ELSE N'' END
        + CASE WHEN @HasDisplayName2 = 1 THEN N', DisplayName' ELSE N'' END
        + N') VALUES (N''Demo Cement Traders Ltd'', N''DEMOSUP2'', ''S'', ''9999900002'', N''supplier2@demo.com'', N''Demo Industrial Estate, Plot 2'', N''Demo Contact Two'', 1, N''Net 30'''
        + CASE WHEN @HasPan2 = 1 THEN N', N''FGHIJ5678K''' ELSE N'' END
        + CASE WHEN @HasCategory2 = 1 THEN N', N''Material Supplier''' ELSE N'' END
        + CASE WHEN @HasDisplayName2 = 1 THEN N', N''Demo Cement Traders''' ELSE N'' END
        + N');';
    EXEC sp_executesql @sql2;
    PRINT 'Seeded demo supplier: Demo Cement Traders Ltd.';
END
GO

-- ── 11. Seed 2 demo supplier logins, linked to the AccountHeadMaster rows ────
DECLARE @Supplier1LHeadId INT = (SELECT TOP 1 LHeadId FROM dbo.AccountHeadMaster WHERE LHeadName = N'Demo Steel Suppliers Pvt Ltd' AND LHeadType = 'S');
DECLARE @Supplier2LHeadId INT = (SELECT TOP 1 LHeadId FROM dbo.AccountHeadMaster WHERE LHeadName = N'Demo Cement Traders Ltd' AND LHeadType = 'S');
DECLARE @SupplierRoleId INT = (SELECT TOP 1 RId FROM dbo.Role WHERE LOWER(RName) = 'supplier');

IF @Supplier1LHeadId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.users WHERE LOWER(email) = 'supplier1@demo.com')
    INSERT INTO dbo.users (name, email, password, role, RoleId, created_datetime, discontinue, can_accept_tickets, LinkedLHeadId)
    VALUES (
        'Demo Steel Suppliers Pvt Ltd',
        'supplier1@demo.com',
        '$2b$12$EGUi0BtsDBlYUO/uEdXyougYWyiSgaPpuObBCo4zsd5xBMgDZcOpu',
        'supplier',
        @SupplierRoleId,
        SYSDATETIME(),
        0,
        0,
        @Supplier1LHeadId
    );

IF @Supplier2LHeadId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.users WHERE LOWER(email) = 'supplier2@demo.com')
    INSERT INTO dbo.users (name, email, password, role, RoleId, created_datetime, discontinue, can_accept_tickets, LinkedLHeadId)
    VALUES (
        'Demo Cement Traders Ltd',
        'supplier2@demo.com',
        '$2b$12$AhJ6huhBMrTTfV8ry4C0o.Hd7EX/uEUCqskokj472volljERkLWqa',
        'supplier',
        @SupplierRoleId,
        SYSDATETIME(),
        0,
        0,
        @Supplier2LHeadId
    );
GO

-- ── 12. Seed dbo.PageDefinitions rows for the new pages ──────────────────────
IF OBJECT_ID('dbo.PageDefinitions', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'quotation' AND IsActive = 1)
        INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, CreatedBy)
        VALUES ('quotation', 'Quotation', 'Material', 'Transaction', 'view,create,edit,delete,print,export', 45, 'system');

    IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'l1-chart' AND IsActive = 1)
        INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, CreatedBy)
        VALUES ('l1-chart', 'L1 Price Comparative Chart', 'Material', 'Material', 'view,create,edit,delete,print,export', 65, 'system');

    IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'supplier-quotations' AND IsActive = 1)
        INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, CreatedBy)
        VALUES ('supplier-quotations', 'Supplier Quotations', 'Supplier', 'Supplier Portal', 'view,create,edit,delete,print,export', 10, 'system');

    IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'supplier-catalog' AND IsActive = 1)
        INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, CreatedBy)
        VALUES ('supplier-catalog', 'Supplier Price Catalog', 'Supplier', 'Supplier Portal', 'view,create,edit,delete,print,export', 20, 'system');

    PRINT 'Seeded PageDefinitions rows for quotation/l1-chart/supplier-* pages.';
END
ELSE
    PRINT 'dbo.PageDefinitions does not exist — skipped page-rights seeding.';
GO

PRINT '157-quotation-l1-supplier-portal applied successfully.';
GO
