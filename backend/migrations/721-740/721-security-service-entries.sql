-- Migration 721: service entries (Civilier Security app).
-- Vehicles and workers coming in for maintenance, repairs, deliveries or other official work: the guard logs them in
-- and out at the gate. Unlike a visitor request, no resident is asked or notified.
-- Safe to re-run.

IF OBJECT_ID('dbo.SecurityServiceEntry', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SecurityServiceEntry (
    EntryId       INT IDENTITY(1,1) PRIMARY KEY,
    ProjectId     INT             NOT NULL,
    GateId        INT             NOT NULL CONSTRAINT FK_SecurityServiceEntry_Gate REFERENCES dbo.SecurityGate(GateId),
    GuardUserId   INT             NOT NULL,   -- who logged it in
    Kind          NVARCHAR(10)    NOT NULL,   -- VEHICLE | WORKER
    Purpose       NVARCHAR(20)    NOT NULL,
    PersonName    NVARCHAR(120)   NOT NULL,   -- the driver / the worker (or the team's lead)
    Company       NVARCHAR(120)   NULL,
    Phone         NVARCHAR(20)    NULL,
    VehicleNo     NVARCHAR(20)    NULL,
    PeopleCount   TINYINT         NOT NULL CONSTRAINT DF_SecurityServiceEntry_People DEFAULT (1),
    WorkArea      NVARCHAR(120)   NULL,       -- where they are going: "Pump room", "Block A lift", a flat…
    Note          NVARCHAR(300)   NULL,
    InAt          DATETIME2(0)    NOT NULL CONSTRAINT DF_SecurityServiceEntry_InAt DEFAULT SYSUTCDATETIME(),
    OutAt         DATETIME2(0)    NULL,
    OutGuardUserId INT            NULL,       -- who logged it out
    CONSTRAINT CK_SecurityServiceEntry_Kind CHECK (Kind IN (N'VEHICLE', N'WORKER')),
    CONSTRAINT CK_SecurityServiceEntry_Purpose CHECK (Purpose IN (N'MAINTENANCE', N'REPAIR', N'DELIVERY', N'CONTRACTOR', N'OFFICIAL', N'OTHER')),
    CONSTRAINT CK_SecurityServiceEntry_Times CHECK (OutAt IS NULL OR OutAt >= InAt)
  );
  CREATE INDEX IX_SecurityServiceEntry_Gate ON dbo.SecurityServiceEntry (GateId, InAt DESC);
  CREATE INDEX IX_SecurityServiceEntry_Open ON dbo.SecurityServiceEntry (ProjectId, OutAt, InAt DESC);
END
GO
