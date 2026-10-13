// The TRANSFER DEED of a resale / buy-back case (migration 560) — its own
// legal chain, built the way the Agreement for Sale's is:
//
//   Workspace  Draft -> UnderReview (Legal Head, workflow crm-transfer-deeds)
//              -> LegalApproved -> WithParties (each party approves the draft
//              or asks for a recheck — in the portal, or staff record it for
//              them: proxy, with how they said it) -> PartiesApproved
//              -> signing date proposed and accepted by every party, then
//              approved (workflow crm-transfer-deed-date) -> DateApproved
//   Stamp duty DateApproved -> info sent to the payer -> paid with proof ->
//              confirmed (the instrument is stamped before it is signed —
//              the same order as the sale deed's query payment)
//   Executed   signed on or after the approved date, duty confirmed
//   Registry   Sub-Registrar visit scheduled -> Registered
//              (number, date, office, verified registered copy)
//
// Parties: a resale's deed of assignment is tripartite — Seller, Buyer and us
// (Company); a buy-back's cancellation deed is the Seller and us. A recheck
// sends the draft back: the approvals are cleared, the draft is requested
// again (a new version) and the Legal Head reviews it afresh.
// Every action is written to dbo.CrmTransferDeedLog (who, for whom, how).
const { sql } = require("../db");

class DeedError extends Error { constructor(m, status = 400) { super(m); this.status = status; } }
const PROXY_METHODS = ["Phone", "InPerson", "Email", "WhatsApp", "Other"];
const LIVE = ["Draft", "UnderReview", "LegalApproved", "WithParties", "PartiesApproved", "DateApproved", "Executed", "Registered"];

/** The papers each deed needs, and whose they are. */
function requiredDocs(deedType, { agreementRegistered }) {
  const docs = [
    { DocumentType: "DeedDraft", Label: deedType === "Assignment" ? "Deed of assignment — draft" : "Cancellation deed — draft", Party: "Company" },
    { DocumentType: "SellerKyc", Label: "Seller's KYC (PAN & Aadhaar)", Party: "Seller" },
  ];
  if (agreementRegistered) docs.push({ DocumentType: "SellerAfs", Label: "Seller's registered agreement for sale (copy)", Party: "Seller" });
  if (deedType === "Assignment") {
    docs.push({ DocumentType: "BuyerKyc", Label: "Buyer's KYC (PAN & Aadhaar)", Party: "Buyer" });
    docs.push({ DocumentType: "DeveloperNoc", Label: "Our NOC for the transfer (signed)", Party: "Company" });
  }
  return docs;
}
const partiesOf = (deedType) => (deedType === "Assignment" ? ["Seller", "Buyer"] : ["Seller"]);

async function log(db, deedId, action, { party = null, actorType = "Staff", userId = null, customerId = null, method = null, remarks = null } = {}) {
  // Action holds 60 characters: a longer one keeps its head there and the
  // rest goes in front of the remarks, so nothing is lost and nothing fails.
  if (String(action).length > 60) {
    const head = String(action).slice(0, 60);
    const cut = head.lastIndexOf(" — ") > 20 ? head.lastIndexOf(" — ") : 60;
    remarks = [String(action).slice(cut).replace(/^ — /, ""), remarks].filter(Boolean).join(" · ");
    action = String(action).slice(0, cut);
  }
  await db.request().input("d", sql.Int, deedId).input("a", sql.NVarChar(60), action).input("p", sql.NVarChar(20), party)
    .input("t", sql.NVarChar(20), actorType).input("u", sql.Int, userId).input("c", sql.Int, customerId)
    .input("m", sql.NVarChar(30), method).input("r", sql.NVarChar(1000), remarks ? String(remarks).slice(0, 1000) : null)
    .query(`INSERT INTO dbo.CrmTransferDeedLog (DeedId, Action, Party, ActorType, ActorUserId, PortalCustomerId, Method, Remarks)
            VALUES (@d, @a, @p, @t, @u, @c, @m, @r)`);
}

async function loadDeed(db, id) {
  const d = (await db.request().input("id", sql.Int, id).query(`
    SELECT d.*, r.Kind, r.Status AS CaseStatus, r.FromCustomerId, r.ToCustomerId, r.AgreedValue,
           fc.CustomerName AS SellerName, fc.Mobile AS SellerMobile, tc.CustomerName AS BuyerName, tc.Mobile AS BuyerMobile,
           b.BookingNo, COALESCE(b.UnitNo, b.BookingNo) AS Property, b.ProjectId, le.name AS LegalExecutiveName
    FROM dbo.CrmTransferDeed d
    JOIN dbo.CrmUnitResale r ON r.Id = d.ResaleId
    LEFT JOIN dbo.CrmCustomer fc ON fc.Id = r.FromCustomerId
    LEFT JOIN dbo.CrmCustomer tc ON tc.Id = r.ToCustomerId
    LEFT JOIN dbo.CrmBooking b ON b.Id = d.BookingId
    LEFT JOIN dbo.Users le ON le.id = d.LegalExecutiveId
    WHERE d.Id = @id AND d.IsActive = 1`)).recordset[0];
  if (!d) throw new DeedError("Transfer deed not found", 404);
  return d;
}
const assertLive = (d) => { if (d.Status === "Cancelled") throw new DeedError("This deed is cancelled", 409); };
const assertBefore = (d, statuses, what) => {
  if (!statuses.includes(d.Status)) throw new DeedError(`${what} — the deed is ${STATUS_LABEL[d.Status] || d.Status}`, 409);
};
const STATUS_LABEL = {
  Draft: "being drafted", UnderReview: "with the Legal Head", LegalApproved: "legally approved", WithParties: "with the parties",
  PartiesApproved: "approved by the parties", DateApproved: "dated", Executed: "executed", Registered: "registered", Cancelled: "cancelled",
};

