// Ownership Changes — recording a new owner after conveyance (migration 562).
//
// Once a booking's sale deed is registered the property is its owner's; a
// sale after that is between owners (Resale & Buy-back refuses it). We only
// record the new owner from a copy of THEIR registered sale deed, approved
// through 'crm-ownership-changes' by someone other than whoever entered it.
// On approval the booking moves to the new owner's application (the same
// steps a resale uses — moveBookingToCustomer), so maintenance, service
// tickets, the portal and the customer record follow them; the old owner's
// application keeps their history.
const { sql } = require("../db");

class OwnershipError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const SALE_DEED_REGISTERED = (b) => `EXISTS (SELECT 1 FROM dbo.CrmSalesDeed d WHERE d.BookingId = ${b}.Id AND d.Status = N'Registered')`;
const LIVE_BOOKING = "b.IsActive = 1 AND b.Status NOT IN (N'Cancelled', N'Rejected', N'Expired', N'Transferred')";

const SELECT_CHANGE = `
  SELECT o.Id, o.ChangeNo, o.BookingId, o.FromCustomerId, o.ToCustomerId, o.FromApplicationId, o.ToApplicationId,
         o.DeedNo, o.DeedDate, o.RegOffice, o.ConsiderationValue, o.FileName, o.MimeType, o.FileSize,
         o.Status, o.Notes, o.RejectionNote, o.ApprovedBy, o.ApprovedAt, o.SubmittedAt, o.CreatedBy, o.CreatedAt, o.UpdatedAt,
         b.BookingNo, b.ProjectId, ISNULL(b.UnitNo, b.BookingNo) AS Property, p.name AS ProjectName,
         fc.CustomerName AS FromName, fc.Mobile AS FromMobile, tc.CustomerName AS ToName, tc.Mobile AS ToMobile, tc.CustomerNo AS ToCode,
         tc.PanNo AS ToPan, tc.AadhaarNo AS ToAadhaar, tc.Address AS ToAddress, ta.ApplicationNo AS ToApplicationNo,
         (SELECT COUNT(*) FROM dbo.CrmCoApplicant co WHERE co.IsActive = 1 AND co.ApplicationId = o.ToApplicationId) AS CoOwnerCount,
         cu.name AS CreatedByName, au.name AS ApprovedByName
  FROM dbo.CrmOwnershipChange o
  JOIN dbo.CrmBooking b ON b.Id = o.BookingId
  LEFT JOIN dbo.enterprise p ON p.id = b.ProjectId
  LEFT JOIN dbo.CrmCustomer fc ON fc.Id = o.FromCustomerId
  LEFT JOIN dbo.CrmCustomer tc ON tc.Id = o.ToCustomerId
  LEFT JOIN dbo.CrmApplication ta ON ta.Id = o.ToApplicationId
  LEFT JOIN dbo.Users cu ON cu.id = o.CreatedBy
  LEFT JOIN dbo.Users au ON au.id = o.ApprovedBy`;

async function log(db, id, action, userId, remarks = null) {
  await db.request().input("c", sql.Int, id).input("a", sql.NVarChar(100), action.slice(0, 100))
    .input("r", sql.NVarChar(1000), remarks ? String(remarks).slice(0, 1000) : null).input("u", sql.Int, userId ?? null)
    .query("INSERT INTO dbo.CrmOwnershipChangeLog (ChangeId, Action, Remarks, UserId) VALUES (@c, @a, @r, @u)");
}

/** Who did what and when (migration 564), newest first. */
async function history(db, id) {
  return (await db.request().input("c", sql.Int, id).query(`
    SELECT l.Id, l.Action, l.Remarks, l.CreatedAt, u.name AS UserName
    FROM dbo.CrmOwnershipChangeLog l LEFT JOIN dbo.Users u ON u.id = l.UserId
    WHERE l.ChangeId = @c ORDER BY l.CreatedAt DESC, l.Id DESC`)).recordset;
}

