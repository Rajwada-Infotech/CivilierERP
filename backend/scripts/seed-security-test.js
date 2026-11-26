"use strict";
/**
 * Test data for the Civilier Security app (mobile-security-intercom). Development / test databases only — refuses to
 * run when NODE_ENV is "production".
 *
 *   node scripts/seed-security-test.js            add (or top up) the test data; safe to run again
 *   node scripts/seed-security-test.js --remove   delete everything this script added
 *
 * Everything lives on one test project (PROJECT_ID, default 16 "TEST RESIDENCE"), and every row is tagged so it can
 * be found and removed: staff and customer e-mails end in @security.test, customer numbers start SECTEST-.
 *
 * TEST LOGINS (test accounts on a test database only):
 *   Staff app sign-in ("Staff", e-mail + password)
 *     sec.admin@security.test   SecAdmin@123   Security Super Admin
 *     guard1@security.test      Guard@123      Guard · Main Gate · Morning Shift (08:00–20:00)
 *     guard2@security.test      Guard@123      Guard · Main Gate · Night Shift (20:00–08:00)
 *     guard3@security.test      Guard@123      Guard · Back Gate · Morning Shift
 *   Resident sign-in ("Resident", mobile + password; the customer portal's own rule: first 4 letters of the name +
 *   last 4 digits of the mobile, small letters)
 *     9000011101   asha1101   Asha Sharma   primary, flat A-101 (has a guest pass and visitor history)
 *     9000011102   rohu1102   Rohu Sharma   member,  flat A-101 (gets the 60 s escalation)
 *     9000011103   priy1103   Priya Das     primary, flats A-102 and B-201 (flat switcher)
 *     9000011104   vikr1104   Vikram Roy    primary, flat B-202
 *     9000011105   (none)     Meera Iyer    member,  flat B-202 — no portal login, shows "No portal login" on the web
 */
const path = require("path");
process.chdir(path.join(__dirname, ".."));
require("dotenv").config();
const bcrypt = require("bcrypt");
const h3 = require("h3-js");
const { connectDB, getPool, sql } = require("../db");
const { defaultPortalPassword } = require("../services/crmPortalProvision");

const PROJECT_ID = Number(process.env.PROJECT_ID) || 16;
const REMOVE = process.argv.includes("--remove");
const TAG = "@security.test";

const GATES = [
  { name: "Main Gate", lat: 22.5726, lng: 88.3639, policy: "HOLD" },
  { name: "Back Gate", lat: 22.5735, lng: 88.3652, policy: "ALLOW" },
];
const STAFF = [
  { email: "sec.admin@security.test", name: "Sec Admin (test)", role: "security super admin", password: "SecAdmin@123" },
  { email: "guard1@security.test", name: "Guard One (test)", role: "guard", password: "Guard@123", gate: "Main Gate", shift: "Morning Shift" },
  { email: "guard2@security.test", name: "Guard Two (test)", role: "guard", password: "Guard@123", gate: "Main Gate", shift: "Night Shift" },
  { email: "guard3@security.test", name: "Guard Three (test)", role: "guard", password: "Guard@123", gate: "Back Gate", shift: "Morning Shift" },
];
const CUSTOMERS = [
  { no: "SECTEST-0001", name: "Asha Sharma", mobile: "9000011101", login: true, flats: [{ block: "A", flat: "101", primary: true }] },
  { no: "SECTEST-0002", name: "Rohu Sharma", mobile: "9000011102", login: true, flats: [{ block: "A", flat: "101", primary: false }] },
  { no: "SECTEST-0003", name: "Priya Das", mobile: "9000011103", login: true, flats: [{ block: "A", flat: "102", primary: true }, { block: "B", flat: "201", primary: true }] },
  { no: "SECTEST-0004", name: "Vikram Roy", mobile: "9000011104", login: true, flats: [{ block: "B", flat: "202", primary: true }] },
  { no: "SECTEST-0005", name: "Meera Iyer", mobile: "9000011105", login: false, flats: [{ block: "B", flat: "202", primary: false }] },
];
const emailOf = (c) => `${c.name.split(" ")[0].toLowerCase()}${TAG}`;