/** Opens the deed for a case — once the case has reached its deed stage. */
async function openForCase(db, resaleId, actorUserId) {
  const existing = (await db.request().input("r", sql.Int, resaleId)
    .query("SELECT TOP 1 Id FROM dbo.CrmTransferDeed WHERE ResaleId = @r AND IsActive = 1 AND Status <> N'Cancelled'")).recordset[0];
  if (existing) return existing.Id;
  const { caseState } = require("./crmResaleCase");
  const st = await caseState(db, resaleId);
  if (["Rejected", "Cancelled", "Completed"].includes(st.case.Status)) throw new DeedError(`The case is ${st.case.Status}`, 409);
  if (st.case.DeedType === "CancellationLetter") throw new DeedError("This buy-back needs a signed cancellation letter, not a deed (its agreement isn't registered)");
  const deedIdx = st.stages.findIndex((s) => s.key === "deed");
  const before = st.stages.slice(0, deedIdx).filter((s) => !s.ok && !s.na);
  if (before.length) throw new DeedError(`Finish first: ${before.map((s) => s.label).join(", ")}`, 409);
  const { getNextDocNumber } = require("./docNumber");
  const deedNo = await getNextDocNumber(db, "TDEED", "TDEED");
  const deedType = st.case.Kind === "BuyBack" ? "CancellationDeed" : "Assignment";
  const ins = await db.request().input("no", sql.NVarChar(40), deedNo).input("r", sql.Int, resaleId)
    .input("b", sql.Int, st.case.BookingIds[0]).input("t", sql.NVarChar(30), deedType).input("by", sql.Int, actorUserId)
    .query(`INSERT INTO dbo.CrmTransferDeed (DeedNo, ResaleId, BookingId, DeedType, Status, SeniorApprovalStatus, CreatedBy)
            OUTPUT INSERTED.Id VALUES (@no, @r, @b, @t, N'Draft', N'Draft', @by)`);
  const id = ins.recordset[0].Id;
  for (const doc of requiredDocs(deedType, { agreementRegistered: st.seller.agreement?.Status === "Registered" })) {
    await db.request().input("d", sql.Int, id).input("t", sql.NVarChar(40), doc.DocumentType).input("l", sql.NVarChar(200), doc.Label)
      .input("p", sql.NVarChar(20), doc.Party).input("by", sql.Int, actorUserId)
      .query("INSERT INTO dbo.CrmTransferDeedDocument (DeedId, DocumentType, Label, Party, IsMandatory, Status, CreatedBy) VALUES (@d, @t, @l, @p, 1, N'Requested', @by)");
  }
  await log(db, id, "Opened", { userId: actorUserId, remarks: `${deedNo} for case #${resaleId}` });
  return id;
}

async function assignLegal(db, id, executiveId, actorUserId) {
  const d = await loadDeed(db, id);
  assertLive(d);
  assertBefore(d, ["Draft", "UnderReview", "LegalApproved", "WithParties", "PartiesApproved", "DateApproved"], "The legal executive can't be changed now");
  const u = (await db.request().input("u", sql.Int, executiveId)
    .query("SELECT id, name FROM dbo.users WHERE id = @u AND ISNULL(discontinue, 0) = 0 AND LinkedLHeadId IS NULL")).recordset[0];
  if (!u) throw new DeedError("Choose an active staff member");
  await db.request().input("id", sql.Int, id).input("u", sql.Int, executiveId).input("by", sql.Int, actorUserId)
    .query("UPDATE dbo.CrmTransferDeed SET LegalExecutiveId = @u, UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @id");
  await log(db, id, "Legal executive assigned", { userId: actorUserId, remarks: u.name });
}

// ── Documents ────────────────────────────────────────────────────────────────
async function requestDocument(db, id, { DocumentType, Label, Party, IsMandatory }, actorUserId) {
  const d = await loadDeed(db, id);
  assertLive(d);
  assertBefore(d, ["Draft", "UnderReview"], "Papers can't be added now");
  if (!String(Label || "").trim()) throw new DeedError("Name the document");
  if (!["Seller", "Buyer", "Company"].includes(Party) || (Party === "Buyer" && d.DeedType !== "Assignment")) throw new DeedError("Choose whose document it is");
  await db.request().input("d", sql.Int, id).input("t", sql.NVarChar(40), String(DocumentType || "Other").slice(0, 40)).input("l", sql.NVarChar(200), String(Label).trim())
    .input("p", sql.NVarChar(20), Party).input("m", sql.Bit, IsMandatory === false ? 0 : 1).input("by", sql.Int, actorUserId)
    .query("INSERT INTO dbo.CrmTransferDeedDocument (DeedId, DocumentType, Label, Party, IsMandatory, Status, CreatedBy) VALUES (@d, @t, @l, @p, @m, N'Requested', @by)");
  await log(db, id, "Document requested", { userId: actorUserId, party: Party, remarks: Label });
}

/** Fills a document slot (staff, proxy for a party, or the party in the portal). */
async function uploadDocument(db, id, docId, file, { actorType = "Staff", userId = null, customerId = null, method = null, remarks = null } = {}) {
  const d = await loadDeed(db, id);
  assertLive(d);
  assertBefore(d, ["Draft", "UnderReview"], "Papers are locked once the Legal Head has approved them");
  const slot = (await db.request().input("s", sql.Int, docId).input("d", sql.Int, id)
    .query("SELECT Id, Party, Status, Label FROM dbo.CrmTransferDeedDocument WHERE Id = @s AND DeedId = @d AND IsActive = 1")).recordset[0];
  if (!slot) throw new DeedError("Document not found", 404);
  if (slot.Status === "Verified") throw new DeedError("This document is already verified", 409);
  if (actorType === "Portal") {
    const mine = slot.Party === "Seller" ? d.FromCustomerId : slot.Party === "Buyer" ? d.ToCustomerId : null;
    if (!mine || Number(mine) !== Number(customerId)) throw new DeedError("This document isn't yours to upload", 403);
  }
  if (actorType === "Proxy" && (!PROXY_METHODS.includes(method) || !String(remarks || "").trim())) throw new DeedError("Say how the party sent it and add a note");
  await db.request().input("s", sql.Int, docId).input("fn", sql.NVarChar(300), file.originalname).input("b", sql.NVarChar(sql.MAX), file.buffer.toString("base64"))
    .input("fs", sql.BigInt, file.size).input("mt", sql.NVarChar(150), file.mimetype).input("t", sql.NVarChar(20), actorType).input("u", sql.Int, userId)
    .query(`UPDATE dbo.CrmTransferDeedDocument SET FileName = @fn, FileBase64 = @b, FileSize = @fs, MimeType = @mt, Status = N'Uploaded',
              UploadedByType = @t, UploadedBy = @u, UploadedAt = SYSDATETIME(), VerifiedBy = NULL, VerifiedAt = NULL WHERE Id = @s`);
  await log(db, id, "Document uploaded", { party: slot.Party, actorType, userId, customerId, method, remarks: [slot.Label, remarks].filter(Boolean).join(" — ") });
}