async function load(db, id) {
  const r = (await db.request().input("id", sql.Int, id).query(`${SELECT_CHANGE} WHERE o.Id = @id AND o.IsActive = 1`)).recordset[0];
  if (!r) throw new OwnershipError("Ownership change not found", 404);
  return r;
}

/** The bookings whose sale deed is registered — the only ones whose owner can change here. */
async function eligibleBookings(db, { search = "", projectScope = null } = {}) {
  const t = String(search || "").trim();
  const req = db.request().input("q", sql.NVarChar(200), `%${t}%`);
  const scope = projectScope ? ` AND ${require("./projectScope").projectPredicate(projectScope, "b.ProjectId", "").trim()}` : "";
  return (await req.query(`
    SELECT TOP 50 b.Id AS BookingId, b.BookingNo, ISNULL(b.UnitNo, b.BookingNo) AS Property, p.name AS ProjectName,
           a.Id AS ApplicationId, c.Id AS CustomerId, c.CustomerName, c.Mobile,
           (SELECT TOP 1 o.ChangeNo FROM dbo.CrmOwnershipChange o WHERE o.BookingId = b.Id AND o.IsActive = 1 AND o.Status IN (N'Draft', N'Pending', N'Rejected')) AS OpenChangeNo
    FROM dbo.CrmBooking b
    JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    JOIN dbo.CrmCustomer c ON c.Id = a.CustomerId
    LEFT JOIN dbo.enterprise p ON p.id = b.ProjectId
    WHERE ${LIVE_BOOKING} AND ${SALE_DEED_REGISTERED("b")}${scope}
      ${t ? "AND (b.BookingNo LIKE @q OR b.UnitNo LIKE @q OR c.CustomerName LIKE @q OR c.Mobile LIKE @q)" : ""}
    ORDER BY b.BookingNo`)).recordset;
}

async function list(db, { status = "", search = "", projectScope = null } = {}) {
  const conds = ["o.IsActive = 1"];
  const req = db.request();
  if (status) { conds.push("o.Status = @st"); req.input("st", sql.NVarChar(20), status); }
  const t = String(search || "").trim();
  if (t) { conds.push("(o.ChangeNo LIKE @q OR b.BookingNo LIKE @q OR b.UnitNo LIKE @q OR fc.CustomerName LIKE @q OR tc.CustomerName LIKE @q OR o.DeedNo LIKE @q)"); req.input("q", sql.NVarChar(200), `%${t}%`); }
  if (projectScope) conds.push(require("./projectScope").projectPredicate(projectScope, "b.ProjectId", "").trim());
  return (await req.query(`${SELECT_CHANGE} WHERE ${conds.join(" AND ")} ORDER BY o.CreatedAt DESC`)).recordset;
}

/** What a draft must hold before it can go for approval. */
function missing(o) {
  const out = [];
  if (!o.ToCustomerId) out.push("the new owner");
  else {
    if (!o.ToPan) out.push("the new owner's PAN (Customers)");
    if (!o.ToAadhaar && require("./crmResaleCase").isIndividualPan(o.ToPan)) out.push("the new owner's Aadhaar (Customers)");
    if (!o.ToAddress) out.push("the new owner's address (Customers)");
    if (!o.ToApplicationId) out.push("the new owner's application (open it here, then add any co-owners on it)");
  }
  if (!String(o.DeedNo || "").trim()) out.push("the sale deed's registration number");
  if (!o.DeedDate) out.push("the sale deed's date");
  if (!String(o.RegOffice || "").trim()) out.push("the registration office");
  if (!o.FileName) out.push("a copy of the registered sale deed");
  return out;
}

