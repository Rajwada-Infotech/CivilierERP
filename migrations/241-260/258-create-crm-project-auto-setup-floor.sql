-- Migration 258: dbo.CrmProjectAutoSetupFloor — the "floor scaffold" behind
-- the new Auto Project Setup wizard (Project -> N Blocks -> per-block Floors
-- -> per-floor Units). There's no dedicated Floor entity anywhere in this
-- system today (FloorNo is just a free int typed once per unit on
-- UnitMaster) — this table is what lets the wizard persist "how many floors
-- does this block have, and how many units is each one planned for" as real
-- data, so a half-finished setup survives a refresh and can be resumed.
--
-- Also doubles as the signal that distinguishes a project this wizard has
-- already touched from one with only pre-existing, manually-created
-- Blocks/Units: if BlockMaster has active rows for a ProjectId but this
-- table has none, those blocks predate the wizard and it refuses to run.
IF NOT EXISTS (
  SELECT 1 FROM sys.tables
  WHERE name = 'CrmProjectAutoSetupFloor' AND schema_id = SCHEMA_ID('dbo')
)
BEGIN
  CREATE TABLE dbo.CrmProjectAutoSetupFloor (
    Id          INT            IDENTITY(1,1) PRIMARY KEY,
    ProjectId   INT            NOT NULL,
    BlockId     INT            NOT NULL,
    FloorNo     INT            NOT NULL, -- 0 = Ground, 1..N-1 = numbered floors
    FloorLabel  NVARCHAR(20)   NOT NULL, -- 'G', '1', '2', ...
    UnitCount   INT            NOT NULL CONSTRAINT DF_CPASF_UnitCount   DEFAULT (0),
    -- FALSE by default for Ground (FloorNo=0) — ground floors are usually
    -- lobby/parking/amenity space, not sellable units; every other floor
    -- defaults TRUE. Toggling this off always forces UnitCount back to 0
    -- (enforced in the route, not here) so a stray count can't survive a
    -- re-toggle.
    HasUnits    BIT            NOT NULL CONSTRAINT DF_CPASF_HasUnits    DEFAULT (1),
    -- Once real UnitMaster rows have been bulk-created for this floor, the
    -- floor is locked — same "locked once committed" pattern used
    -- everywhere else in this codebase (e.g. CrmApplication's
    -- canEditUnitSelection). Further changes go through Unit Master itself.
    IsGenerated BIT            NOT NULL CONSTRAINT DF_CPASF_IsGenerated DEFAULT (0),
    IsActive    BIT            NOT NULL CONSTRAINT DF_CPASF_IsActive    DEFAULT (1),
    CreatedBy   INT            NULL,
    CreatedAt   DATETIME2(3)   NOT NULL CONSTRAINT DF_CPASF_CreatedAt   DEFAULT (SYSDATETIME()),
    UpdatedBy   INT            NULL,
    UpdatedAt   DATETIME2(3)   NULL
  );

  CREATE UNIQUE INDEX UX_CrmProjectAutoSetupFloor_Block_Floor
    ON dbo.CrmProjectAutoSetupFloor(BlockId, FloorNo)
    WHERE IsActive = 1;

  CREATE INDEX IX_CrmProjectAutoSetupFloor_ProjectId
    ON dbo.CrmProjectAutoSetupFloor(ProjectId)
    INCLUDE (BlockId, IsActive);
END
