-- Migration 527: naming patterns for generated units and parking slots.
--
-- Until now Auto Project Setup named everything one fixed way
-- (`{short}/{block}/{floor}{01}`, parking `{short}/{block}/P01`). Real
-- projects differ — 1A, 1A skipping I/O, 101, GF-1 shops, B1 bungalows,
-- T1/FL2/A — so the pattern becomes master data, chosen per project and
-- overridable per block and per floor (most specific wins).
--
-- No patterns are seeded: they are created from the Naming panel in Auto
-- Project Setup (same page rights as the rest of that page).
-- A NULL assignment everywhere keeps today's naming exactly, so nothing that
-- already exists changes.

IF OBJECT_ID(N'dbo.CrmNamingPattern', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.CrmNamingPattern (
    Id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CrmNamingPattern PRIMARY KEY,
    Name        NVARCHAR(100) NOT NULL,
    -- 'UNIT' or 'PARKING' — which kind of thing the pattern names.
    Scope       NVARCHAR(10)  NOT NULL CONSTRAINT DF_CrmNamingPattern_Scope DEFAULT (N'UNIT'),
    -- Tokens: {P} project short name, {T} tower no. (block order), {B} block
    -- name, {F} floor label, {L} letter on the floor, {N} / {N:2} number.
    Template    NVARCHAR(200) NOT NULL,
    GroundLabel NVARCHAR(10)  NOT NULL CONSTRAINT DF_CrmNamingPattern_Ground DEFAULT (N'G'),
    SkipLetters NVARCHAR(26)  NULL,
    NumberStart INT           NOT NULL CONSTRAINT DF_CrmNamingPattern_Start DEFAULT (1),
    SortOrder   INT           NOT NULL CONSTRAINT DF_CrmNamingPattern_Sort DEFAULT (100),
    IsActive    BIT           NOT NULL CONSTRAINT DF_CrmNamingPattern_Active DEFAULT (1),
    Notes       NVARCHAR(300) NULL,
    CreatedBy   INT NULL,
    CreatedAt   DATETIME2(0)  NOT NULL CONSTRAINT DF_CrmNamingPattern_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy   INT NULL,
    UpdatedAt   DATETIME2(0)  NULL,
    CONSTRAINT CK_CrmNamingPattern_Scope CHECK (Scope IN (N'UNIT', N'PARKING'))
  );
  PRINT 'Migration 527: created dbo.CrmNamingPattern.';
END
GO

-- Assignments: project default, block override, floor override (units only).
IF COL_LENGTH('dbo.enterprise', 'UnitNamingPatternId') IS NULL
  ALTER TABLE dbo.enterprise ADD UnitNamingPatternId INT NULL;
GO
IF COL_LENGTH('dbo.enterprise', 'ParkingNamingPatternId') IS NULL
  ALTER TABLE dbo.enterprise ADD ParkingNamingPatternId INT NULL;
GO
IF COL_LENGTH('dbo.BlockMaster', 'UnitNamingPatternId') IS NULL
  ALTER TABLE dbo.BlockMaster ADD UnitNamingPatternId INT NULL;
GO
IF COL_LENGTH('dbo.BlockMaster', 'ParkingNamingPatternId') IS NULL
  ALTER TABLE dbo.BlockMaster ADD ParkingNamingPatternId INT NULL;
GO
IF COL_LENGTH('dbo.CrmProjectAutoSetupFloor', 'UnitNamingPatternId') IS NULL
  ALTER TABLE dbo.CrmProjectAutoSetupFloor ADD UnitNamingPatternId INT NULL;
GO
