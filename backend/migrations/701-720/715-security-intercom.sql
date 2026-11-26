-- Migration 715: Security Intercom (the mobile-security-intercom app).
-- One app, three interfaces. Staff sign in with their login and get an interface by the role's NAME (Guard, Security
-- Super Admin); residents sign in with their customer-portal account (mobile + password, dbo.CrmCustomerPortalUser).
--
--   Role 'Guard', 'Security Super Admin'   seeded by name if missing (never looked up by id)
--   SecurityPersonnel.UserId               links an existing security personnel record to the guard's login
--   SecurityGate                           a project's gate, with its coordinates
--   SecurityGuardAssignment                guard (login) + gate + an existing SecurityShift, for a date range
--   SecurityResident                       CRM customer + project + block + flat: synced from bookings whose CrmHandover is
--                                          Completed (applicant primary, co-applicants members), or added by an admin
--   SecurityResidentAudit                  every add / change / removal of a resident
--   SecurityGeofenceZone                   a set of H3 hexagon cells or a polygon around a gate
--   SecurityGuardPing                      on-shift location pings (keep ~90 days; index on guard + time)
--   SecurityVisitorRequest                 guard -> flat: reason, visitor, status
--   SecurityGuestPass                      a resident's pre-approved guest (code, dates, uses)
--   SecurityVisitorPhoto                   the visitor's photo (private; served only to the guard, admins and the flat's residents)
--   SecurityVisitorDecision                every approve / deny, with time and device (the first one settles the request)
--   SecurityCallSession                    resident <-> guard calls (in-app or by phone)
--   SecurityAlert                          left the zone / device offline / request unanswered
--   PageDefinitions                        security-gates, security-guards, security-residents, security-live,
--                                          security-geofences (Maintenance)
-- Push tokens: staff use the existing dbo.PushDeviceToken (AppKey 'security-intercom').
-- Safe to re-run.

IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE LOWER(RName) = N'guard')
  INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy)
  VALUES (N'Guard', N'GRD', N'Gate guard (Civilier Security app)', N'migration-715');
GO
IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE LOWER(RName) = N'security super admin')
  INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy)
  VALUES (N'Security Super Admin', N'SSA', N'Security supervisor: guards, gates, alerts, visitor log (Civilier Security app)', N'migration-715');
GO

IF COL_LENGTH('dbo.SecurityPersonnel', 'UserId') IS NULL
  ALTER TABLE dbo.SecurityPersonnel ADD UserId INT NULL;
GO

