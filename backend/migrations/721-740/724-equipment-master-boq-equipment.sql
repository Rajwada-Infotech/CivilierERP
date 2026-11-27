-- Migration 724: Equipment Master (Engineering → Setup) and an Equipment tab on the BOQ.
--
--   1. dbo.EquipmentMaster — machines and plant a BOQ can plan for: name, short code, billing unit (Hour / Day /
--      Month / Trip…), a standard hire rate, whether we own it or hire it, description, active on/off.
--   2. dbo.BoqEquipment — a BOQ's equipment lines: equipment, the activity it serves (optional), qty, unit, rate,
--      tax %, amount. Counted in the BOQ total next to its items and activities.
--   3. The 'equipment-master' page for the rights system.

IF OBJECT_ID('dbo.EquipmentMaster', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EquipmentMaster (
    EquipmentId   INT IDENTITY(1,1) PRIMARY KEY,
    Name          NVARCHAR(150) NOT NULL,
    Code          NVARCHAR(30)  NULL,
    UomName       NVARCHAR(50)  NULL,
    Rate          DECIMAL(18,2) NULL,
    Ownership     NVARCHAR(10)  NOT NULL CONSTRAINT DF_EquipmentMaster_Ownership DEFAULT 'Hired',
    Description   NVARCHAR(500) NULL,
    IsActive      BIT           NOT NULL CONSTRAINT DF_EquipmentMaster_IsActive DEFAULT 1,
    CreatedBy     NVARCHAR(150) NULL,
    CreatedAt     DATETIME2(3)  NOT NULL CONSTRAINT DF_EquipmentMaster_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy     NVARCHAR(150) NULL,
    UpdatedAt     DATETIME2(3)  NULL,
    CONSTRAINT CK_EquipmentMaster_Ownership CHECK (Ownership IN ('Owned', 'Hired'))
  );
  CREATE UNIQUE INDEX UX_EquipmentMaster_Name ON dbo.EquipmentMaster (Name);
END
GO

IF OBJECT_ID('dbo.BoqEquipment', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.BoqEquipment (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    BoqID         INT            NOT NULL,
    EquipmentId   INT            NULL,
    EquipmentName NVARCHAR(150)  NOT NULL,
    EquipmentCode NVARCHAR(30)   NULL,
    ActivityId    NVARCHAR(100)  NULL,
    ActivityName  NVARCHAR(255)  NULL,
    Description   NVARCHAR(MAX)  NULL,
    Quantity      DECIMAL(18,4)  NOT NULL CONSTRAINT DF_BoqEquipment_Qty DEFAULT 0,
    UomName       NVARCHAR(50)   NULL,
    Rate          DECIMAL(18,4)  NOT NULL CONSTRAINT DF_BoqEquipment_Rate DEFAULT 0,
    TaxPct        DECIMAL(5,2)   NOT NULL CONSTRAINT DF_BoqEquipment_Tax DEFAULT 0,
    LineAmount    DECIMAL(18,2)  NOT NULL CONSTRAINT DF_BoqEquipment_Amount DEFAULT 0,
    SortOrder     INT            NOT NULL CONSTRAINT DF_BoqEquipment_Sort DEFAULT 0
  );
  CREATE INDEX IX_BoqEquipment_Boq ON dbo.BoqEquipment (BoqID, SortOrder);
END
GO

IF COL_LENGTH('dbo.BOQ', 'BoqEquipment') IS NULL
  ALTER TABLE dbo.BOQ ADD BoqEquipment NVARCHAR(MAX) NULL;   -- JSON copy, like BoqItems / BoqActivities
GO

INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'equipment-master', 'Equipment Master', 'Engineering', 'Engineering', 'view,create,edit,delete,print,export', 210, 1, 'migration-724', SYSUTCDATETIME()
WHERE NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'equipment-master' AND IsActive = 1);
GO

PRINT '724-equipment-master-boq-equipment applied successfully.';
GO