function cleanFields(body) {
  const s = (v, n) => { const x = String(v ?? "").trim(); return x ? x.slice(0, n) : null; };
  const value = body.ConsiderationValue === "" || body.ConsiderationValue == null ? null : Number(body.ConsiderationValue);
  if (value != null && !(value >= 0)) throw new OwnershipError("The sale value must be a positive amount");
  let date = null;
  if (body.DeedDate) {
    date = new Date(body.DeedDate);
    if (isNaN(date)) throw new OwnershipError("The sale deed's date isn't a valid date");
    if (date.toISOString().slice(0, 10) > new Date().toISOString().slice(0, 10)) throw new OwnershipError("The sale deed's date can't be in the future — it must already be registered");
  }
  return { DeedNo: s(body.DeedNo, 100), DeedDate: date, RegOffice: s(body.RegOffice, 200), ConsiderationValue: value, Notes: s(body.Notes, 1000) };
}

async function assertNewOwner(db, bookingId, fromCustomerId, toCustomerId) {
  const c = (await db.request().input("c", sql.Int, toCustomerId)
    .query("SELECT Id FROM dbo.CrmCustomer WHERE Id = @c AND IsActive = 1")).recordset[0];
  if (!c) throw new OwnershipError("Choose the new owner from Customers (add them there first)");
  if (Number(toCustomerId) === Number(fromCustomerId)) throw new OwnershipError("The new owner is the same person as the current owner");
}

async function create(db, body, actorUserId, projectScope = null) {
  const bookingId = parseInt(body.BookingId, 10);
  if (!Number.isInteger(bookingId)) throw new OwnershipError("Choose the property");
  const scope = projectScope ? ` AND ${require("./projectScope").projectPredicate(projectScope, "b.ProjectId", "").trim()}` : "";
  const b = (await db.request().input("b", sql.Int, bookingId).query(`
    SELECT b.Id, b.BookingNo, a.Id AS ApplicationId, a.CustomerId,
           CASE WHEN ${SALE_DEED_REGISTERED("b")} THEN 1 ELSE 0 END AS Conveyed
    FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    WHERE b.Id = @b AND ${LIVE_BOOKING}${scope}`)).recordset[0];
  if (!b) throw new OwnershipError("Booking not found", 404);
  if (!b.Conveyed) throw new OwnershipError(`${b.BookingNo}'s sale deed isn't registered yet — until then a change of owner is a resale (Resale → Resale Cases)`, 409);
  const open = (await db.request().input("b", sql.Int, bookingId)
    .query("SELECT TOP 1 ChangeNo FROM dbo.CrmOwnershipChange WHERE BookingId = @b AND IsActive = 1 AND Status IN (N'Draft', N'Pending', N'Rejected')")).recordset[0];
  if (open) throw new OwnershipError(`${open.ChangeNo} is already open on this property — finish or cancel it first`, 409);
  const toId = parseInt(body.ToCustomerId, 10);
  if (!Number.isInteger(toId)) throw new OwnershipError("Choose the new owner");
  await assertNewOwner(db, bookingId, b.CustomerId, toId);
  const f = cleanFields(body);
  const { getNextDocNumber } = require("./docNumber");
  const no = await getNextDocNumber(db, "OWNC", "OWNC");
  const r = await db.request().input("no", sql.NVarChar(40), no).input("b", sql.Int, bookingId)
    .input("fc", sql.Int, b.CustomerId).input("fa", sql.Int, b.ApplicationId).input("tc", sql.Int, toId)
    .input("dn", sql.NVarChar(100), f.DeedNo).input("dd", sql.Date, f.DeedDate).input("ro", sql.NVarChar(200), f.RegOffice)
    .input("cv", sql.Decimal(18, 2), f.ConsiderationValue).input("n", sql.NVarChar(1000), f.Notes).input("by", sql.Int, actorUserId)
    .query(`INSERT INTO dbo.CrmOwnershipChange (ChangeNo, BookingId, FromCustomerId, FromApplicationId, ToCustomerId, DeedNo, DeedDate, RegOffice, ConsiderationValue, Notes, Status, CreatedBy, CreatedAt)
            OUTPUT INSERTED.Id VALUES (@no, @b, @fc, @fa, @tc, @dn, @dd, @ro, @cv, @n, N'Draft', @by, SYSDATETIME())`);
  await log(db, r.recordset[0].Id, "Entered", actorUserId);
  return load(db, r.recordset[0].Id);
}

