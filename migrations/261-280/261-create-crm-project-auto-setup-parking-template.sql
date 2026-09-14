-- Migration 261: dbo.CrmProjectAutoSetupParkingTemplate — a Block's Parking
-- mix (e.g. 10x Open + 5x Covered + 3x Stack), defined once per Block and
-- generated straight into dbo.ParkingSlot (see parkingSlotMaster.js) via
-- crmProjectAutoSetup.js's POST /generate-parking-slots.
--
-- Mirrors 260-create-crm-project-auto-setup-unit-template.sql exactly, minus
-- AreaSqFt (not applicable to parking) — dbo.ParkingSlot has no FloorNo
-- column, so unlike Units, Parking is Block-scoped only; there is no
-- per-floor scaffold/apply step for it, the template total generates
-- directly against the Block.
IF NOT EXISTS (
  SELECT 1 FROM sys.tables
  WHERE name = 'CrmProjectAutoSetupParkingTemplate' AND schema_id = SCHEMA_ID('dbo')
)
BEGIN
  CREATE TABLE dbo.CrmProjectAutoSetupParkingTemplate (
    Id           INT            IDENTITY(1,1) PRIMARY KEY,
    BlockId      INT            NOT NULL,
    SortOrder    INT            NOT NULL,
    ParkingType  NVARCHAR(50)   NOT NULL,
    Count        INT            NOT NULL,
    IsActive     BIT            NOT NULL CONSTRAINT DF_CPASPT_IsActive DEFAULT (1),
    CreatedBy    INT            NULL,
    CreatedAt    DATETIME2(3)   NOT NULL CONSTRAINT DF_CPASPT_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy    INT            NULL,
    UpdatedAt    DATETIME2(3)   NULL
  );

  CREATE INDEX IX_CrmProjectAutoSetupParkingTemplate_BlockId
    ON dbo.CrmProjectAutoSetupParkingTemplate(BlockId)
    INCLUDE (SortOrder, ParkingType, Count, IsActive);
END