async function reviewDocument(db, id, docId, decision, remarks, actorUserId) {
  const d = await loadDeed(db, id);
  assertLive(d);
  assertBefore(d, ["Draft", "UnderReview"], "Papers are locked once the Legal Head has approved them");
  const slot = (await db.request().input("s", sql.Int, docId).input("d", sql.Int, id)
    .query("SELECT Id, Status, Label, Party, UploadedBy, UploadedByType FROM dbo.CrmTransferDeedDocument WHERE Id = @s AND DeedId = @d AND IsActive = 1")).recordset[0];
  if (!slot) throw new DeedError("Document not found", 404);
  if (slot.Status !== "Uploaded") throw new DeedError("Only an uploaded document can be verified or rejected", 409);
  if (!["Verified", "Rejected"].includes(decision)) throw new DeedError("decision must be Verified or Rejected");
  if (decision === "Rejected" && !String(remarks || "").trim()) throw new DeedError("Say why it's rejected");
  if (slot.UploadedByType !== "Portal" && slot.UploadedBy && Number(slot.UploadedBy) === Number(actorUserId)) {
    throw new DeedError("You uploaded this document, so someone else has to verify it.", 403);
  }
  await db.request().input("s", sql.Int, docId).input("st", sql.NVarChar(20), decision).input("r", sql.NVarChar(1000), remarks || null).input("u", sql.Int, actorUserId)
    .query("UPDATE dbo.CrmTransferDeedDocument SET Status = @st, Remarks = ISNULL(@r, Remarks), VerifiedBy = @u, VerifiedAt = SYSDATETIME() WHERE Id = @s");
  await log(db, id, decision === "Verified" ? "Document verified" : "Document rejected", { party: slot.Party, userId: actorUserId, remarks: [slot.Label, remarks].filter(Boolean).join(" — ") });
}

async function documentFile(db, id, docId) {
  return (await db.request().input("s", sql.Int, docId).input("d", sql.Int, id)
    .query("SELECT FileName, FileBase64, MimeType, Party FROM dbo.CrmTransferDeedDocument WHERE Id = @s AND DeedId = @d AND IsActive = 1")).recordset[0] || null;
}

// ── Legal Head ───────────────────────────────────────────────────────────────
async function submitForLegal(db, id, user) {
  const d = await loadDeed(db, id);
  assertLive(d);
  assertBefore(d, ["Draft"], "It can't be sent for legal approval now");
  if (!d.LegalExecutiveId) throw new DeedError("Assign a legal executive first");
  const open = (await db.request().input("d", sql.Int, id)
    .query("SELECT Label, Status FROM dbo.CrmTransferDeedDocument WHERE DeedId = @d AND IsActive = 1 AND IsMandatory = 1 AND Status <> N'Verified'")).recordset;
  if (open.length) throw new DeedError(`Every mandatory paper must be verified first: ${open.map((x) => `${x.Label} (${x.Status === "Requested" ? "not uploaded" : x.Status.toLowerCase()})`).join("; ")}`, 409);
  const { transition } = require("./approvalService");
  await transition("crm-transfer-deeds", id, "Pending", user.email, user.role, null, user.userId);
  await db.request().input("id", sql.Int, id).query("UPDATE dbo.CrmTransferDeed SET Status = N'UnderReview', UpdatedAt = SYSDATETIME() WHERE Id = @id");
  await log(db, id, "Sent to the Legal Head", { userId: user.userId });
}