const editable = (o) => { if (!["Draft", "Rejected"].includes(o.Status)) throw new OwnershipError(`It is ${o.Status === "Pending" ? "waiting for approval" : o.Status.toLowerCase()} — it can't be changed now`, 409); };

async function update(db, id, body, actorUserId) {
  const o = await load(db, id);
  editable(o);
  const toId = body.ToCustomerId ? parseInt(body.ToCustomerId, 10) : null;
  const ownerChanged = !!toId && toId !== Number(o.ToCustomerId);
  if (ownerChanged) {
    if (o.ToApplicationId) throw new OwnershipError("The new owner's application is already open — cancel this record and start again to name someone else", 409);
    await assertNewOwner(db, o.BookingId, o.FromCustomerId, toId);
  }
  const f = cleanFields(body);
  const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
  const changed = [
    ["new owner", ownerChanged],
    ["registration no.", (f.DeedNo || null) !== (o.DeedNo || null)],
    ["date", day(f.DeedDate) !== day(o.DeedDate)],
    ["office", (f.RegOffice || null) !== (o.RegOffice || null)],
    ["value", (f.ConsiderationValue ?? null) !== (o.ConsiderationValue == null ? null : Number(o.ConsiderationValue))],
    ["notes", (f.Notes || null) !== (o.Notes || null)],
  ].filter(([, c]) => c).map(([n]) => n);
  if (changed.length) await log(db, id, "Details changed", actorUserId, changed.join(", "));
  await db.request().input("id", sql.Int, id).input("tc", sql.Int, toId)
    .input("dn", sql.NVarChar(100), f.DeedNo).input("dd", sql.Date, f.DeedDate).input("ro", sql.NVarChar(200), f.RegOffice)
    .input("cv", sql.Decimal(18, 2), f.ConsiderationValue).input("n", sql.NVarChar(1000), f.Notes).input("by", sql.Int, actorUserId)
    .query(`UPDATE dbo.CrmOwnershipChange SET ToCustomerId = ISNULL(@tc, ToCustomerId), DeedNo = @dn, DeedDate = @dd, RegOffice = @ro, ConsiderationValue = @cv,
              Notes = @n, UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @id`);
  return load(db, id);
}

async function attachDeed(db, id, file, actorUserId) {
  const o = await load(db, id);
  editable(o);
  await db.request().input("id", sql.Int, id).input("fn", sql.NVarChar(300), file.originalname).input("b", sql.NVarChar(sql.MAX), file.buffer.toString("base64"))
    .input("fs", sql.BigInt, file.size).input("mt", sql.NVarChar(150), file.mimetype).input("by", sql.Int, actorUserId)
    .query("UPDATE dbo.CrmOwnershipChange SET FileName = @fn, FileBase64 = @b, FileSize = @fs, MimeType = @mt, UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @id");
  await log(db, id, o.FileName ? "Sale deed copy replaced" : "Sale deed copy attached", actorUserId, file.originalname);
  return load(db, id);
}

/**
 * The new owner's application, opened before approval (as a resale case
 * opens its buyer's): co-owners are added on it, and it takes the booking
 * when the change is approved. Draft until then.
 */