IF OBJECT_ID('dbo.SecurityGate', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SecurityGate (
    GateId     INT IDENTITY(1,1) PRIMARY KEY,
    ProjectId  INT            NOT NULL,
    Name       NVARCHAR(100)  NOT NULL,
    Latitude   DECIMAL(9,6)   NULL,
    Longitude  DECIMAL(9,6)   NULL,
    -- What the guard does when nobody at the flat answers: HOLD (don't let in), ALLOW (may let in after calling), CALL_OFFICE.
    NoResponsePolicy NVARCHAR(12) NOT NULL CONSTRAINT DF_SecurityGate_NoResponsePolicy DEFAULT (N'HOLD'),
    IsActive   BIT            NOT NULL CONSTRAINT DF_SecurityGate_IsActive DEFAULT (1),
    CreatedBy  INT            NULL,
    CreatedAt  DATETIME2(0)   NOT NULL CONSTRAINT DF_SecurityGate_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy  INT            NULL,
    UpdatedAt  DATETIME2(0)   NULL
  );
  CREATE INDEX IX_SecurityGate_Project ON dbo.SecurityGate (ProjectId, IsActive);
  ALTER TABLE dbo.SecurityGate ADD CONSTRAINT CK_SecurityGate_NoResponsePolicy CHECK (NoResponsePolicy IN (N'HOLD', N'ALLOW', N'CALL_OFFICE'));
END
GO

IF OBJECT_ID('dbo.SecurityGuardAssignment', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SecurityGuardAssignment (
    AssignmentId   INT IDENTITY(1,1) PRIMARY KEY,
    GuardUserId    INT           NOT NULL,
    GateId         INT           NOT NULL CONSTRAINT FK_SecurityGuardAssignment_Gate REFERENCES dbo.SecurityGate(GateId),
    ShiftId        INT           NOT NULL CONSTRAINT FK_SecurityGuardAssignment_Shift REFERENCES dbo.SecurityShift(Id),
    EffectiveFrom  DATE          NOT NULL,
    EffectiveTo    DATE          NULL,
    IsActive       BIT           NOT NULL CONSTRAINT DF_SecurityGuardAssignment_IsActive DEFAULT (1),
    CreatedBy      INT           NULL,
    CreatedAt      DATETIME2(0)  NOT NULL CONSTRAINT DF_SecurityGuardAssignment_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy      INT           NULL,
    UpdatedAt      DATETIME2(0)  NULL,
    CONSTRAINT CK_SecurityGuardAssignment_Dates CHECK (EffectiveTo IS NULL OR EffectiveTo >= EffectiveFrom)
  );
  CREATE INDEX IX_SecurityGuardAssignment_Guard ON dbo.SecurityGuardAssignment (GuardUserId, IsActive, EffectiveFrom);
  CREATE INDEX IX_SecurityGuardAssignment_Gate ON dbo.SecurityGuardAssignment (GateId, IsActive);
END
GO

IF OBJECT_ID('dbo.SecurityResident', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SecurityResident (
    ResidentId     INT IDENTITY(1,1) PRIMARY KEY,
    CustomerId     INT            NOT NULL,   -- dbo.CrmCustomer.Id (signs in on the customer portal)
    ProjectId      INT            NOT NULL,
    Block          NVARCHAR(50)   NOT NULL CONSTRAINT DF_SecurityResident_Block DEFAULT (N''),
    FlatNo         NVARCHAR(50)   NOT NULL,
    IsPrimary      BIT            NOT NULL CONSTRAINT DF_SecurityResident_IsPrimary DEFAULT (1),
    IsActive       BIT            NOT NULL CONSTRAINT DF_SecurityResident_IsActive DEFAULT (1),
    Source         NVARCHAR(20)   NOT NULL CONSTRAINT DF_SecurityResident_Source DEFAULT (N'ADMIN'),
    BookingId      INT            NULL,
    CreatedAt      DATETIME2(0)   NOT NULL CONSTRAINT DF_SecurityResident_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt      DATETIME2(0)   NULL,
    DeactivatedAt  DATETIME2(0)   NULL,
    CONSTRAINT CK_SecurityResident_Source CHECK (Source IN (N'CRM_SYNC', N'ADMIN')),
    CONSTRAINT UQ_SecurityResident UNIQUE (CustomerId, ProjectId, Block, FlatNo)
  );
  CREATE INDEX IX_SecurityResident_Flat ON dbo.SecurityResident (ProjectId, Block, FlatNo, IsActive);
  CREATE INDEX IX_SecurityResident_Customer ON dbo.SecurityResident (CustomerId, IsActive);
END
GO

IF OBJECT_ID('dbo.SecurityResidentAudit', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SecurityResidentAudit (
    AuditId     BIGINT IDENTITY(1,1) PRIMARY KEY,
    ResidentId  INT            NOT NULL CONSTRAINT FK_SecurityResidentAudit_Resident REFERENCES dbo.SecurityResident(ResidentId),
    Action      NVARCHAR(20)   NOT NULL,
    ByUserId    INT            NULL,
    Source      NVARCHAR(20)   NULL,
    Detail      NVARCHAR(500)  NULL,
    At          DATETIME2(0)   NOT NULL CONSTRAINT DF_SecurityResidentAudit_At DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_SecurityResidentAudit_Action CHECK (Action IN (N'ADDED', N'UPDATED', N'DEACTIVATED', N'REACTIVATED'))
  );
  CREATE INDEX IX_SecurityResidentAudit_Resident ON dbo.SecurityResidentAudit (ResidentId, At DESC);
END
GO

IF OBJECT_ID('dbo.SecurityGeofenceZone', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SecurityGeofenceZone (
    ZoneId            INT IDENTITY(1,1) PRIMARY KEY,
    ProjectId         INT            NOT NULL,
    GateId            INT            NULL CONSTRAINT FK_SecurityGeofenceZone_Gate REFERENCES dbo.SecurityGate(GateId),
    Name              NVARCHAR(100)  NOT NULL,
    Kind              NVARCHAR(10)   NOT NULL CONSTRAINT DF_SecurityGeofenceZone_Kind DEFAULT (N'H3'),
    H3Resolution      TINYINT        NULL,
    H3Cells           NVARCHAR(MAX)  NULL,   -- JSON array of H3 cell ids
    Polygon           NVARCHAR(MAX)  NULL,   -- JSON array of [lat, lng]
    AllowedDistanceM  INT            NULL,
    IsActive          BIT            NOT NULL CONSTRAINT DF_SecurityGeofenceZone_IsActive DEFAULT (1),
    CreatedBy         INT            NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_SecurityGeofenceZone_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy         INT            NULL,
    UpdatedAt         DATETIME2(0)   NULL,
    CONSTRAINT CK_SecurityGeofenceZone_Kind CHECK (Kind IN (N'H3', N'POLYGON'))
  );
  CREATE INDEX IX_SecurityGeofenceZone_Project ON dbo.SecurityGeofenceZone (ProjectId, IsActive);
END
GO

IF OBJECT_ID('dbo.SecurityGuardPing', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SecurityGuardPing (
    PingId       BIGINT IDENTITY(1,1) PRIMARY KEY,
    GuardUserId  INT            NOT NULL,
    PingAt       DATETIME2(3)   NOT NULL,   -- UTC, when the phone took the fix
    Latitude     DECIMAL(9,6)   NOT NULL,
    Longitude    DECIMAL(9,6)   NOT NULL,
    AccuracyM    DECIMAL(7,1)   NULL,
    BatteryPct   TINYINT        NULL,
    H3Cell       NVARCHAR(16)   NULL,
    ZoneId       INT            NULL,
    InZone       BIT            NULL,       -- NULL: accuracy too poor to judge, or no zone
    ReceivedAt   DATETIME2(3)   NOT NULL CONSTRAINT DF_SecurityGuardPing_ReceivedAt DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_SecurityGuardPing_Guard ON dbo.SecurityGuardPing (GuardUserId, PingAt DESC) INCLUDE (Latitude, Longitude, InZone);
END
GO

IF OBJECT_ID('dbo.SecurityVisitorRequest', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SecurityVisitorRequest (
    RequestId        INT IDENTITY(1,1) PRIMARY KEY,
    ClientRequestId  UNIQUEIDENTIFIER NOT NULL,   -- set by the guard's phone, so a queued request is stored only once
    GateId           INT            NOT NULL CONSTRAINT FK_SecurityVisitorRequest_Gate REFERENCES dbo.SecurityGate(GateId),
    ProjectId        INT            NOT NULL,
    Block            NVARCHAR(50)   NOT NULL CONSTRAINT DF_SecurityVisitorRequest_Block DEFAULT (N''),
    FlatNo           NVARCHAR(50)   NOT NULL,
    GuardUserId      INT            NOT NULL,
    HasPhoto         BIT            NOT NULL CONSTRAINT DF_SecurityVisitorRequest_HasPhoto DEFAULT (0),
    Reason           NVARCHAR(200)  NOT NULL,
    VisitorName      NVARCHAR(150)  NULL,
    VisitorPhone     NVARCHAR(20)   NULL,
    VehicleNo        NVARCHAR(30)   NULL,
    Status           NVARCHAR(20)   NOT NULL CONSTRAINT DF_SecurityVisitorRequest_Status DEFAULT (N'PENDING'),
    RequestedAt      DATETIME2(0)   NOT NULL CONSTRAINT DF_SecurityVisitorRequest_RequestedAt DEFAULT SYSUTCDATETIME(),
    EscalatedAt      DATETIME2(0)   NULL,          -- the other residents were told (no answer from the first ones)
    NoResponseBy     NVARCHAR(10)   NULL,          -- TIMEOUT | GUARD: how a request ended with nobody answering
    PassId           INT            NULL,          -- let in on a resident's guest pass (approved without asking)
    DecidedAt            DATETIME2(0)   NULL,
    DecidedByCustomerId  INT            NULL,
    CONSTRAINT CK_SecurityVisitorRequest_NoResponseBy CHECK (NoResponseBy IS NULL OR NoResponseBy IN (N'TIMEOUT', N'GUARD')),
    CONSTRAINT CK_SecurityVisitorRequest_Status CHECK (Status IN (N'PENDING', N'APPROVED', N'DENIED', N'NO_RESPONSE')),
    CONSTRAINT UQ_SecurityVisitorRequest_Client UNIQUE (ClientRequestId)
  );
  CREATE INDEX IX_SecurityVisitorRequest_Gate ON dbo.SecurityVisitorRequest (GateId, RequestedAt DESC);
  CREATE INDEX IX_SecurityVisitorRequest_Flat ON dbo.SecurityVisitorRequest (ProjectId, Block, FlatNo, RequestedAt DESC);
  CREATE INDEX IX_SecurityVisitorRequest_Status ON dbo.SecurityVisitorRequest (Status, RequestedAt DESC);
END
GO

-- A resident's guest pass: an expected guest, approved in advance. The guard enters its code (or picks the guest from
-- the flat's list for today) and the request is approved at once, recorded against the pass.
IF OBJECT_ID('dbo.SecurityGuestPass', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SecurityGuestPass (
    PassId       INT IDENTITY(1,1) PRIMARY KEY,
    ProjectId    INT            NOT NULL,
    Block        NVARCHAR(50)   NOT NULL CONSTRAINT DF_SecurityGuestPass_Block DEFAULT (N''),
    FlatNo       NVARCHAR(50)   NOT NULL,
    CustomerId   INT            NOT NULL,   -- the resident who made it
    GuestName    NVARCHAR(150)  NOT NULL,
    GuestPhone   NVARCHAR(20)   NULL,
    VehicleNo    NVARCHAR(30)   NULL,
    Note         NVARCHAR(200)  NULL,
    Code         CHAR(6)        NOT NULL,
    ValidFrom    DATETIME2(0)   NOT NULL,
    ValidTo      DATETIME2(0)   NOT NULL,
    MaxUses      INT            NOT NULL CONSTRAINT DF_SecurityGuestPass_MaxUses DEFAULT (1),
    Uses         INT            NOT NULL CONSTRAINT DF_SecurityGuestPass_Uses DEFAULT (0),
    CancelledAt  DATETIME2(0)   NULL,
    CreatedAt    DATETIME2(0)   NOT NULL CONSTRAINT DF_SecurityGuestPass_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_SecurityGuestPass_Dates CHECK (ValidTo > ValidFrom),
    CONSTRAINT CK_SecurityGuestPass_Uses CHECK (MaxUses BETWEEN 1 AND 50 AND Uses >= 0)
  );
  CREATE INDEX IX_SecurityGuestPass_Flat ON dbo.SecurityGuestPass (ProjectId, Block, FlatNo, ValidTo);
  CREATE INDEX IX_SecurityGuestPass_Code ON dbo.SecurityGuestPass (ProjectId, Code);
END
GO

-- The visitor's photo, kept out of the request row. Personal data: served only through signed-in endpoints that check
-- the viewer (the gate's guard, a security admin in scope, a resident of the flat); nothing is public.
IF OBJECT_ID('dbo.SecurityVisitorPhoto', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SecurityVisitorPhoto (
    RequestId    INT             NOT NULL PRIMARY KEY CONSTRAINT FK_SecurityVisitorPhoto_Request REFERENCES dbo.SecurityVisitorRequest(RequestId),
    ContentType  NVARCHAR(30)    NOT NULL,
    Data         VARBINARY(MAX)  NOT NULL,
    CreatedAt    DATETIME2(0)    NOT NULL CONSTRAINT DF_SecurityVisitorPhoto_CreatedAt DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID('dbo.SecurityVisitorDecision', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SecurityVisitorDecision (
    DecisionId  BIGINT IDENTITY(1,1) PRIMARY KEY,
    RequestId   INT            NOT NULL CONSTRAINT FK_SecurityVisitorDecision_Request REFERENCES dbo.SecurityVisitorRequest(RequestId),
    ResidentId  INT            NULL CONSTRAINT FK_SecurityVisitorDecision_Resident REFERENCES dbo.SecurityResident(ResidentId),
    CustomerId  INT            NOT NULL,
    Decision    NVARCHAR(10)   NOT NULL,
    Settled     BIT            NOT NULL,   -- 1: this decision settled the request; 0: it came after it was already handled
    DeviceId    NVARCHAR(100)  NULL,
    Platform    NVARCHAR(20)   NULL,
    DecidedAt   DATETIME2(0)   NOT NULL CONSTRAINT DF_SecurityVisitorDecision_DecidedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_SecurityVisitorDecision_Decision CHECK (Decision IN (N'APPROVE', N'DENY'))
  );
  CREATE INDEX IX_SecurityVisitorDecision_Request ON dbo.SecurityVisitorDecision (RequestId, DecidedAt);
END
GO

IF OBJECT_ID('dbo.SecurityCallSession', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SecurityCallSession (
    CallId        BIGINT IDENTITY(1,1) PRIMARY KEY,
    CallerKind    NVARCHAR(10)   NOT NULL,   -- STAFF (dbo.users) | CUSTOMER (dbo.CrmCustomer)
    CallerId      INT            NOT NULL,
    CalleeKind    NVARCHAR(10)   NOT NULL,
    CalleeId      INT            NOT NULL,
    RequestId     INT            NULL CONSTRAINT FK_SecurityCallSession_Request REFERENCES dbo.SecurityVisitorRequest(RequestId),
    Channel       NVARCHAR(10)   NOT NULL CONSTRAINT DF_SecurityCallSession_Channel DEFAULT (N'IN_APP'),
    Status        NVARCHAR(12)   NOT NULL CONSTRAINT DF_SecurityCallSession_Status DEFAULT (N'RINGING'),
    StartedAt     DATETIME2(0)   NOT NULL CONSTRAINT DF_SecurityCallSession_StartedAt DEFAULT SYSUTCDATETIME(),
    AnsweredAt    DATETIME2(0)   NULL,
    EndedAt       DATETIME2(0)   NULL,
    DurationSec   INT            NULL,
    RoomName      NVARCHAR(64)   NULL,      -- the calling service's room (LiveKit)
    GateId        INT            NULL,      -- a resident calling the gate: which gate
    CONSTRAINT CK_SecurityCallSession_Kinds CHECK (CallerKind IN (N'STAFF', N'CUSTOMER') AND CalleeKind IN (N'STAFF', N'CUSTOMER')),
    CONSTRAINT CK_SecurityCallSession_Channel CHECK (Channel IN (N'IN_APP', N'PHONE')),
    CONSTRAINT CK_SecurityCallSession_Status CHECK (Status IN (N'RINGING', N'ANSWERED', N'MISSED', N'DECLINED', N'ENDED', N'FAILED'))
  );
  CREATE INDEX IX_SecurityCallSession_Caller ON dbo.SecurityCallSession (CallerKind, CallerId, StartedAt DESC);
  CREATE INDEX IX_SecurityCallSession_Callee ON dbo.SecurityCallSession (CalleeKind, CalleeId, StartedAt DESC);
END
GO

IF OBJECT_ID('dbo.SecurityAlert', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SecurityAlert (
    AlertId               BIGINT IDENTITY(1,1) PRIMARY KEY,
    Type                  NVARCHAR(20)   NOT NULL,
    ProjectId             INT            NULL,
    GuardUserId           INT            NULL,
    ZoneId                INT            NULL CONSTRAINT FK_SecurityAlert_Zone REFERENCES dbo.SecurityGeofenceZone(ZoneId),
    RequestId             INT            NULL CONSTRAINT FK_SecurityAlert_Request REFERENCES dbo.SecurityVisitorRequest(RequestId),
    PingAt                DATETIME2(3)   NULL,   -- LEFT_ZONE: the phone time of the ping that raised it
    Detail                NVARCHAR(500)  NULL,
    RaisedAt              DATETIME2(0)   NOT NULL CONSTRAINT DF_SecurityAlert_RaisedAt DEFAULT SYSUTCDATETIME(),
    EscalatedAt           DATETIME2(0)   NULL,   -- told the security admins again
    Escalated2At          DATETIME2(0)   NULL,   -- still nobody: told the super admins / admins too
    AcknowledgedByUserId  INT            NULL,
    AcknowledgedAt        DATETIME2(0)   NULL,
    CONSTRAINT CK_SecurityAlert_Type CHECK (Type IN (N'LEFT_ZONE', N'DEVICE_OFFLINE', N'UNANSWERED'))
  );
  CREATE INDEX IX_SecurityAlert_Open ON dbo.SecurityAlert (AcknowledgedAt, RaisedAt DESC);
  CREATE INDEX IX_SecurityAlert_Guard ON dbo.SecurityAlert (GuardUserId, Type, RaisedAt DESC);
END
GO

-- The web admin pages (Maintenance): gates, guard assignments, residents.
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'security-gates' AND IsActive = 1)
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'security-gates', N'Security Gates', N'Maintenance', N'Maintenance', N'view,create,edit,delete', 246, 1, N'migration-715', SYSDATETIME());
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'security-guards' AND IsActive = 1)
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'security-guards', N'Security Guards', N'Maintenance', N'Maintenance', N'view,create,edit,delete', 247, 1, N'migration-715', SYSDATETIME());
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'security-residents' AND IsActive = 1)
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'security-residents', N'Residents', N'Maintenance', N'Maintenance', N'view,create,edit', 248, 1, N'migration-715', SYSDATETIME());
-- Live map, alerts (acknowledge = edit) and the visitor log; the geofence editor.
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'security-live' AND IsActive = 1)
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'security-live', N'Security Live', N'Maintenance', N'Maintenance', N'view,edit,export', 249, 1, N'migration-715', SYSDATETIME());
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'security-geofences' AND IsActive = 1)
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'security-geofences', N'Geofences', N'Maintenance', N'Maintenance', N'view,create,edit,delete', 250, 1, N'migration-715', SYSDATETIME());
GO

PRINT 'Migration 715: Security Intercom tables.';
GO