async function legalDecision(db, id, approve, remarks, user) {
  const d = await loadDeed(db, id);
  assertLive(d);
  assertBefore(d, ["UnderReview"], "There's nothing waiting for legal approval");
  if (!approve && !String(remarks || "").trim()) throw new DeedError("Say what needs changing");
  const { transition } = require("./approvalService");
  const r = await transition("crm-transfer-deeds", id, approve ? "Approved" : "Rejected", user.email, user.role, remarks || null, user.userId);
  if (r.newStatus === "Approved") {
    await db.request().input("id", sql.Int, id).input("u", sql.Int, user.userId).input("r", sql.NVarChar(1000), remarks || null)
      .query("UPDATE dbo.CrmTransferDeed SET Status = N'LegalApproved', SeniorApprovedBy = @u, SeniorApprovedAt = SYSDATETIME(), SeniorRemarks = @r, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    await log(db, id, "Legal Head approved", { userId: user.userId, remarks });
  } else if (r.newStatus === "Rejected") {
    // Back to drafting: the Legal Head's points are fixed, then it is sent again.
    await db.request().input("id", sql.Int, id).input("r", sql.NVarChar(1000), remarks || null)
      .query("UPDATE dbo.CrmTransferDeed SET Status = N'Draft', SeniorRemarks = @r, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    await log(db, id, "Legal Head sent it back", { userId: user.userId, remarks });
  } else {
    await log(db, id, "Legal approval — level passed", { userId: user.userId, remarks });
  }
  return r;
}

// ── The parties ──────────────────────────────────────────────────────────────
async function sendToParties(db, id, actorUserId) {
  const d = await loadDeed(db, id);
  assertLive(d);
  assertBefore(d, ["LegalApproved"], "It goes to the parties once the Legal Head has approved it");
  const buyer = d.DeedType === "Assignment";
  await db.request().input("id", sql.Int, id).input("b", sql.Bit, buyer ? 1 : 0)
    .query(`UPDATE dbo.CrmTransferDeed SET Status = N'WithParties', SentToPartiesAt = SYSDATETIME(),
              SellerApproval = N'Pending', SellerApprovedAt = NULL, SellerRemarks = NULL, SellerViaProxy = NULL,
              BuyerApproval = CASE WHEN @b = 1 THEN N'Pending' ELSE NULL END, BuyerApprovedAt = NULL, BuyerRemarks = NULL, BuyerViaProxy = NULL,
              UpdatedAt = SYSDATETIME() WHERE Id = @id`);
  // Each party reviews it in the portal: the seller through their booking's
  // application, the buyer through the application the case opened for them
  // (they may not own anything yet). Never blocks sending — staff can always
  // record a party's answer for them (proxy).
  try {
    const { ensurePortalUser } = require("./crmPortalProvision");
    const apps = (await db.request().input("b", sql.Int, d.BookingId).input("r", sql.Int, d.ResaleId)
      .query("SELECT (SELECT ApplicationId FROM dbo.CrmBooking WHERE Id = @b) AS SellerApp, (SELECT BuyerApplicationId FROM dbo.CrmUnitResale WHERE Id = @r) AS BuyerApp")).recordset[0];
    for (const a of [apps?.SellerApp, buyer ? apps?.BuyerApp : null].filter(Boolean)) await ensurePortalUser(db, a);
  } catch (e) { console.warn("[transfer-deed] portal access for the parties:", e.message); }
  await log(db, id, "Sent to the parties", { userId: actorUserId });
}

/** A party approves the draft or asks for a recheck — in the portal, or staff for them (proxy). */
async function partyRespond(db, id, party, decision, { actorType = "Staff", userId = null, customerId = null, method = null, remarks = null } = {}) {
  const d = await loadDeed(db, id);
  assertLive(d);
  assertBefore(d, ["WithParties"], "The draft isn't with the parties");
  if (!partiesOf(d.DeedType).includes(party)) throw new DeedError("That party isn't on this deed");
  if (actorType === "Portal" && Number(party === "Seller" ? d.FromCustomerId : d.ToCustomerId) !== Number(customerId)) throw new DeedError("This isn't your deed to answer", 403);
  if (actorType === "Proxy") {
    if (!PROXY_METHODS.includes(method)) throw new DeedError(`Say how the ${party.toLowerCase()} told you: ${PROXY_METHODS.join(", ")}`);
    if (!String(remarks || "").trim()) throw new DeedError(`Describe how the ${party.toLowerCase()} communicated it`);
  }
  if (d[`${party}Approval`] === "Approved") throw new DeedError(`The ${party.toLowerCase()} has already approved it`, 409);
  if (decision === "Recheck") {
    if (!String(remarks || "").trim()) throw new DeedError("Say what should be checked");
    // The draft goes back: approvals cleared, a fresh draft requested, legal review again.
    await db.request().input("id", sql.Int, id).input("r", sql.NVarChar(1000), remarks)
      .query(`UPDATE dbo.CrmTransferDeed SET Status = N'Draft', SeniorApprovalStatus = N'Draft', SentToPartiesAt = NULL,
                SellerApproval = NULL, BuyerApproval = NULL, ${party}Remarks = @r,
                RecheckCount = RecheckCount + 1, VersionNo = VersionNo + 1, UpdatedAt = SYSDATETIME() WHERE Id = @id`);
    await db.request().input("id", sql.Int, id)
      .query(`UPDATE dbo.CrmTransferDeedDocument SET Status = N'Requested', Remarks = N'Revised draft needed after a recheck', VerifiedBy = NULL, VerifiedAt = NULL
              WHERE DeedId = @id AND DocumentType = N'DeedDraft' AND IsActive = 1`);
    await log(db, id, `${party} asked for a recheck`, { party, actorType, userId, customerId, method, remarks });
    return;
  }
  if (decision !== "Approved") throw new DeedError("decision must be Approved or Recheck");
  await db.request().input("id", sql.Int, id).input("r", sql.NVarChar(1000), remarks || null).input("px", sql.Bit, actorType === "Proxy" ? 1 : 0)
    .query(`UPDATE dbo.CrmTransferDeed SET ${party}Approval = N'Approved', ${party}ApprovedAt = SYSDATETIME(), ${party}Remarks = @r, ${party}ViaProxy = @px, UpdatedAt = SYSDATETIME() WHERE Id = @id`);
  await log(db, id, `${party} approved the draft`, { party, actorType, userId, customerId, method, remarks });
  const after = await loadDeed(db, id);
  if (partiesOf(after.DeedType).every((p) => after[`${p}Approval`] === "Approved")) {
    await db.request().input("id", sql.Int, id).query("UPDATE dbo.CrmTransferDeed SET Status = N'PartiesApproved', UpdatedAt = SYSDATETIME() WHERE Id = @id");
    await log(db, id, "Every party approved the draft", { actorType: "Staff" });
  }
}

// ── The signing date ─────────────────────────────────────────────────────────
/** Company, or a party (portal / proxy), proposes the signing date. The proposer counts as accepting it. */
async function proposeDate(db, id, by, dateStr, ctx, user) {
  const d = await loadDeed(db, id);
  assertLive(d);
  assertBefore(d, ["PartiesApproved"], "A date is proposed once every party has approved the draft");
  const date = String(dateStr || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new DeedError("Choose a date");
  if (date < new Date().toISOString().slice(0, 10)) throw new DeedError("The signing date can't be in the past");
  if (!["Company", ...partiesOf(d.DeedType)].includes(by)) throw new DeedError("Who is proposing it?");
  if (ctx.actorType === "Portal" && Number(by === "Seller" ? d.FromCustomerId : d.ToCustomerId) !== Number(ctx.customerId)) throw new DeedError("Not your deed", 403);
  if (ctx.actorType === "Proxy" && (!PROXY_METHODS.includes(ctx.method) || !String(ctx.remarks || "").trim())) throw new DeedError("Say how the party proposed it and add a note");
  if (d.DateApprovalStatus === "Pending") throw new DeedError("A date is waiting for approval", 409);
  await db.request().input("id", sql.Int, id).input("dt", sql.Date, date).input("by", sql.NVarChar(20), by)
    .input("sa", sql.Bit, by === "Seller" ? 1 : null).input("ba", sql.Bit, by === "Buyer" ? 1 : null)
    .query(`UPDATE dbo.CrmTransferDeed SET ProposedDate = @dt, ProposedBy = @by, SellerDateAccepted = @sa, BuyerDateAccepted = @ba,
              DateApprovalStatus = NULL, UpdatedAt = SYSDATETIME() WHERE Id = @id`);
  await log(db, id, `Signing date proposed: ${date}`, { party: by, ...ctx });
  await maybeSubmitDate(db, id, user);
}

async function acceptDate(db, id, party, ctx, user) {
  const d = await loadDeed(db, id);
  assertLive(d);
  assertBefore(d, ["PartiesApproved"], "There's no date to accept");
  if (!d.ProposedDate) throw new DeedError("No date has been proposed yet");
  if (!partiesOf(d.DeedType).includes(party)) throw new DeedError("That party isn't on this deed");
  if (ctx.actorType === "Portal" && Number(party === "Seller" ? d.FromCustomerId : d.ToCustomerId) !== Number(ctx.customerId)) throw new DeedError("Not your deed", 403);
  if (ctx.actorType === "Proxy" && (!PROXY_METHODS.includes(ctx.method) || !String(ctx.remarks || "").trim())) throw new DeedError("Say how the party accepted it and add a note");
  await db.request().input("id", sql.Int, id).query(`UPDATE dbo.CrmTransferDeed SET ${party}DateAccepted = 1, UpdatedAt = SYSDATETIME() WHERE Id = @id`);
  await log(db, id, `${party} accepted the signing date`, { party, ...ctx });
  await maybeSubmitDate(db, id, user);
}

/** When every party has accepted the proposed date it goes for approval. */
async function maybeSubmitDate(db, id, user) {
  const d = await loadDeed(db, id);
  if (!d.ProposedDate || !partiesOf(d.DeedType).every((p) => d[`${p}DateAccepted`])) return;
  if (d.DateApprovalStatus === "Pending" || d.DateApprovalStatus === "Approved") return;
  await db.request().input("id", sql.Int, id).query("UPDATE dbo.CrmTransferDeed SET DateApprovalStatus = N'Draft' WHERE Id = @id");
  const { transition } = require("./approvalService");
  await transition("crm-transfer-deed-date", id, "Pending", user?.email || "system", user?.role || null, null, user?.userId ?? null);
  await log(db, id, "Date accepted by every party — sent for approval", { actorType: "Staff" });
}

async function dateDecision(db, id, approve, remarks, user) {
  const d = await loadDeed(db, id);
  assertLive(d);
  if (d.DateApprovalStatus !== "Pending") throw new DeedError("No date is waiting for approval", 409);
  if (!approve && !String(remarks || "").trim()) throw new DeedError("Say why the date is turned down");
  const { transition } = require("./approvalService");
  const r = await transition("crm-transfer-deed-date", id, approve ? "Approved" : "Rejected", user.email, user.role, remarks || null, user.userId);
  if (r.newStatus === "Approved") {
    await db.request().input("id", sql.Int, id)
      .query("UPDATE dbo.CrmTransferDeed SET Status = N'DateApproved', DeedDate = ProposedDate, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    await log(db, id, "Signing date approved", { userId: user.userId, remarks });
  } else if (r.newStatus === "Rejected") {
    // Back to agreeing a date: a new one is proposed and accepted again.
    await db.request().input("id", sql.Int, id)
      .query("UPDATE dbo.CrmTransferDeed SET ProposedDate = NULL, ProposedBy = NULL, SellerDateAccepted = NULL, BuyerDateAccepted = NULL, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    await log(db, id, "Signing date turned down", { userId: user.userId, remarks });
  }
  return r;
}

async function markExecuted(db, id, actorUserId) {
  const d = await loadDeed(db, id);
  assertLive(d);
  assertBefore(d, ["DateApproved"], "It is executed once its signing date is approved");
  const pay = await paymentOf(db, id);
  if (!pay || pay.Status !== "Confirmed") throw new DeedError("Confirm the stamp duty first — the deed is stamped before it is signed", 409);
  if (new Date(d.DeedDate).toISOString().slice(0, 10) > new Date().toISOString().slice(0, 10)) {
    throw new DeedError(`The signing date is ${new Date(d.DeedDate).toISOString().slice(0, 10)} — it can be marked executed on or after that day`, 409);
  }
  await db.request().input("id", sql.Int, id).input("u", sql.Int, actorUserId)
    .query("UPDATE dbo.CrmTransferDeed SET Status = N'Executed', ExecutedAt = SYSDATETIME(), ExecutedBy = @u, UpdatedAt = SYSDATETIME() WHERE Id = @id");
  await log(db, id, "Executed (signed by every party)", { userId: actorUserId });
}

// ── Stamp duty ───────────────────────────────────────────────────────────────
async function paymentOf(db, id) {
  return (await db.request().input("d", sql.Int, id).query(`
    SELECT Id, DeedId, Status, StampDuty, RegistrationFee, PayableBy, InfoSentAt, InfoRemarks, PaidRef, PaidOn, AmountPaid,
           ProofFileName, ProofMimeType, ProofUploadedAt, ProofUploadedByType, ConfirmedAt, ConfirmRemarks
    FROM dbo.CrmTransferDeedPayment WHERE DeedId = @d AND IsActive = 1`)).recordset[0] || null;
}

async function sendDutyInfo(db, id, b, actorUserId) {
  const d = await loadDeed(db, id);
  assertLive(d);
  assertBefore(d, ["DateApproved"], "Stamp duty is assessed once the signing date is approved");
  const duty = Number(b?.StampDuty), fee = Number(b?.RegistrationFee);
  if (!(duty >= 0) || !(fee >= 0) || !(duty + fee > 0)) throw new DeedError("Enter the stamp duty and registration fee assessed by the Sub-Registrar");
  const by = b?.PayableBy;
  if (!["Buyer", "Seller", "Developer", "Shared"].includes(by) || (by === "Buyer" && d.DeedType !== "Assignment")) throw new DeedError("Who pays it?");
  const cur = await paymentOf(db, id);
  if (cur && cur.Status !== "Rejected" && cur.Status !== "InfoSent") throw new DeedError("The duty is already being paid", 409);
  if (cur) await db.request().input("p", sql.Int, cur.Id).query("UPDATE dbo.CrmTransferDeedPayment SET IsActive = 0 WHERE Id = @p");
  await db.request().input("d", sql.Int, id).input("sd", sql.Decimal(18, 2), duty).input("rf", sql.Decimal(18, 2), fee).input("pb", sql.NVarChar(20), by)
    .input("u", sql.Int, actorUserId).input("r", sql.NVarChar(1000), b?.Remarks || null)
    .query(`INSERT INTO dbo.CrmTransferDeedPayment (DeedId, Status, StampDuty, RegistrationFee, PayableBy, InfoSentAt, InfoSentBy, InfoRemarks)
            VALUES (@d, N'InfoSent', @sd, @rf, @pb, SYSDATETIME(), @u, @r)`);
  await log(db, id, `Stamp duty ₹${duty.toLocaleString("en-IN")} + registration ₹${fee.toLocaleString("en-IN")} — sent to ${by}`, { userId: actorUserId, remarks: b?.Remarks });
}

async function uploadDutyProof(db, id, file, b, ctx) {
  const d = await loadDeed(db, id);
  assertLive(d);
  const p = await paymentOf(db, id);
  if (!p || !["InfoSent", "ProofUploaded"].includes(p.Status)) throw new DeedError("The stamp duty hasn't been sent for payment", 409);
  if (ctx.actorType === "Portal") {
    const allowed = p.PayableBy === "Shared" ? [d.FromCustomerId, d.ToCustomerId] : p.PayableBy === "Seller" ? [d.FromCustomerId] : p.PayableBy === "Buyer" ? [d.ToCustomerId] : [];
    if (!allowed.map(Number).includes(Number(ctx.customerId))) throw new DeedError("This payment isn't yours to make", 403);
  }
  if (ctx.actorType === "Proxy" && (!PROXY_METHODS.includes(ctx.method) || !String(ctx.remarks || "").trim())) throw new DeedError("Say how the payer sent it and add a note");
  if (!String(b?.PaidRef || "").trim()) throw new DeedError("Enter the GRN / challan number");
  const amt = Number(b?.AmountPaid);
  if (!(amt > 0)) throw new DeedError("Enter the amount paid");
  const on = String(b?.PaidOn || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  await db.request().input("p", sql.Int, p.Id).input("ref", sql.NVarChar(100), String(b.PaidRef).trim()).input("on", sql.Date, on).input("a", sql.Decimal(18, 2), amt)
    .input("fn", sql.NVarChar(300), file.originalname).input("fb", sql.NVarChar(sql.MAX), file.buffer.toString("base64")).input("mt", sql.NVarChar(150), file.mimetype)
    .input("t", sql.NVarChar(20), ctx.actorType)
    .query(`UPDATE dbo.CrmTransferDeedPayment SET Status = N'ProofUploaded', PaidRef = @ref, PaidOn = @on, AmountPaid = @a,
              ProofFileName = @fn, ProofBase64 = @fb, ProofMimeType = @mt, ProofUploadedAt = SYSDATETIME(), ProofUploadedByType = @t, UpdatedAt = SYSDATETIME() WHERE Id = @p`);
  await log(db, id, `Stamp duty paid — ${String(b.PaidRef).trim()}`, { ...ctx });
}

async function confirmDuty(db, id, approve, remarks, actorUserId) {
  const d = await loadDeed(db, id);
  assertLive(d);
  const p = await paymentOf(db, id);
  if (!p || p.Status !== "ProofUploaded") throw new DeedError("There's no paid stamp duty waiting to be confirmed", 409);
  if (!approve) {
    if (!String(remarks || "").trim()) throw new DeedError("Say what's wrong with the payment");
    await db.request().input("p", sql.Int, p.Id).input("r", sql.NVarChar(1000), remarks)
      .query("UPDATE dbo.CrmTransferDeedPayment SET Status = N'InfoSent', ConfirmRemarks = @r, UpdatedAt = SYSDATETIME() WHERE Id = @p");
    await log(db, id, "Stamp duty proof sent back", { userId: actorUserId, remarks });
    return;
  }
  const due = Math.round((Number(p.StampDuty) + Number(p.RegistrationFee)) * 100) / 100;
  if (Math.abs(Number(p.AmountPaid) - due) > 0.009 && !String(remarks || "").trim()) {
    throw new DeedError(`Paid ₹${Number(p.AmountPaid).toLocaleString("en-IN")} but ₹${due.toLocaleString("en-IN")} was assessed — add a remark to confirm a different amount`);
  }
  await db.request().input("p", sql.Int, p.Id).input("u", sql.Int, actorUserId).input("r", sql.NVarChar(1000), remarks || null)
    .query("UPDATE dbo.CrmTransferDeedPayment SET Status = N'Confirmed', ConfirmedBy = @u, ConfirmedAt = SYSDATETIME(), ConfirmRemarks = @r, UpdatedAt = SYSDATETIME() WHERE Id = @p");
  await log(db, id, "Stamp duty confirmed", { userId: actorUserId, remarks });
}

async function dutyProof(db, id) {
  return (await db.request().input("d", sql.Int, id)
    .query("SELECT ProofFileName AS FileName, ProofBase64 AS FileBase64, ProofMimeType AS MimeType FROM dbo.CrmTransferDeedPayment WHERE DeedId = @d AND IsActive = 1")).recordset[0] || null;
}

// ── Registry ─────────────────────────────────────────────────────────────────
async function registryOf(db, id) {
  return (await db.request().input("d", sql.Int, id).query(`
    SELECT r.Id, r.Status, r.Office, r.ScheduledAt, r.Attendees, r.RegNo, r.RegDate, r.CompletedAt, r.Remarks, s.name AS ScheduledByName
    FROM dbo.CrmTransferDeedRegistry r LEFT JOIN dbo.Users s ON s.id = r.ScheduledBy
    WHERE r.DeedId = @d AND r.IsActive = 1 AND r.Status <> N'Cancelled'`)).recordset[0] || null;
}

async function scheduleRegistry(db, id, b, actorUserId) {
  const d = await loadDeed(db, id);
  assertLive(d);
  assertBefore(d, ["Executed"], "Registry follows the executed deed");
  const p = await paymentOf(db, id);
  if (!p || p.Status !== "Confirmed") throw new DeedError("Confirm the stamp duty first", 409);
  const office = String(b?.Office || "").trim();
  const at = b?.ScheduledAt ? new Date(b.ScheduledAt) : null;
  if (!office) throw new DeedError("Which Sub-Registrar office?");
  if (!at || isNaN(at.getTime())) throw new DeedError("When is the visit?");
  const cur = await registryOf(db, id);
  if (cur?.Status === "Completed") throw new DeedError("Already registered", 409);
  if (cur) await db.request().input("r", sql.Int, cur.Id).query("UPDATE dbo.CrmTransferDeedRegistry SET Status = N'Cancelled', UpdatedAt = SYSDATETIME() WHERE Id = @r");
  await db.request().input("d", sql.Int, id).input("o", sql.NVarChar(200), office).input("at", sql.DateTime2, at)
    .input("att", sql.NVarChar(500), b?.Attendees || null).input("u", sql.Int, actorUserId)
    .query("INSERT INTO dbo.CrmTransferDeedRegistry (DeedId, Status, Office, ScheduledAt, Attendees, ScheduledBy) VALUES (@d, N'Scheduled', @o, @at, @att, @u)");
  // The registered copy is requested now, to be uploaded after the visit.
  const has = (await db.request().input("d", sql.Int, id)
    .query("SELECT TOP 1 1 AS x FROM dbo.CrmTransferDeedDocument WHERE DeedId = @d AND DocumentType = N'RegisteredDeed' AND IsActive = 1")).recordset.length;
  if (!has) {
    await db.request().input("d", sql.Int, id).input("u", sql.Int, actorUserId)
      .query("INSERT INTO dbo.CrmTransferDeedDocument (DeedId, DocumentType, Label, Party, IsMandatory, Status, CreatedBy) VALUES (@d, N'RegisteredDeed', N'Registered deed (copy)', N'Company', 1, N'Requested', @u)");
  }
  await log(db, id, `${cur ? "Registry visit rescheduled" : "Registry visit scheduled"} — ${office}, ${at.toISOString().slice(0, 16).replace("T", " ")}`, { userId: actorUserId, remarks: b?.Attendees });
}

/** The registered copy can be uploaded / verified after execution (the papers lock covers the drafting stage). */
async function uploadRegisteredCopy(db, id, file, actorUserId) {
  const d = await loadDeed(db, id);
  assertLive(d);
  const reg = await registryOf(db, id);
  if (!reg || reg.Status !== "Scheduled") throw new DeedError("Schedule the registry visit first", 409);
  await db.request().input("d", sql.Int, id).input("fn", sql.NVarChar(300), file.originalname).input("b", sql.NVarChar(sql.MAX), file.buffer.toString("base64"))
    .input("fs", sql.BigInt, file.size).input("mt", sql.NVarChar(150), file.mimetype).input("u", sql.Int, actorUserId)
    .query(`UPDATE dbo.CrmTransferDeedDocument SET FileName = @fn, FileBase64 = @b, FileSize = @fs, MimeType = @mt, Status = N'Uploaded',
              UploadedByType = N'Staff', UploadedBy = @u, UploadedAt = SYSDATETIME(), VerifiedBy = NULL, VerifiedAt = NULL
            WHERE DeedId = @d AND DocumentType = N'RegisteredDeed' AND IsActive = 1`);
  await log(db, id, "Registered copy uploaded", { userId: actorUserId });
}

async function verifyRegisteredCopy(db, id, approve, remarks, actorUserId) {
  const doc = (await db.request().input("d", sql.Int, id)
    .query("SELECT Id, Status, UploadedBy FROM dbo.CrmTransferDeedDocument WHERE DeedId = @d AND DocumentType = N'RegisteredDeed' AND IsActive = 1")).recordset[0];
  if (!doc || doc.Status !== "Uploaded") throw new DeedError("Upload the registered copy first", 409);
  if (doc.UploadedBy && Number(doc.UploadedBy) === Number(actorUserId)) throw new DeedError("You uploaded this document, so someone else has to verify it.", 403);
  if (!approve && !String(remarks || "").trim()) throw new DeedError("Say why it's rejected");
  await db.request().input("s", sql.Int, doc.Id).input("st", sql.NVarChar(20), approve ? "Verified" : "Rejected").input("r", sql.NVarChar(1000), remarks || null).input("u", sql.Int, actorUserId)
    .query("UPDATE dbo.CrmTransferDeedDocument SET Status = @st, Remarks = ISNULL(@r, Remarks), VerifiedBy = @u, VerifiedAt = SYSDATETIME() WHERE Id = @s");
  await log(db, id, approve ? "Registered copy verified" : "Registered copy rejected", { userId: actorUserId, remarks });
}

async function completeRegistry(db, id, b, actorUserId) {
  const d = await loadDeed(db, id);
  assertLive(d);
  assertBefore(d, ["Executed"], "It's already registered or not ready");
  const reg = await registryOf(db, id);
  if (!reg || reg.Status !== "Scheduled") throw new DeedError("Schedule the registry visit first", 409);
  const no = String(b?.RegNo || "").trim(), date = String(b?.RegDate || "").slice(0, 10);
  if (!no || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new DeedError("Enter the registration number and date");
  if (date > new Date().toISOString().slice(0, 10)) throw new DeedError("The registration date can't be in the future");
  if (d.DeedDate && date < new Date(d.DeedDate).toISOString().slice(0, 10)) throw new DeedError("Registration can't be before the signing date");
  const copy = (await db.request().input("d", sql.Int, id)
    .query("SELECT Status FROM dbo.CrmTransferDeedDocument WHERE DeedId = @d AND DocumentType = N'RegisteredDeed' AND IsActive = 1")).recordset[0];
  if (copy?.Status !== "Verified") throw new DeedError("Upload the registered copy and have it verified", 409);
  await db.request().input("r", sql.Int, reg.Id).input("no", sql.NVarChar(100), no).input("dt", sql.Date, date).input("u", sql.Int, actorUserId)
    .query("UPDATE dbo.CrmTransferDeedRegistry SET Status = N'Completed', RegNo = @no, RegDate = @dt, CompletedBy = @u, CompletedAt = SYSDATETIME(), UpdatedAt = SYSDATETIME() WHERE Id = @r");
  await db.request().input("id", sql.Int, id).query("UPDATE dbo.CrmTransferDeed SET Status = N'Registered', UpdatedAt = SYSDATETIME() WHERE Id = @id");
  await log(db, id, `Registered — ${no} at ${reg.Office}`, { userId: actorUserId });
}

async function cancelDeed(db, id, remarks, actorUserId) {
  const d = await loadDeed(db, id);
  assertLive(d);
  if (["Executed", "Registered"].includes(d.Status)) throw new DeedError("A signed deed can't be cancelled here", 409);
  if (!String(remarks || "").trim()) throw new DeedError("Say why it's cancelled");
  await db.request().input("id", sql.Int, id).input("u", sql.Int, actorUserId)
    .query("UPDATE dbo.CrmTransferDeed SET Status = N'Cancelled', UpdatedBy = @u, UpdatedAt = SYSDATETIME() WHERE Id = @id");
  await log(db, id, "Cancelled", { userId: actorUserId, remarks });
}

// ── Reading it ───────────────────────────────────────────────────────────────
/** Everything about one deed, with its step-by-step checklist. */
async function deedState(db, id) {
  const d = await loadDeed(db, id);
  const docs = (await db.request().input("d", sql.Int, id).query(`
    SELECT x.Id, x.DocumentType, x.Label, x.Party, x.IsMandatory, x.Status, x.FileName, x.Remarks, x.UploadedByType, x.UploadedAt, x.VerifiedAt,
           u.name AS UploadedByName, v.name AS VerifiedByName
    FROM dbo.CrmTransferDeedDocument x LEFT JOIN dbo.Users u ON u.id = x.UploadedBy LEFT JOIN dbo.Users v ON v.id = x.VerifiedBy
    WHERE x.DeedId = @d AND x.IsActive = 1 ORDER BY CASE x.Party WHEN N'Company' THEN 0 WHEN N'Seller' THEN 1 ELSE 2 END, x.Id`)).recordset;
  const history = (await db.request().input("d", sql.Int, id).query(`
    SELECT l.Action, l.Party, l.ActorType, l.Method, l.Remarks, l.At, u.name AS ActorName, c.CustomerName AS PortalName
    FROM dbo.CrmTransferDeedLog l LEFT JOIN dbo.Users u ON u.id = l.ActorUserId LEFT JOIN dbo.CrmCustomer c ON c.Id = l.PortalCustomerId
    WHERE l.DeedId = @d ORDER BY l.At DESC, l.Id DESC`)).recordset;
  const payment = await paymentOf(db, id);
  const registry = await registryOf(db, id);
  const parties = partiesOf(d.DeedType);
  const mand = docs.filter((x) => x.IsMandatory && x.DocumentType !== "RegisteredDeed");
  const iso = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
  const at = (s) => LIVE.indexOf(d.Status) >= LIVE.indexOf(s);
  const steps = [
    { key: "papers", label: "Legal executive & papers", ok: at("UnderReview"), checks: [
      { label: "Legal executive assigned", ok: !!d.LegalExecutiveId, hint: d.LegalExecutiveName || null },
      ...mand.map((x) => ({ label: `${x.Label} (${x.Party.toLowerCase()})`, ok: x.Status === "Verified", docId: x.Id, status: x.Status })),
    ] },
    { key: "legal", label: "Legal Head approval", ok: at("LegalApproved"), checks: [
      { label: "Approved by the Legal Head", ok: at("LegalApproved"), hint: d.SeniorApprovalStatus === "Pending" ? "Waiting in the Approval Inbox" : d.SeniorRemarks || null },
    ] },
    { key: "parties", label: parties.length > 1 ? "Seller & buyer approval" : "Seller approval", ok: at("PartiesApproved"), checks: parties.map((p) => ({
      label: `${p} approved the draft`, ok: d[`${p}Approval`] === "Approved" || at("PartiesApproved"), party: p,
      hint: d[`${p}Approval`] === "Approved" ? (d[`${p}ViaProxy`] ? "recorded by staff" : "in the portal") : d[`${p}Remarks`] || null,
    })) },
    { key: "date", label: "Signing date", ok: at("DateApproved"), checks: [
      { label: "Date proposed", ok: !!d.ProposedDate || at("DateApproved"), hint: d.ProposedDate ? `${iso(d.ProposedDate)} by ${d.ProposedBy}` : null },
      ...parties.map((p) => ({ label: `${p} accepted the date`, ok: !!d[`${p}DateAccepted`] || at("DateApproved"), party: p })),
      { label: "Date approved", ok: at("DateApproved"), hint: d.DateApprovalStatus === "Pending" ? "Waiting in the Approval Inbox" : d.DeedDate ? iso(d.DeedDate) : null },
    ] },
    { key: "duty", label: "Stamp duty", ok: payment?.Status === "Confirmed", checks: [
      { label: "Duty & fee assessed and sent to the payer", ok: !!payment, hint: payment ? `₹${Number(payment.StampDuty).toLocaleString("en-IN")} + ₹${Number(payment.RegistrationFee).toLocaleString("en-IN")} · ${payment.PayableBy}` : null },
      { label: "Paid, with proof", ok: !!payment && ["ProofUploaded", "Confirmed"].includes(payment.Status), hint: payment?.PaidRef || payment?.ConfirmRemarks || null },
      { label: "Payment confirmed", ok: payment?.Status === "Confirmed" },
    ] },
    { key: "executed", label: "Signed (executed)", ok: at("Executed"), checks: [{ label: "Executed by every party", ok: at("Executed"), hint: d.ExecutedAt ? iso(d.ExecutedAt) : d.DeedDate ? `On or after ${iso(d.DeedDate)}` : null }] },
    { key: "registry", label: "Sub-Registrar registration", ok: d.Status === "Registered", checks: [
      { label: "Visit scheduled", ok: !!registry, hint: registry ? `${registry.Office} · ${new Date(registry.ScheduledAt).toISOString().slice(0, 16).replace("T", " ")}` : null },
      { label: "Registered copy verified", ok: docs.some((x) => x.DocumentType === "RegisteredDeed" && x.Status === "Verified") },
      { label: "Registered", ok: d.Status === "Registered", hint: registry?.RegNo || null },
    ] },
  ];
  let found = false;
  for (const s of steps) {
    s.state = d.Status === "Cancelled" ? (s.ok ? "done" : "stopped") : s.ok ? "done" : found ? "waiting" : "current";
    if (!s.ok) found = true;
  }
  return {
    deed: {
      Id: d.Id, DeedNo: d.DeedNo, ResaleId: d.ResaleId, BookingId: d.BookingId, BookingNo: d.BookingNo, Property: d.Property, DeedType: d.DeedType, Kind: d.Kind,
      Status: d.Status, StatusLabel: STATUS_LABEL[d.Status] || d.Status, SellerName: d.SellerName, BuyerName: d.BuyerName,
      SellerCustomerId: d.FromCustomerId, BuyerCustomerId: d.ToCustomerId, LegalExecutiveId: d.LegalExecutiveId, LegalExecutiveName: d.LegalExecutiveName,
      SeniorApprovalStatus: d.SeniorApprovalStatus, SeniorRemarks: d.SeniorRemarks, SentToPartiesAt: d.SentToPartiesAt,
      SellerApproval: d.SellerApproval, BuyerApproval: d.BuyerApproval, SellerRemarks: d.SellerRemarks, BuyerRemarks: d.BuyerRemarks,
      ProposedDate: iso(d.ProposedDate), ProposedBy: d.ProposedBy, SellerDateAccepted: !!d.SellerDateAccepted, BuyerDateAccepted: !!d.BuyerDateAccepted,
      DateApprovalStatus: d.DateApprovalStatus, DeedDate: iso(d.DeedDate), ExecutedAt: d.ExecutedAt, VersionNo: d.VersionNo, RecheckCount: d.RecheckCount,
      CreatedAt: d.CreatedAt,
    },
    parties, documents: docs, payment, registry, history, steps,
    currentStep: steps.find((s) => s.state === "current")?.key || null,
    proxyMethods: PROXY_METHODS,
  };
}

async function listDeeds(db, { status = null, projectScope = null } = {}) {
  const req = db.request();
  const conds = ["d.IsActive = 1"];
  if (status) { req.input("st", sql.NVarChar(30), status); conds.push("d.Status = @st"); }
  if (projectScope) conds.push(require("./projectScope").projectPredicate(projectScope, "b.ProjectId", "").trim());
  return (await req.query(`
    SELECT d.Id, d.DeedNo, d.ResaleId, d.DeedType, d.Status, d.SeniorApprovalStatus, d.DateApprovalStatus, d.ProposedDate, d.DeedDate, d.CreatedAt, d.UpdatedAt,
           d.SellerApproval, d.BuyerApproval,
           r.Kind, fc.CustomerName AS SellerName, tc.CustomerName AS BuyerName, b.BookingNo, COALESCE(b.UnitNo, b.BookingNo) AS Property,
           le.name AS LegalExecutiveName,
           (SELECT COUNT(*) FROM dbo.CrmTransferDeedDocument x WHERE x.DeedId = d.Id AND x.IsActive = 1 AND x.IsMandatory = 1 AND x.DocumentType <> N'RegisteredDeed') AS DocsRequired,
           (SELECT COUNT(*) FROM dbo.CrmTransferDeedDocument x WHERE x.DeedId = d.Id AND x.IsActive = 1 AND x.IsMandatory = 1 AND x.DocumentType <> N'RegisteredDeed' AND x.Status = N'Verified') AS DocsVerified,
           p.Status AS DutyStatus, p.StampDuty, p.RegistrationFee, p.PayableBy, p.PaidRef,
           g.Status AS RegistryStatus, g.Office AS RegistryOffice, g.ScheduledAt AS RegistryAt, g.RegNo
    FROM dbo.CrmTransferDeed d
    JOIN dbo.CrmUnitResale r ON r.Id = d.ResaleId
    LEFT JOIN dbo.CrmCustomer fc ON fc.Id = r.FromCustomerId LEFT JOIN dbo.CrmCustomer tc ON tc.Id = r.ToCustomerId
    LEFT JOIN dbo.CrmBooking b ON b.Id = d.BookingId LEFT JOIN dbo.Users le ON le.id = d.LegalExecutiveId
    LEFT JOIN dbo.CrmTransferDeedPayment p ON p.DeedId = d.Id AND p.IsActive = 1
    LEFT JOIN dbo.CrmTransferDeedRegistry g ON g.DeedId = d.Id AND g.IsActive = 1 AND g.Status <> N'Cancelled'
    WHERE ${conds.join(" AND ")} ORDER BY ISNULL(d.UpdatedAt, d.CreatedAt) DESC`)).recordset;
}

module.exports = {
  DeedError, PROXY_METHODS, openForCase, assignLegal, requestDocument, uploadDocument, reviewDocument, documentFile,
  submitForLegal, legalDecision, sendToParties, partyRespond, proposeDate, acceptDate, dateDecision, markExecuted,
  sendDutyInfo, uploadDutyProof, confirmDuty, dutyProof, scheduleRegistry, uploadRegisteredCopy, verifyRegisteredCopy, completeRegistry,
  cancelDeed, deedState, listDeeds, partiesOf,
};