async function openOwnerApplication(db, id, actorUserId) {
  const o = await load(db, id);
  editable(o);
  if (o.ToApplicationId) return o;
  const person = (await db.request().input("c", sql.Int, o.ToCustomerId)
    .query("SELECT Id, CustomerName, Mobile, Email FROM dbo.CrmCustomer WHERE Id = @c AND IsActive = 1")).recordset[0];
  if (!person) throw new OwnershipError("The new owner's customer record was not found");
  const b = (await db.request().input("b", sql.Int, o.BookingId)
    .query("SELECT ProjectId, CompanyId, UnitNo FROM dbo.CrmBooking WHERE Id = @b")).recordset[0] || {};
  const { getNextDocNumber } = require("./docNumber");
  const appNo = await getNextDocNumber(db, "APP", "APP");
  const app = await db.request()
    .input("no", sql.NVarChar(50), appNo).input("cid", sql.Int, person.Id).input("name", sql.NVarChar(200), person.CustomerName)
    .input("mob", sql.NVarChar(20), person.Mobile || null).input("em", sql.NVarChar(200), person.Email || null)
    .input("pid", sql.Int, b.ProjectId ?? null).input("co", sql.Int, b.CompanyId ?? null).input("unit", sql.NVarChar(200), b.UnitNo || null)
    .input("by", sql.Int, actorUserId)
    .input("note", sql.NVarChar(sql.MAX), `${o.ChangeNo}: ${b.UnitNo || "property"} to pass to ${person.CustomerName} when the ownership change is approved.`)
    .query(`INSERT INTO dbo.CrmApplication (ApplicationNo, CustomerId, ApplicantName, Mobile, Email, ProjectId, CompanyId,
              InterestedUnit, Source, Status, Notes, DateOfApply, IsActive, CreatedBy, CreatedAt, AssignedTo, AssignedBy)
            OUTPUT INSERTED.Id
            VALUES (@no, @cid, @name, @mob, @em, @pid, @co, @unit, N'Other', N'Draft', @note, CAST(SYSDATETIME() AS DATE), 1, @by, SYSDATETIME(), @by, @by)`);
  await db.request().input("id", sql.Int, id).input("a", sql.Int, app.recordset[0].Id).input("by", sql.Int, actorUserId)
    .query("UPDATE dbo.CrmOwnershipChange SET ToApplicationId = @a, UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @id AND ToApplicationId IS NULL");
  await log(db, id, "New owner's application opened", actorUserId, appNo);
  return load(db, id);
}

async function deedFile(db, id) {
  return (await db.request().input("id", sql.Int, id)
    .query("SELECT FileName, FileBase64, MimeType FROM dbo.CrmOwnershipChange WHERE Id = @id AND IsActive = 1")).recordset[0] || null;
}

async function submit(db, id, user) {
  const o = await load(db, id);
  editable(o);
  const need = missing(o);
  if (need.length) throw new OwnershipError(`Add ${need.join(", ")} first`);
  // The owner may have changed since the draft was made (another record approved meanwhile).
  const cur = (await db.request().input("b", sql.Int, o.BookingId)
    .query("SELECT a.CustomerId FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId WHERE b.Id = @b")).recordset[0];
  if (!cur || Number(cur.CustomerId) !== Number(o.FromCustomerId)) throw new OwnershipError("The property's owner has changed since this was drafted — cancel it and start again", 409);
  const { transition } = require("./approvalService");
  await transition("crm-ownership-changes", id, "Pending", user.email, user.role, null, user.userId);
  await db.request().input("id", sql.Int, id).input("by", sql.Int, user.userId)
    .query("UPDATE dbo.CrmOwnershipChange SET SubmittedAt = SYSDATETIME(), SubmittedBy = @by, RejectionNote = NULL, UpdatedAt = SYSDATETIME() WHERE Id = @id");
  await log(db, id, o.Status === "Rejected" ? "Sent for approval again" : "Sent for approval", user.userId);
  return load(db, id);
}