async function remove(pool) {
  const tx = pool.transaction();
  await tx.begin();
  try {
    const q = (s) => tx.request().input("p", sql.Int, PROJECT_ID).input("tag", sql.NVarChar(50), `%${TAG}`).query(s);
    const staff = `(SELECT id FROM dbo.users WHERE email LIKE @tag)`;
    const cust = `(SELECT Id FROM dbo.CrmCustomer WHERE CustomerNo LIKE N'SECTEST-%')`;
    const gates = `(SELECT GateId FROM dbo.SecurityGate WHERE ProjectId = @p AND CreatedBy IN ${staff})`;
    await q(`DELETE FROM dbo.SecurityCallSession WHERE (CallerKind = N'STAFF' AND CallerId IN ${staff}) OR (CalleeKind = N'STAFF' AND CalleeId IN ${staff})
               OR (CallerKind = N'CUSTOMER' AND CallerId IN ${cust}) OR (CalleeKind = N'CUSTOMER' AND CalleeId IN ${cust})`);
    await q(`DELETE FROM dbo.SecurityAlert WHERE GuardUserId IN ${staff} OR RequestId IN (SELECT RequestId FROM dbo.SecurityVisitorRequest WHERE GuardUserId IN ${staff})`);
    await q(`DELETE FROM dbo.SecurityVisitorDecision WHERE RequestId IN (SELECT RequestId FROM dbo.SecurityVisitorRequest WHERE GuardUserId IN ${staff}) OR CustomerId IN ${cust}`);
    await q(`DELETE FROM dbo.SecurityVisitorPhoto WHERE RequestId IN (SELECT RequestId FROM dbo.SecurityVisitorRequest WHERE GuardUserId IN ${staff})`);
    await q(`DELETE FROM dbo.SecurityVisitorRequest WHERE GuardUserId IN ${staff}`);
    await q(`DELETE FROM dbo.SecurityGuestPass WHERE CustomerId IN ${cust}`);
    await q(`DELETE FROM dbo.SecurityGuardPing WHERE GuardUserId IN ${staff}`);
    await q(`DELETE FROM dbo.SecurityGuardAssignment WHERE GuardUserId IN ${staff}`);
    await q(`DELETE FROM dbo.SecurityGeofenceZone WHERE CreatedBy IN ${staff}`);
    await q(`DELETE FROM dbo.SecurityGate WHERE GateId IN ${gates}`);
    await q(`DELETE FROM dbo.SecurityResidentAudit WHERE ResidentId IN (SELECT ResidentId FROM dbo.SecurityResident WHERE CustomerId IN ${cust})`);
    await q(`DELETE FROM dbo.SecurityResident WHERE CustomerId IN ${cust}`);
    await q(`DELETE FROM dbo.PushDeviceToken WHERE UserId IN ${staff} OR PortalUserId IN (SELECT Id FROM dbo.CrmCustomerPortalUser WHERE CustomerId IN ${cust})`);
    await q(`DELETE FROM dbo.CrmCustomerPortalUser WHERE CustomerId IN ${cust}`);
    await q(`DELETE FROM dbo.CrmCustomer WHERE CustomerNo LIKE N'SECTEST-%'`);
    await q(`DELETE FROM dbo.users WHERE email LIKE @tag`);
    await tx.commit();
    console.log("Removed the Civilier Security test data.");
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

async function seed(pool) {
  const one = async (s, inputs = {}) => {
    const r = pool.request();
    for (const [k, [t, v]] of Object.entries(inputs)) r.input(k, t, v);
    return (await r.query(s)).recordset;
  };

  const project = (await one(`SELECT id, name FROM dbo.enterprise WHERE id = @p`, { p: [sql.Int, PROJECT_ID] }))[0];
  if (!project) throw new Error(`Project ${PROJECT_ID} not found. Set PROJECT_ID to a test project's id.`);

  // Never take over a real record: a mobile or e-mail already used outside this seed stops the run.
  for (const c of CUSTOMERS) {
    const clash = await one(`SELECT TOP 1 CustomerNo FROM dbo.CrmCustomer WHERE (Mobile = @m OR Email = @e) AND CustomerNo NOT LIKE N'SECTEST-%'`, {
      m: [sql.NVarChar(20), c.mobile],
      e: [sql.NVarChar(200), emailOf(c)],
    });
    if (clash.length) throw new Error(`Mobile ${c.mobile} or ${emailOf(c)} already belongs to customer ${clash[0].CustomerNo}. Nothing was changed.`);
  }

  const roles = {};
  for (const r of await one(`SELECT RId, LOWER(RName) AS n FROM dbo.Role WHERE LOWER(RName) IN (N'guard', N'security super admin')`)) roles[r.n] = r.RId;
  if (!roles.guard || !roles["security super admin"]) throw new Error("Roles Guard / Security Super Admin are missing — run the migrations (715) first.");
  const shifts = {};
  for (const s of await one(`SELECT Id, Name FROM dbo.SecurityShift WHERE Status = N'Active'`)) shifts[s.Name] = s.Id;
  for (const s of [
    ["Morning Shift", "08:00", "20:00"],
    ["Night Shift", "20:00", "08:00"],
  ]) {
    if (!shifts[s[0]]) {
      shifts[s[0]] = (await one(`INSERT INTO dbo.SecurityShift (Name, StartTime, EndTime, CreatedBy) OUTPUT INSERTED.Id VALUES (@n, @s, @e, N'seed-security-test')`, {
        n: [sql.NVarChar(100), s[0]], s: [sql.NVarChar(8), s[1]], e: [sql.NVarChar(8), s[2]],
      }))[0].Id;
    }
  }

  // ── Staff ──
  const staffIds = {};
  for (const s of STAFF) {
    const hash = await bcrypt.hash(s.password, 12);
    const found = (await one(`SELECT id FROM dbo.users WHERE email = @e`, { e: [sql.NVarChar(150), s.email] }))[0];
    if (found) {
      await one(`UPDATE dbo.users SET name = @n, password = @pw, RoleId = @r, discontinue = 0 WHERE id = @id`, {
        n: [sql.NVarChar(150), s.name], pw: [sql.NVarChar(200), hash], r: [sql.Int, roles[s.role]], id: [sql.Int, found.id],
      });
      staffIds[s.email] = found.id;
    } else {
      staffIds[s.email] = (await one(`INSERT INTO dbo.users (name, email, password, RoleId, discontinue) OUTPUT INSERTED.id VALUES (@n, @e, @pw, @r, 0)`, {
        n: [sql.NVarChar(150), s.name], e: [sql.NVarChar(150), s.email], pw: [sql.NVarChar(200), hash], r: [sql.Int, roles[s.role]],
      }))[0].id;
    }
  }
  const adminId = staffIds["sec.admin@security.test"];

  // ── Gates and zones ──
  const gateIds = {};
  for (const g of GATES) {
    const found = (await one(`SELECT GateId FROM dbo.SecurityGate WHERE ProjectId = @p AND Name = @n`, { p: [sql.Int, PROJECT_ID], n: [sql.NVarChar(100), g.name] }))[0];
    gateIds[g.name] = found
      ? found.GateId
      : (await one(`INSERT INTO dbo.SecurityGate (ProjectId, Name, Latitude, Longitude, NoResponsePolicy, CreatedBy) OUTPUT INSERTED.GateId VALUES (@p, @n, @la, @lo, @pol, @u)`, {
          p: [sql.Int, PROJECT_ID], n: [sql.NVarChar(100), g.name], la: [sql.Decimal(9, 6), g.lat], lo: [sql.Decimal(9, 6), g.lng], pol: [sql.NVarChar(12), g.policy], u: [sql.Int, adminId],
        }))[0].GateId;
  }
  const zoneExists = async (gateId) => (await one(`SELECT 1 AS x FROM dbo.SecurityGeofenceZone WHERE GateId = @g`, { g: [sql.Int, gateId] })).length > 0;
  if (!(await zoneExists(gateIds["Main Gate"]))) {
    const centre = h3.latLngToCell(GATES[0].lat, GATES[0].lng, 11);
    const cells = h3.gridDisk(centre, 2);
    await one(`INSERT INTO dbo.SecurityGeofenceZone (ProjectId, GateId, Name, Kind, H3Resolution, H3Cells, AllowedDistanceM, CreatedBy) VALUES (@p, @g, N'Main Gate zone', N'H3', 11, @c, 15, @u)`, {
      p: [sql.Int, PROJECT_ID], g: [sql.Int, gateIds["Main Gate"]], c: [sql.NVarChar(sql.MAX), JSON.stringify(cells)], u: [sql.Int, adminId],
    });
  }
  if (!(await zoneExists(gateIds["Back Gate"]))) {
    const [la, lo] = [GATES[1].lat, GATES[1].lng];
    const d = 0.0004;
    const poly = [[la - d, lo - d], [la - d, lo + d], [la + d, lo + d], [la + d, lo - d]];
    await one(`INSERT INTO dbo.SecurityGeofenceZone (ProjectId, GateId, Name, Kind, Polygon, AllowedDistanceM, CreatedBy) VALUES (@p, @g, N'Back Gate zone', N'POLYGON', @poly, 10, @u)`, {
      p: [sql.Int, PROJECT_ID], g: [sql.Int, gateIds["Back Gate"]], poly: [sql.NVarChar(sql.MAX), JSON.stringify(poly)], u: [sql.Int, adminId],
    });
  }

  // ── Guard assignments (from a week ago, open-ended) ──
  for (const s of STAFF.filter((x) => x.gate)) {
    const uid = staffIds[s.email];
    const have = await one(`SELECT 1 AS x FROM dbo.SecurityGuardAssignment WHERE GuardUserId = @u AND IsActive = 1`, { u: [sql.Int, uid] });
    if (!have.length) {
      await one(`INSERT INTO dbo.SecurityGuardAssignment (GuardUserId, GateId, ShiftId, EffectiveFrom, CreatedBy) VALUES (@u, @g, @s, CAST(DATEADD(DAY, -7, SYSUTCDATETIME()) AS DATE), @a)`, {
        u: [sql.Int, uid], g: [sql.Int, gateIds[s.gate]], s: [sql.Int, shifts[s.shift]], a: [sql.Int, adminId],
      });
    }
  }

  // ── Customers, portal logins, residents ──
  const custIds = {};
  for (const c of CUSTOMERS) {
    const found = (await one(`SELECT Id FROM dbo.CrmCustomer WHERE CustomerNo = @no`, { no: [sql.NVarChar(30), c.no] }))[0];
    const id = found
      ? found.Id
      : (await one(`INSERT INTO dbo.CrmCustomer (CustomerNo, CustomerName, Mobile, Email, City, IsActive, Notes) OUTPUT INSERTED.Id VALUES (@no, @n, @m, @e, N'Kolkata', 1, N'Civilier Security test customer')`, {
          no: [sql.NVarChar(30), c.no], n: [sql.NVarChar(200), c.name], m: [sql.NVarChar(20), c.mobile], e: [sql.NVarChar(200), emailOf(c)],
        }))[0].Id;
    custIds[c.no] = id;
    if (c.login) {
      const hash = await bcrypt.hash(defaultPortalPassword(c.name, c.mobile), 10);
      const pu = (await one(`SELECT Id FROM dbo.CrmCustomerPortalUser WHERE CustomerId = @c`, { c: [sql.Int, id] }))[0];
      if (pu) await one(`UPDATE dbo.CrmCustomerPortalUser SET PasswordHash = @h, IsActive = 1, MustChangePassword = 0 WHERE Id = @id`, { h: [sql.NVarChar(200), hash], id: [sql.Int, pu.Id] });
      else await one(`INSERT INTO dbo.CrmCustomerPortalUser (CustomerId, Email, PasswordHash, MustChangePassword, IsActive) VALUES (@c, @e, @h, 0, 1)`, { c: [sql.Int, id], e: [sql.NVarChar(200), emailOf(c)], h: [sql.NVarChar(200), hash] });
    }
    for (const f of c.flats) {
      const r = (await one(`SELECT ResidentId FROM dbo.SecurityResident WHERE CustomerId = @c AND ProjectId = @p AND Block = @b AND FlatNo = @f`, {
        c: [sql.Int, id], p: [sql.Int, PROJECT_ID], b: [sql.NVarChar(50), f.block], f: [sql.NVarChar(50), f.flat],
      }))[0];
      if (r) {
        await one(`UPDATE dbo.SecurityResident SET IsActive = 1, IsPrimary = @pr, DeactivatedAt = NULL WHERE ResidentId = @r`, { pr: [sql.Bit, f.primary], r: [sql.Int, r.ResidentId] });
      } else {
        const rid = (await one(`INSERT INTO dbo.SecurityResident (CustomerId, ProjectId, Block, FlatNo, IsPrimary, Source) OUTPUT INSERTED.ResidentId VALUES (@c, @p, @b, @f, @pr, N'ADMIN')`, {
          c: [sql.Int, id], p: [sql.Int, PROJECT_ID], b: [sql.NVarChar(50), f.block], f: [sql.NVarChar(50), f.flat], pr: [sql.Bit, f.primary],
        }))[0].ResidentId;
        await one(`INSERT INTO dbo.SecurityResidentAudit (ResidentId, Action, ByUserId, Source, Detail) VALUES (@r, N'ADDED', @u, N'ADMIN', N'Seeded for testing')`, { r: [sql.Int, rid], u: [sql.Int, adminId] });
      }
    }
  }
  const asha = custIds["SECTEST-0001"];
  const priya = custIds["SECTEST-0003"];
  const guard1 = staffIds["guard1@security.test"];

  // ── Visitor history (settled ones only, so nothing times out into alerts) ──
  const hadHistory = (await one(`SELECT COUNT(*) AS n FROM dbo.SecurityVisitorRequest WHERE GuardUserId = @g`, { g: [sql.Int, guard1] }))[0].n > 0;
  if (!hadHistory) {
    const visits = [
      { block: "A", flat: "101", reason: "Delivery", name: "Swiggy rider", vehicle: "WB02AB1234", status: "APPROVED", by: asha, hoursAgo: 26 },
      { block: "A", flat: "101", reason: "Guest", name: "Kunal", vehicle: null, status: "DENIED", by: asha, hoursAgo: 20 },
      { block: "A", flat: "101", reason: "Courier", name: "Blue Dart", vehicle: null, status: "NO_RESPONSE", by: null, hoursAgo: 5 },
      { block: "A", flat: "102", reason: "Maid / help", name: "Sunita", vehicle: null, status: "APPROVED", by: priya, hoursAgo: 3 },
      { block: "B", flat: "201", reason: "Cab / taxi", name: "Uber", vehicle: "WB04CD5678", status: "APPROVED", by: priya, hoursAgo: 1 },
    ];
    for (const v of visits) {
      const req = (await one(`
        INSERT INTO dbo.SecurityVisitorRequest (ClientRequestId, GateId, ProjectId, Block, FlatNo, GuardUserId, Reason, VisitorName, VehicleNo, Status, RequestedAt, DecidedAt, DecidedByCustomerId, NoResponseBy, EscalatedAt)
        OUTPUT INSERTED.RequestId
        VALUES (NEWID(), @g, @p, @b, @f, @u, @r, @n, @v, @s, DATEADD(HOUR, -@h, SYSUTCDATETIME()),
                DATEADD(SECOND, 40, DATEADD(HOUR, -@h, SYSUTCDATETIME())), @by,
                CASE WHEN @s = N'NO_RESPONSE' THEN N'TIMEOUT' END, CASE WHEN @s = N'NO_RESPONSE' THEN DATEADD(SECOND, 60, DATEADD(HOUR, -@h, SYSUTCDATETIME())) END)`, {
        g: [sql.Int, gateIds["Main Gate"]], p: [sql.Int, PROJECT_ID], b: [sql.NVarChar(50), v.block], f: [sql.NVarChar(50), v.flat], u: [sql.Int, guard1],
        r: [sql.NVarChar(200), v.reason], n: [sql.NVarChar(150), v.name], v: [sql.NVarChar(30), v.vehicle], s: [sql.NVarChar(20), v.status], h: [sql.Int, v.hoursAgo], by: [sql.Int, v.by],
      }))[0].RequestId;
      if (v.by) {
        const res = (await one(`SELECT TOP 1 ResidentId FROM dbo.SecurityResident WHERE CustomerId = @c AND Block = @b AND FlatNo = @f`, { c: [sql.Int, v.by], b: [sql.NVarChar(50), v.block], f: [sql.NVarChar(50), v.flat] }))[0];
        await one(`INSERT INTO dbo.SecurityVisitorDecision (RequestId, ResidentId, CustomerId, Decision, Settled, Platform, DecidedAt) VALUES (@r, @res, @c, @d, 1, N'seed', DATEADD(SECOND, 40, DATEADD(HOUR, -@h, SYSUTCDATETIME())))`, {
          r: [sql.Int, req], res: [sql.Int, res?.ResidentId ?? null], c: [sql.Int, v.by], d: [sql.NVarChar(10), v.status === "APPROVED" ? "APPROVE" : "DENY"], h: [sql.Int, v.hoursAgo],
        });
      }
      if (v.status === "NO_RESPONSE") {
        await one(`INSERT INTO dbo.SecurityAlert (Type, ProjectId, GuardUserId, RequestId, Detail, RaisedAt, AcknowledgedByUserId, AcknowledgedAt) VALUES (N'UNANSWERED', @p, @u, @r, N'No answer from flat A-101', DATEADD(HOUR, -@h, SYSUTCDATETIME()), @a, DATEADD(HOUR, -@h + 1, SYSUTCDATETIME()))`, {
          p: [sql.Int, PROJECT_ID], u: [sql.Int, guard1], r: [sql.Int, req], h: [sql.Int, v.hoursAgo], a: [sql.Int, adminId],
        });
      }
    }
    // An acknowledged "device offline" from yesterday, for the admin's history.
    await one(`INSERT INTO dbo.SecurityAlert (Type, ProjectId, GuardUserId, Detail, RaisedAt, AcknowledgedByUserId, AcknowledgedAt, EscalatedAt) VALUES (N'DEVICE_OFFLINE', @p, @u, N'Guard One (test)''s phone (Main Gate) sent no location for 12 minutes.', DATEADD(HOUR, -22, SYSUTCDATETIME()), @a, DATEADD(HOUR, -21, SYSUTCDATETIME()), DATEADD(HOUR, -22, SYSUTCDATETIME()))`, {
      p: [sql.Int, PROJECT_ID], u: [sql.Int, guard1], a: [sql.Int, adminId],
    });
  }

  // ── A guest pass for Asha (valid until 23:59 IST today, 3 entries) ──
  let passCode = (await one(`SELECT TOP 1 Code FROM dbo.SecurityGuestPass WHERE CustomerId = @c AND CancelledAt IS NULL AND ValidTo > SYSUTCDATETIME() AND Uses < MaxUses`, { c: [sql.Int, asha] }))[0]?.Code;
  if (!passCode) {
    passCode = String(require("crypto").randomInt(100000, 1000000));
    await one(`
      INSERT INTO dbo.SecurityGuestPass (ProjectId, Block, FlatNo, CustomerId, GuestName, GuestPhone, VehicleNo, Note, Code, ValidFrom, ValidTo, MaxUses)
      VALUES (@p, N'A', N'101', @c, N'Ramesh (plumber)', N'9000099999', NULL, N'Kitchen tap repair', @code, SYSUTCDATETIME(),
              DATEADD(MINUTE, -330, DATEADD(DAY, 1, CAST(CAST(DATEADD(MINUTE, 330, SYSUTCDATETIME()) AS DATE) AS DATETIME2))), 3)`, {
      p: [sql.Int, PROJECT_ID], c: [sql.Int, asha], code: [sql.Char(6), passCode],
    });
  }

  console.log(`Civilier Security test data is ready on project ${project.id} "${project.name}".`);
  console.log("  Gates: Main Gate (rule: don't let in without approval), Back Gate (rule: may let in after calling) — each with a zone.");
  console.log("  Guards: guard1 / guard2 on Main Gate (morning / night), guard3 on Back Gate (morning). Admin: sec.admin.");
  console.log("  Residents: A-101 Asha (primary) + Rohu (member); A-102 and B-201 Priya; B-202 Vikram + Meera (no login).");
  console.log(`  Guest pass for A-101: code ${passCode} (Ramesh, 3 entries, until midnight).`);
  console.log("  Logins are listed at the top of backend/scripts/seed-security-test.js.");
}

(async () => {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed test data with NODE_ENV=production.");
  await connectDB();
  const pool = getPool();
  if (REMOVE) await remove(pool);
  else await seed(pool);
  process.exit(0);
})().catch((e) => {
  console.error("Seed failed:", e.message);
  process.exit(1);
});