async function decide(pool, id, approve, note, user) {
  const o = await load(pool, id);
  if (o.Status !== "Pending") throw new OwnershipError("It isn't waiting for approval", 409);
  if (!approve && !String(note || "").trim()) throw new OwnershipError("Say what needs fixing");
  const { transition } = require("./approvalService");
  const r = await transition("crm-ownership-changes", id, approve ? "Approved" : "Rejected", user.email, user.role, note || null, user.userId);
  if (r.newStatus === "Rejected") {
    await pool.request().input("id", sql.Int, id).input("n", sql.NVarChar(500), note)
      .query("UPDATE dbo.CrmOwnershipChange SET RejectionNote = @n, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    await log(pool, id, "Sent back", user.userId, note);
  } else if (r.newStatus === "Approved") {
    await applyChange(pool, id, user.userId);
    await log(pool, id, "Approved — the property passed to the new owner", user.userId, note);
  } else {
    await log(pool, id, "Approval level passed", user.userId, note);
  }
  return { status: r.newStatus, change: await load(pool, id) };
}

/** The last approval: the booking passes to the new owner. */
async function applyChange(pool, id, actorUserId) {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  let appId;
  try {
    const o = (await tx.request().input("id", sql.Int, id)
      .query("SELECT * FROM dbo.CrmOwnershipChange WITH (UPDLOCK) WHERE Id = @id")).recordset[0];
    const b = (await tx.request().input("b", sql.Int, o.BookingId).query(`
      SELECT b.Id, b.BookingNo, b.UnitId, b.UnitNo, b.ProjectId, b.CompanyId, b.ApplicationId, a.CustomerId,
             a.InterestedProject, a.InterestedUnit, a.PaymentPlanId
      FROM dbo.CrmBooking b WITH (UPDLOCK, HOLDLOCK) JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId WHERE b.Id = @b`)).recordset[0];
    if (!b || Number(b.CustomerId) !== Number(o.FromCustomerId)) throw new OwnershipError("The property's owner changed while this was being approved", 409);
    const person = (await tx.request().input("c", sql.Int, o.ToCustomerId)
      .query("SELECT Id, CustomerName, Mobile, Email FROM dbo.CrmCustomer WHERE Id = @c")).recordset[0];
    const { moveBookingToCustomer } = require("./crmResaleTransfer");
    appId = await moveBookingToCustomer(tx, b, person, {
      applicationId: o.ToApplicationId || null, actorUserId,
      note: `Owner of ${b.BookingNo} since sale deed ${o.DeedNo} (${o.ChangeNo}).`,
      loanNote: `Previous owner's loan — closed when ownership changed (${o.ChangeNo})`,
    });
    await tx.request().input("id", sql.Int, id).input("a", sql.Int, appId).input("by", sql.Int, actorUserId)
      .query("UPDATE dbo.CrmOwnershipChange SET ToApplicationId = @a, ApprovedBy = @by, ApprovedAt = SYSDATETIME(), UpdatedAt = SYSDATETIME() WHERE Id = @id");
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    await log(pool, id, "Approval could not be applied", actorUserId, e.message).catch(() => {});
    // The approval stands but nothing moved: put it back to Pending so it can
    // be approved again once the cause is fixed.
    await pool.request().input("id", sql.Int, id).input("n", sql.NVarChar(500), `Not applied: ${e.message}`.slice(0, 500))
      .query("UPDATE dbo.CrmOwnershipChange SET Status = N'Pending', RejectionNote = @n, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    throw e;
  }
  // The new owner can sign in to the portal; never blocks the change.
  try { await require("./crmPortalProvision").ensurePortalUser(pool, appId); } catch (e) { console.error("[ownership-change] portal user:", e.message); }
}

async function cancel(db, id, note, actorUserId) {
  const o = await load(db, id);
  if (!["Draft", "Rejected", "Pending"].includes(o.Status)) throw new OwnershipError(`It is ${o.Status.toLowerCase()} — it can't be cancelled`, 409);
  if (!String(note || "").trim()) throw new OwnershipError("Say why it is being cancelled");
  await db.request().input("id", sql.Int, id).input("n", sql.NVarChar(500), note).input("by", sql.Int, actorUserId)
    .query("UPDATE dbo.CrmOwnershipChange SET Status = N'Cancelled', RejectionNote = @n, UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @id");
  // The new owner's application opened for it never took the booking.
  if (o.ToApplicationId) await db.request().input("a", sql.Int, o.ToApplicationId)
    .query("UPDATE dbo.CrmApplication SET Status = N'Cancelled', UpdatedAt = SYSDATETIME() WHERE Id = @a AND Status = N'Draft'");
  await log(db, id, "Cancelled", actorUserId, note);
  return load(db, id);
}

module.exports = { list, eligibleBookings, load, create, update, attachDeed, openOwnerApplication, deedFile, submit, decide, cancel, history, missing, OwnershipError };
