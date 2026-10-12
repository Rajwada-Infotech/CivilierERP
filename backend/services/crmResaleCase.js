// A resale / buy-back CASE (migration 558): the stages a sold property goes
// through before it passes to a new buyer, or back to us.
//
// Resale (rules for passing a flat on before conveyance — RERA allottee
// transfer, West Bengal practice):
//   1 request      — property, seller, buyer, agreed price, transfer fee
//   2 clearance    — every demanded / overdue milestone paid; the seller's
//                    home-loan NOC / closure letter if they have a loan; no
//                    open cancellation or refund on the property
//   3 noc          — the developer's NOC for the transfer
//   4 buyer        — the new buyer's application and KYC
//   5 approval     — Marketing Head -> Director (Approval Inbox)
//   6 fee          — the transfer fee invoiced to the buyer and paid
//   7 deed         — tripartite deed of assignment: draft -> legal approval ->
//                    seller & buyer consent -> executed -> stamp duty paid -> registered
//   8 transfer     — the booking passes to the buyer
// Buy-back: request -> clearance -> approval -> deed (a registered
// cancellation deed when the agreement is registered, else a cancellation
// letter) -> payout through Finance -> back to stock.
//
// Every stage is worked out from the real records each time (never a stored
// flag that can drift), and each blocks the next.
const { sql } = require("../db");

class CaseError extends Error { constructor(m, status = 400) { super(m); this.status = status; } }

const DOC_TYPES = {
  SellerLoanNoc: "Seller's home-loan NOC / closure letter",
  DeveloperNoc: "Developer NOC (signed)",
  DeedDraft: "Deed draft",
  StampDutyReceipt: "Stamp duty & registration fee receipt",
  RegisteredDeed: "Registered deed",
  CancellationLetter: "Cancellation letter (signed)",
  Other: "Other",
};
const DEED_STEPS = ["Draft", "LegalApproved", "Consented", "Executed", "DutyPaid", "Registered"];

const DEED_LABEL = { Draft: "Drafted", LegalApproved: "Legal approved", Consented: "Both parties consented", Executed: "Executed", DutyPaid: "Stamp duty paid", Registered: "Registered" };
const nextDeedStep = (cur) => (cur == null ? "Draft" : DEED_STEPS[DEED_STEPS.indexOf(cur) + 1] || null);
function deedNextHint(next, docs) {
  const has = (t) => docs.some((d) => d.DocumentType === t && d.Status !== "Rejected");
  switch (next) {
    case "Draft": return has("DeedDraft") ? "Start the deed from the uploaded draft" : "Upload the deed draft";
    case "LegalApproved": return "Legal approval of the draft (someone other than who uploaded it verifies the draft)";
    case "Consented": return "Record the seller's and the buyer's consent to the draft";
    case "Executed": return "Record the date the deed was signed (executed)";
    case "DutyPaid": return "Enter the stamp duty and registration fee assessed, with the paid receipt";
    case "Registered": return "Enter the registration number, date and Sub-Registrar office, with the registered copy";
    default: return "";
  }
}
const idsOf = (r) => String(r.BookingIds || r.FromBookingId || "").split(",").map(Number).filter(Number.isInteger);

async function loadCase(db, id) {
  const r = (await db.request().input("id", sql.Int, id).query(`
    SELECT r.*, fc.CustomerName AS FromName, tc.CustomerName AS ToName,
           tc.PanNo AS ToPan, tc.AadhaarNo AS ToAadhaar, tc.Address AS ToAddress, tc.Mobile AS ToMobile,
           b.BookingNo, COALESCE(b.UnitNo, b.BookingNo) AS Property,
           fi.InvoiceNo AS FeeInvoiceNo, fi.Status AS FeeInvoiceStatus,
           frp.RPDocNo AS FeeReceiptNo, frp.RPStatus AS FeeReceiptStatus
    FROM dbo.CrmUnitResale r
    LEFT JOIN dbo.CrmInvoice fi ON fi.Id = r.FeeInvoiceId
    LEFT JOIN dbo.ReceivedPayment frp ON frp.RPPaymentID = r.FeeReceivedPaymentId
    LEFT JOIN dbo.CrmCustomer fc ON fc.Id = r.FromCustomerId
    LEFT JOIN dbo.CrmCustomer tc ON tc.Id = r.ToCustomerId
    LEFT JOIN dbo.CrmBooking b ON b.Id = r.FromBookingId
    WHERE r.Id = @id AND r.IsActive = 1`)).recordset[0];
  if (!r) throw new CaseError("Case not found", 404);
  return r;
}

/** Seller-side facts: overdue dues, open cancellation / refund, loan, agreement. */
async function sellerFacts(db, r) {
  const ids = idsOf(r);
  const list = ids.join(",") || "0";
  const q = async (text) => (await db.request().query(text)).recordset;
  const overdue = await q(`
    SELECT m.BookingId, m.MilestoneName, m.AmountDue - ISNULL(m.AmountPaid, 0) AS Balance, m.DemandNo
    FROM dbo.CrmPaymentMilestone m
    WHERE m.BookingId IN (${list}) AND m.Status NOT IN (N'Paid', N'Waived')
      AND m.DemandStatus NOT IN (N'Pending', N'Paid') AND m.AmountDue - ISNULL(m.AmountPaid, 0) > 0.009`);
  // Under the full-booking hold, money paid stays On Account (milestones only
  // settle once the whole price is in) — so a demand is covered when what
  // sits on account pays it, even though the milestone isn't marked Paid yet.
  const onAccount = Number((await q(`SELECT ISNULL(SUM(Amount - ISNULL(AppliedAmount, 0)), 0) AS v FROM dbo.CrmOnAccountPayment
    WHERE BookingId IN (${list}) AND ISNULL(Status, N'') NOT IN (N'Bounced', N'Held')`))[0].v) || 0;
  const demandedTotal = overdue.reduce((t, m) => t + Number(m.Balance || 0), 0);
  const uncovered = Math.max(0, Math.round((demandedTotal - onAccount) * 100) / 100);
  const openCancellation = (await q(`SELECT TOP 1 CancellationNo FROM dbo.CrmCancellation WHERE BookingId IN (${list}) AND Status NOT IN (N'Rejected', N'Withdrawn', N'Cancelled')`))[0] || null;
  const openRefund = (await q(`SELECT TOP 1 RefundNo FROM dbo.CrmRefund WHERE BookingId IN (${list}) AND Status NOT IN (N'Paid', N'Rejected', N'Cancelled')`))[0] || null;
  const loans = await q(`SELECT BankName, LoanAmount, SanctionStatus FROM dbo.CrmLoanDetail WHERE BookingId IN (${list}) AND ISNULL(SanctionStatus, N'') NOT IN (N'Rejected', N'Withdrawn', N'Closed', N'NotApplied')`);
  const agreement = (await q(`SELECT TOP 1 Id, AgreementNo, Status FROM dbo.CrmAgreement WHERE BookingId IN (${list}) ORDER BY CASE WHEN BookingId = ${Number(r.FromBookingId) || 0} THEN 0 ELSE 1 END`))[0] || null;
  return { overdue, onAccount, demandedTotal, uncovered, openCancellation, openRefund, loans, agreement };
}

async function docsOf(db, id) {
  return (await db.request().input("id", sql.Int, id).query(`
    SELECT d.Id, d.DocumentType, d.FileName, d.FileSize, d.MimeType, d.Status, d.Remarks, d.CreatedAt, d.VerifiedAt,
           u.name AS UploadedByName, v.name AS VerifiedByName
    FROM dbo.CrmResaleDocument d
    LEFT JOIN dbo.Users u ON u.id = d.CreatedBy LEFT JOIN dbo.Users v ON v.id = d.VerifiedBy
    WHERE d.ResaleId = @id AND d.IsActive = 1 ORDER BY d.Id`)).recordset;
}
const verified = (docs, type) => docs.some((d) => d.DocumentType === type && d.Status === "Verified");

/** Everything the case page shows: stages with state + what blocks them. */
async function caseState(db, id) {
  const r = await loadCase(db, id);
  const isResale = r.Kind !== "BuyBack";
  const f = await sellerFacts(db, r);
  const docs = await docsOf(db, id);
  const hasLoan = r.SellerHasLoan != null ? !!r.SellerHasLoan : f.loans.length > 0;
  const fmt = (n) => `₹${Number(n).toLocaleString("en-IN")}`;
  const done = r.Status === "Completed";
  const dead = ["Rejected", "Cancelled"].includes(r.Status);

  // 2 clearance
  const clearanceBlockers = [];
  if (f.uncovered > 0.009) {
    clearanceBlockers.push(`${fmt(f.uncovered)} demanded and not yet paid (${f.overdue.map((m) => `${m.MilestoneName}${m.DemandNo ? ` ${m.DemandNo}` : ""}`).join(", ")}${f.onAccount > 0 ? `; ${fmt(f.onAccount)} on account already counted` : ""})`);
  }
  if (f.openCancellation) clearanceBlockers.push(`Cancellation ${f.openCancellation.CancellationNo} is open on this property`);
  if (f.openRefund) clearanceBlockers.push(`Refund ${f.openRefund.RefundNo} is open on this property`);
  if (hasLoan && !verified(docs, "SellerLoanNoc")) clearanceBlockers.push("The seller has a home loan — upload and verify their bank's NOC / closure letter");

  // 4 buyer
  const buyerBlockers = [];
  if (isResale) {
    if (!r.ToCustomerId) buyerBlockers.push("Choose the new buyer");
    else {
      if (!r.ToPan) buyerBlockers.push("Buyer's PAN is missing (Customers)");
      if (!r.ToAadhaar) buyerBlockers.push("Buyer's Aadhaar is missing (Customers)");
      if (!r.ToAddress) buyerBlockers.push("Buyer's address is missing (Customers)");
      if (!r.BuyerApplicationId) buyerBlockers.push("Open the buyer's application from this case");
    }
  }

  // 7 deed
  const deedType = isResale ? "Assignment" : (f.agreement?.Status === "Registered" ? "CancellationDeed" : "CancellationLetter");
  const deedStatus = r.DeedStatus || null;
  const deedIdx = deedStatus ? DEED_STEPS.indexOf(deedStatus) : -1;
  const deedComplete = deedType === "CancellationLetter" ? verified(docs, "CancellationLetter") : deedStatus === "Registered";
  const deedNext = deedType === "CancellationLetter" ? null : nextDeedStep(deedStatus);
  const deedBlockers = deedComplete ? [] : deedType === "CancellationLetter"
    ? ["Upload the signed cancellation letter and have it verified"]
    : [deedNextHint(deedNext, docs)];

  // 6 fee
  const fee = Math.round((Number(r.DeveloperFeeAmount || 0) + Number(r.DeveloperFeeGstAmount || 0)) * 100) / 100;
  const feeOk = !(fee > 0) || (!!r.FeeInvoiceId && r.FeeInvoiceStatus !== "Void" && r.FeeReceiptStatus === "Approved");
  const feeBlockers = feeOk ? [] : !r.FeeInvoiceId || r.FeeInvoiceStatus === "Void"
    ? [`Issue the transfer-fee invoice to the buyer (${fmt(fee)} with GST)`]
    : !r.FeeReceivedPaymentId || r.FeeReceiptStatus === "Rejected"
      ? ["Record the buyer's fee payment — it goes to Finance for approval"]
      : [`Fee payment ${r.FeeReceiptNo || ""} is waiting for Finance approval`];

  const stage = (key, label, ok, blockers = [], detail = null, na = false) => ({ key, label, ok: !!ok, blockers, detail, na });
  const stages = [
    stage("request", "Request", true, [], `${r.Property} · ${r.FromName || "—"}${isResale ? ` → ${r.ToName || "—"}` : " → us"}`),
    stage("clearance", "Seller clearance", !!r.SellerClearedAt && !clearanceBlockers.length, clearanceBlockers,
      r.SellerClearedAt ? "Confirmed" : clearanceBlockers.length ? null : "All checks pass — confirm to continue"),
    ...(isResale ? [stage("noc", "Developer NOC", !!r.NocIssuedAt, r.SellerClearedAt ? [] : ["Seller clearance first"], r.NocNo || null)] : []),
    ...(isResale ? [stage("buyer", "New buyer", !buyerBlockers.length, buyerBlockers, r.ToName || null)] : []),
    stage("approval", "Approval", ["Approved", "Completed"].includes(r.Status), r.Status === "Pending" ? ["Waiting in the Approval Inbox (Marketing Head → Director)"] : [], r.Status),
    ...(isResale ? [stage("fee", "Transfer fee", feeOk, feeBlockers,
      fee > 0 ? [fmt(fee), r.FeeInvoiceNo, r.FeeReceiptNo && `${r.FeeReceiptNo} ${r.FeeReceiptStatus}`].filter(Boolean).join(" · ") : "No fee", !(fee > 0))] : []),
    stage("deed", deedType === "Assignment" ? "Deed of assignment" : deedType === "CancellationDeed" ? "Cancellation deed" : "Cancellation letter",
      deedComplete, deedBlockers, deedType === "CancellationLetter" ? (verified(docs, "CancellationLetter") ? "Signed letter verified" : null) : (DEED_LABEL[deedStatus] || "Not started")),
    stage(isResale ? "transfer" : "payout", isResale ? "Transfer" : "Payout & back to stock", done, [], done ? "Completed" : null),
  ];
  // The checklist each step shows: every requirement, done or not, with the
  // document it needs (uploaded and verified right there in the step).
  const feeApproved = r.FeeReceiptStatus === "Approved";
  const checks = {
    request: [{ label: "Case recorded", ok: true }],
    clearance: [
      { label: "Every demanded amount is paid", ok: !(f.uncovered > 0.009),
        hint: !f.overdue.length ? null
          : f.uncovered > 0.009
            ? `${fmt(f.uncovered)} still due — ${f.overdue.map((m) => `${m.MilestoneName} ${fmt(m.Balance)}`).join(" · ")}${f.onAccount > 0 ? ` (${fmt(f.onAccount)} on account counted)` : ""}`
            : `Covered by ${fmt(f.onAccount)} paid on account (settles when the full price is in)` },
      { label: "No open cancellation or refund", ok: !f.openCancellation && !f.openRefund,
        hint: [f.openCancellation?.CancellationNo, f.openRefund?.RefundNo].filter(Boolean).join(", ") || null },
      hasLoan
        ? { label: "Seller's bank NOC / loan-closure letter verified", ok: verified(docs, "SellerLoanNoc"), doc: "SellerLoanNoc",
            hint: f.loans.length ? `Loan with ${f.loans.map((l) => l.BankName).join(", ")}` : "Marked as having a loan" }
        : { label: "No home loan on the property", ok: true, hint: "From Loan Tracking — change it if that's wrong" },
      { label: "Clearance confirmed by staff", ok: !!r.SellerClearedAt, action: "clearance" },
    ],
    noc: [{ label: "Developer NOC issued", ok: !!r.NocIssuedAt, action: "noc", hint: r.NocNo || null }],
    buyer: [
      { label: "New buyer chosen", ok: !!r.ToCustomerId, hint: r.ToName || null },
      { label: "Buyer's PAN on file", ok: !!r.ToPan, link: "kyc" },
      { label: "Buyer's Aadhaar on file", ok: !!r.ToAadhaar, link: "kyc" },
      { label: "Buyer's address on file", ok: !!r.ToAddress, link: "kyc" },
      { label: "Buyer's application opened (add co-applicants there)", ok: !!r.BuyerApplicationId, action: "buyer-application", link: r.BuyerApplicationId ? "application" : null },
    ],
    approval: [{ label: "Approved by Marketing Head, then Director", ok: ["Approved", "Completed"].includes(r.Status), link: "inbox", hint: r.Status === "Pending" ? "Waiting in the Approval Inbox" : null }],
    fee: [
      { label: `Fee invoice issued to the buyer (${fmt(fee)} incl. GST)`, ok: !!r.FeeInvoiceId && r.FeeInvoiceStatus !== "Void", action: "fee-invoice", hint: r.FeeInvoiceNo || null },
      { label: "Buyer's payment recorded", ok: !!r.FeeReceivedPaymentId && r.FeeReceiptStatus !== "Rejected", action: "fee-payment", hint: r.FeeReceiptNo || null },
      { label: "Payment approved by Finance", ok: feeApproved, hint: r.FeeReceivedPaymentId && !feeApproved ? "Finance → Received Payments" : null },
    ],
    deed: deedType === "CancellationLetter"
      ? [{ label: "Signed cancellation letter verified", ok: verified(docs, "CancellationLetter"), doc: "CancellationLetter" }]
      : [
          { label: "Draft uploaded and the deed started", ok: deedIdx >= 0, doc: "DeedDraft", step: "Draft" },
          { label: "Legal approval (draft verified by someone else)", ok: deedIdx >= 1, step: "LegalApproved" },
          { label: isResale ? "Seller and buyer consent to the draft" : "Seller consents to the draft", ok: deedIdx >= 2, step: "Consented" },
          { label: "Deed signed (executed)", ok: deedIdx >= 3, step: "Executed", hint: r.DeedExecutionDate ? new Date(r.DeedExecutionDate).toISOString().slice(0, 10) : null },
          { label: "Stamp duty & registration fee paid (receipt verified)", ok: deedIdx >= 4, doc: "StampDutyReceipt", step: "DutyPaid",
            hint: r.DeedDutyPaidAt ? `${fmt(r.DeedStampDuty)} + ${fmt(r.DeedRegistrationFee)} · ${r.DeedDutyPaidRef}` : null },
          { label: "Registered at the Sub-Registrar (copy verified)", ok: deedIdx >= 5, doc: "RegisteredDeed", step: "Registered",
            hint: r.DeedRegNo ? `${r.DeedRegNo} · ${r.DeedRegOffice}` : null },
        ],
    transfer: [{ label: "Booking passed to the buyer", ok: done, action: "transfer" }],
    payout: [{ label: "Payout sent to Finance and paid", ok: done, action: "send-to-finance", hint: r.PayoutNewPaymentId ? "With Finance" : null }],
  };
  stages.forEach((st) => { st.checks = checks[st.key] || []; });

  // Each stage needs every stage before it.
  let blockedFrom = -1;
  stages.forEach((s, i) => {
    s.state = done ? "done" : s.ok ? "done" : blockedFrom === -1 ? "current" : "waiting";
    if (!s.ok && blockedFrom === -1) blockedFrom = i;
  });
  if (dead) stages.forEach((s) => { if (s.state !== "done") s.state = "stopped"; });
  if (done) stages.forEach((s) => { s.blockers = []; }); // finished — nothing is waiting

  return {
    case: {
      Id: r.Id, Kind: r.Kind, Status: r.Status, Property: r.Property, BookingNo: r.BookingNo, BookingIds: idsOf(r),
      FromCustomerId: r.FromCustomerId, FromName: r.FromName, ToCustomerId: r.ToCustomerId, ToName: r.ToName,
      AgreedValue: r.AgreedValue, OriginalValue: r.OriginalValue, DeveloperFeeAmount: r.DeveloperFeeAmount, DeveloperFeeGstAmount: r.DeveloperFeeGstAmount,
      SellerHasLoan: hasLoan, SellerHasLoanSetByStaff: r.SellerHasLoan != null, SellerClearedAt: r.SellerClearedAt,
      NocNo: r.NocNo, NocIssuedAt: r.NocIssuedAt, BuyerApplicationId: r.BuyerApplicationId, FeeInvoiceId: r.FeeInvoiceId,
      DeedType: deedType, DeedStatus: deedStatus, DeedStep: deedIdx, DeedNext: deedNext,
      FeeTotal: fee, FeeInvoiceNo: r.FeeInvoiceNo, FeeInvoiceStatus: r.FeeInvoiceStatus, FeeReceivedPaymentId: r.FeeReceivedPaymentId,
      FeeReceiptNo: r.FeeReceiptNo, FeeReceiptStatus: r.FeeReceiptStatus,
      DeedExecutionDate: r.DeedExecutionDate, DeedStampDuty: r.DeedStampDuty, DeedRegistrationFee: r.DeedRegistrationFee,
      DeedDutyPaidAt: r.DeedDutyPaidAt, DeedDutyPaidRef: r.DeedDutyPaidRef, DeedRegNo: r.DeedRegNo, DeedRegDate: r.DeedRegDate, DeedRegOffice: r.DeedRegOffice,
      DeedSellerConsentAt: r.DeedSellerConsentAt, DeedBuyerConsentAt: r.DeedBuyerConsentAt,
      RejectionNote: r.RejectionNote, CreatedAt: r.CreatedAt, CompletedAt: r.CompletedAt,
    },
    seller: { overdue: f.overdue, openCancellation: f.openCancellation, openRefund: f.openRefund, loans: f.loans, agreement: f.agreement },
    documents: docs,
    docTypes: DOC_TYPES,
    stages,
    currentStage: stages.find((s) => s.state === "current")?.key || null,
  };
}

/** Stage 2: staff confirm the seller is clear (re-checked here). */
async function confirmClearance(db, id, actorUserId) {
  const st = await caseState(db, id);
  if (["Rejected", "Cancelled", "Completed"].includes(st.case.Status)) throw new CaseError(`This case is ${st.case.Status}`, 409);
  const s = st.stages.find((x) => x.key === "clearance");
  if (s.blockers.length) throw new CaseError(`Not clear yet: ${s.blockers.join("; ")}`, 409);
  await db.request().input("id", sql.Int, id).input("by", sql.Int, actorUserId)
    .query("UPDATE dbo.CrmUnitResale SET SellerClearedAt = ISNULL(SellerClearedAt, SYSDATETIME()), SellerClearedBy = ISNULL(SellerClearedBy, @by), UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @id");
  return caseState(db, id);
}

/** Staff record whether the seller has a home loan (overrides what Loan Tracking shows). */
async function setSellerLoan(db, id, hasLoan, actorUserId) {
  const st = await caseState(db, id);
  if (st.case.SellerClearedAt) throw new CaseError("Clearance is already confirmed", 409);
  await db.request().input("id", sql.Int, id).input("v", sql.Bit, hasLoan ? 1 : 0).input("by", sql.Int, actorUserId)
    .query("UPDATE dbo.CrmUnitResale SET SellerHasLoan = @v, UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @id");
  return caseState(db, id);
}

/** Stage 3: the developer's NOC for the transfer (resale only). */
async function issueNoc(db, id, actorUserId) {
  const st = await caseState(db, id);
  if (st.case.Kind === "BuyBack") throw new CaseError("A buy-back has no transfer NOC");
  if (st.case.NocIssuedAt) throw new CaseError(`NOC ${st.case.NocNo} is already issued`, 409);
  if (!st.case.SellerClearedAt) throw new CaseError("Confirm the seller clearance first", 409);
  const { getNextDocNumber } = require("./docNumber");
  const nocNo = await getNextDocNumber(db, "RNOC", "RNOC");
  await db.request().input("id", sql.Int, id).input("no", sql.NVarChar(40), nocNo).input("by", sql.Int, actorUserId)
    .query("UPDATE dbo.CrmUnitResale SET NocNo = @no, NocIssuedAt = SYSDATETIME(), NocIssuedBy = @by, UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @id AND NocIssuedAt IS NULL");
  return caseState(db, id);
}

/**
 * Stage 4: the buyer's application, opened from the case so their KYC and
 * co-applicants are set up on the Applications page before the transfer. It
 * carries no unit yet (the unit is still the seller's — no hold, no booking);
 * the transfer gives it the unit / plot lines and makes the booking its own.
 */
async function openBuyerApplication(db, id, actorUserId) {
  const r = await loadCase(db, id);
  if (r.Kind === "BuyBack") throw new CaseError("A buy-back has no new buyer");
  if (["Rejected", "Cancelled", "Completed"].includes(r.Status)) throw new CaseError(`This case is ${r.Status}`, 409);
  if (!r.ToCustomerId) throw new CaseError("Choose the new buyer first");
  if (r.BuyerApplicationId) return { applicationId: r.BuyerApplicationId, state: await caseState(db, id) };
  const buyer = (await db.request().input("c", sql.Int, r.ToCustomerId)
    .query("SELECT Id, CustomerName, Mobile, Email FROM dbo.CrmCustomer WHERE Id = @c AND IsActive = 1")).recordset[0];
  if (!buyer) throw new CaseError("The buyer's customer record was not found");
  const b = (await db.request().input("b", sql.Int, r.FromBookingId)
    .query("SELECT ProjectId, CompanyId, UnitNo FROM dbo.CrmBooking WHERE Id = @b")).recordset[0] || {};
  const { getNextDocNumber } = require("./docNumber");
  const appNo = await getNextDocNumber(db, "APP", "APP");
  const app = await db.request()
    .input("no", sql.NVarChar(50), appNo).input("cid", sql.Int, buyer.Id).input("name", sql.NVarChar(200), buyer.CustomerName)
    .input("mob", sql.NVarChar(20), buyer.Mobile || null).input("em", sql.NVarChar(200), buyer.Email || null)
    .input("pid", sql.Int, b.ProjectId ?? null).input("co", sql.Int, b.CompanyId ?? null).input("unit", sql.NVarChar(200), b.UnitNo || null)
    .input("by", sql.Int, actorUserId)
    .input("note", sql.NVarChar(sql.MAX), `Resale case #${id}: ${b.UnitNo || "property"} to pass to ${buyer.CustomerName} on transfer.`)
    .query(`INSERT INTO dbo.CrmApplication (ApplicationNo, CustomerId, ApplicantName, Mobile, Email, ProjectId, CompanyId,
              InterestedUnit, Source, Status, Notes, DateOfApply, IsActive, CreatedBy, CreatedAt, AssignedTo, AssignedBy)
            OUTPUT INSERTED.Id
            VALUES (@no, @cid, @name, @mob, @em, @pid, @co, @unit, N'Other', N'Draft', @note, CAST(SYSDATETIME() AS DATE), 1, @by, SYSDATETIME(), @by, @by)`);
  const appId = app.recordset[0].Id;
  await db.request().input("id", sql.Int, id).input("a", sql.Int, appId).input("by", sql.Int, actorUserId)
    .query("UPDATE dbo.CrmUnitResale SET BuyerApplicationId = @a, UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @id AND BuyerApplicationId IS NULL");
  return { applicationId: appId, state: await caseState(db, id) };
}

/** Stage 6a: the transfer-fee invoice, billed to the new buyer (fee + its own GST). */
async function issueFeeInvoice(db, id, actorUserId, actorEmail) {
  const r = await loadCase(db, id);
  if (r.Kind === "BuyBack") throw new CaseError("A buy-back has no transfer fee");
  if (["Rejected", "Cancelled", "Completed"].includes(r.Status)) throw new CaseError(`This case is ${r.Status}`, 409);
  if (!(Number(r.DeveloperFeeAmount) > 0)) throw new CaseError("This case has no transfer fee");
  // Income is booked when the fee is invoiced — only for an approved case.
  if (r.Status !== "Approved") throw new CaseError("Issue the fee invoice once the case is approved", 409);
  if (r.FeeInvoiceId && r.FeeInvoiceStatus !== "Void") throw new CaseError(`Invoice ${r.FeeInvoiceNo} is already issued`, 409);
  if (!r.ToCustomerId) throw new CaseError("Choose the new buyer first");
  const total = Math.round((Number(r.DeveloperFeeAmount) + Number(r.DeveloperFeeGstAmount || 0)) * 100) / 100;
  const { getNextDocNumber } = require("./docNumber");
  const invNo = await getNextDocNumber(db, "INV", "INV");
  const ins = await db.request().input("no", sql.NVarChar(50), invNo).input("b", sql.Int, r.FromBookingId)
    .input("amt", sql.Decimal(18, 2), total).input("rid", sql.Int, id).input("by", sql.Int, actorUserId)
    .input("d", sql.NVarChar(500), `Transfer fee — ${r.Property} passing to ${r.ToName} (resale case #${id})`)
    .query(`INSERT INTO dbo.CrmInvoice (InvoiceNo, BookingId, InvoiceType, Amount, InvoiceDate, Description, Status, CreatedBy, CreatedAt, ResaleId)
            OUTPUT INSERTED.Id VALUES (@no, @b, N'TransferFee', @amt, CAST(SYSDATETIME() AS DATE), @d, N'Generated', @by, SYSDATETIME(), @rid)`);
  await db.request().input("id", sql.Int, id).input("inv", sql.Int, ins.recordset[0].Id).input("by", sql.Int, actorUserId)
    .query("UPDATE dbo.CrmUnitResale SET FeeInvoiceId = @inv, UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @id");
  // The fee is earned when it is invoiced: Dr buyer / Cr transfer fee + GST output.
  // Idempotent per case, so the transfer's own call is then a no-op.
  let ledger = null;
  try {
    ledger = await require("./crmLedger").postCrmResaleFeeToGL(db, id, actorEmail || "system");
    await require("./approvalService").recordGLPosting("crm-resale", id, ledger, actorEmail || "system");
  } catch (e) { ledger = { posted: false, reason: e.message }; }
  return { invoiceNo: invNo, ledger, state: await caseState(db, id) };
}

/** Stage 6b: the buyer's fee payment — a Finance receipt (approved there) credited to the buyer. */
async function recordFeePayment(db, id, b, actorUserId, actorEmail) {
  const r = await loadCase(db, id);
  if (!r.FeeInvoiceId || r.FeeInvoiceStatus === "Void") throw new CaseError("Issue the fee invoice first", 409);
  if (r.FeeReceivedPaymentId && r.FeeReceiptStatus !== "Rejected") throw new CaseError(`Payment ${r.FeeReceiptNo || ""} is already recorded`, 409);
  const mode = String(b?.PaymentMode || "").trim();
  if (!mode) throw new CaseError("Choose the payment mode");
  if (mode !== "Cash" && !String(b?.TransactionRef || "").trim()) throw new CaseError("Enter the transaction / cheque reference");
  const total = Math.round((Number(r.DeveloperFeeAmount) + Number(r.DeveloperFeeGstAmount || 0)) * 100) / 100;
  const bk = (await db.request().input("b", sql.Int, r.FromBookingId)
    .query(`SELECT b.ProjectId, b.ProjectName, b.CompanyId, e.name AS CompanyName FROM dbo.CrmBooking b
            LEFT JOIN dbo.enterprise e ON e.id = b.CompanyId WHERE b.Id = @b`)).recordset[0] || {};
  const { createReceivedPaymentInternal } = require("../routes/receivedPayment");
  const dt = (await db.request().query("SELECT TOP 1 TypeOfDocId FROM dbo.TypeOfDoc WHERE IsActive = 1 AND links_to LIKE '%Received Payment%' ORDER BY TypeOfDocId")).recordset[0];
  const rp = await createReceivedPaymentInternal(db, {
    RPReceivedFrom: r.ToName, RPCustomerName: r.ToName,
    RPProjectName: bk.ProjectName, RPProjectId: bk.ProjectId, RPCompanyId: bk.CompanyId, RPCompanyName: bk.CompanyName || null,
    RPDocDate: b?.ReceivedDate || new Date().toISOString().slice(0, 10), RPDocTypeId: dt?.TypeOfDocId,
    RPMode: mode, RPAmount: total, RPTransactionID: b?.TransactionRef || null,
    RPRemarks: `Transfer fee — ${r.FeeInvoiceNo} (resale case #${id})`,
    RPDepositBankId: null, RPDepositBankName: null,
  }, actorEmail || String(actorUserId));
  await db.request().input("rp", sql.Int, rp.RPPaymentID).input("rid", sql.Int, id)
    .query("UPDATE dbo.ReceivedPayment SET SourceCrmResaleId = @rid, RPStatus = CASE WHEN RPStatus = 'Draft' THEN 'Pending' ELSE RPStatus END WHERE RPPaymentID = @rp");
  await db.request().input("id", sql.Int, id).input("rp", sql.Int, rp.RPPaymentID).input("by", sql.Int, actorUserId)
    .query("UPDATE dbo.CrmUnitResale SET FeeReceivedPaymentId = @rp, UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @id");
  return caseState(db, id);
}

/**
 * Stage 7: the deed, one step at a time (Draft -> LegalApproved -> Consented
 * -> Executed -> DutyPaid -> Registered). Each step checks its own evidence.
 */
async function deedStep(db, id, step, b, actorUserId) {
  const st = await caseState(db, id);
  const c = st.case;
  if (["Rejected", "Cancelled", "Completed"].includes(c.Status)) throw new CaseError(`This case is ${c.Status}`, 409);
  if (c.DeedType === "CancellationLetter") throw new CaseError("This buy-back needs a signed cancellation letter, not a deed — upload it under documents");
  if (step !== c.DeedNext) throw new CaseError(c.DeedNext ? `The next deed step is: ${DEED_LABEL[c.DeedNext] || c.DeedNext}` : "The deed is already registered", 409);
  const before = st.stages.slice(0, st.stages.findIndex((s) => s.key === "deed")).filter((s) => !s.ok && !s.na);
  // The deed is drafted and approved once the earlier stages are through.
  if (before.length) throw new CaseError(`Finish first: ${before.map((s) => s.label).join(", ")}`, 409);
  const docs = st.documents;
  const ok = (t) => docs.some((d) => d.DocumentType === t && d.Status === "Verified");
  const has = (t) => docs.some((d) => d.DocumentType === t && d.Status !== "Rejected");
  const req = db.request().input("id", sql.Int, id).input("by", sql.Int, actorUserId).input("s", sql.NVarChar(30), step);
  let set = "";
  switch (step) {
    case "Draft":
      if (!has("DeedDraft")) throw new CaseError("Upload the deed draft first");
      set = "DeedType = @t";
      req.input("t", sql.NVarChar(30), c.DeedType);
      break;
    case "LegalApproved":
      if (!ok("DeedDraft")) throw new CaseError("The deed draft must be verified (by someone other than who uploaded it)");
      set = "DeedLegalApprovedAt = SYSDATETIME(), DeedLegalApprovedBy = @by";
      break;
    case "Consented": {
      const method = String(b?.method || "").trim();
      if (!method) throw new CaseError("Say how both parties consented (signed copy, in person, email …)");
      if (c.Kind !== "BuyBack" && !(b?.seller && b?.buyer)) throw new CaseError("Both the seller and the buyer must consent");
      if (c.Kind === "BuyBack" && !b?.seller) throw new CaseError("The seller must consent");
      set = "DeedSellerConsentAt = SYSDATETIME(), DeedBuyerConsentAt = CASE WHEN @buyer = 1 THEN SYSDATETIME() ELSE NULL END, DeedConsentMethod = @m";
      req.input("m", sql.NVarChar(200), method).input("buyer", sql.Bit, b?.buyer ? 1 : 0);
      break;
    }
    case "Executed": {
      const d = String(b?.executionDate || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new CaseError("Enter the execution date");
      if (d > new Date().toISOString().slice(0, 10)) throw new CaseError("The execution date can't be in the future");
      set = "DeedExecutionDate = @d";
      req.input("d", sql.Date, d);
      break;
    }
    case "DutyPaid": {
      const duty = Number(b?.stampDuty), fee = Number(b?.registrationFee);
      if (!(duty >= 0) || !(fee >= 0) || !(duty + fee > 0)) throw new CaseError("Enter the stamp duty and registration fee assessed by the Sub-Registrar");
      if (!String(b?.paidRef || "").trim()) throw new CaseError("Enter the payment reference (GRN / challan no.)");
      if (!ok("StampDutyReceipt")) throw new CaseError("Upload the paid stamp-duty receipt and have it verified");
      const by = ["Buyer", "Seller", "Developer", "Shared"].includes(b?.paidBy) ? b.paidBy : "Buyer";
      set = "DeedStampDuty = @duty, DeedRegistrationFee = @fee, DeedDutyPaidAt = SYSDATETIME(), DeedDutyPaidRef = @ref, DeedDutyPaidBy = @pb";
      req.input("duty", sql.Decimal(18, 2), duty).input("fee", sql.Decimal(18, 2), fee).input("ref", sql.NVarChar(100), String(b.paidRef).trim()).input("pb", sql.NVarChar(30), by);
      break;
    }
    case "Registered": {
      const no = String(b?.regNo || "").trim(), d = String(b?.regDate || "").slice(0, 10), off = String(b?.regOffice || "").trim();
      if (!no || !/^\d{4}-\d{2}-\d{2}$/.test(d) || !off) throw new CaseError("Enter the registration number, date and Sub-Registrar office");
      const exec = c.DeedExecutionDate ? new Date(c.DeedExecutionDate).toISOString().slice(0, 10) : null; // a DATE comes back as a Date
      if (exec && d < exec) throw new CaseError("Registration can't be before the execution date");
      if (d > new Date().toISOString().slice(0, 10)) throw new CaseError("The registration date can't be in the future");
      if (!ok("RegisteredDeed")) throw new CaseError("Upload the registered deed copy and have it verified");
      set = "DeedRegNo = @no, DeedRegDate = @d, DeedRegOffice = @off, DeedRegisteredBy = @by";
      req.input("no", sql.NVarChar(100), no).input("d", sql.Date, d).input("off", sql.NVarChar(200), off);
      break;
    }
    default: throw new CaseError("Unknown deed step");
  }
  await req.query(`UPDATE dbo.CrmUnitResale SET DeedStatus = @s, ${set}, UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @id`);
  return caseState(db, id);
}

/** Throws unless every stage before the last (transfer / payout) is done. */
async function assertReadyToFinish(db, id) {
  const st = await caseState(db, id);
  const last = st.stages[st.stages.length - 1];
  const open = st.stages.filter((s) => s !== last && !s.ok && !s.na);
  if (open.length) {
    throw new CaseError(`Not ready yet — ${open.map((s) => `${s.label}${s.blockers[0] ? `: ${s.blockers[0]}` : ""}`).join("; ")}`, 409);
  }
  return st;
}

async function addDocument(db, id, type, file, remarks, actorUserId) {
  if (!DOC_TYPES[type]) throw new CaseError("Unknown document type");
  await loadCase(db, id);
  const r = await db.request().input("id", sql.Int, id).input("t", sql.NVarChar(40), type)
    .input("fn", sql.NVarChar(300), file.originalname).input("b64", sql.NVarChar(sql.MAX), file.buffer.toString("base64"))
    .input("fs", sql.BigInt, file.size).input("mt", sql.NVarChar(150), file.mimetype)
    .input("rem", sql.NVarChar(1000), remarks || null).input("by", sql.Int, actorUserId)
    .query(`INSERT INTO dbo.CrmResaleDocument (ResaleId, DocumentType, FileName, FileBase64, FileSize, MimeType, Remarks, CreatedBy)
            OUTPUT INSERTED.Id VALUES (@id, @t, @fn, @b64, @fs, @mt, @rem, @by)`);
  return r.recordset[0].Id;
}

/** Verify / reject a case document. The uploader can't verify their own. */
async function reviewDocument(db, id, docId, decision, remarks, actorUserId) {
  const d = (await db.request().input("d", sql.Int, docId).input("id", sql.Int, id)
    .query("SELECT Id, CreatedBy, Status FROM dbo.CrmResaleDocument WHERE Id = @d AND ResaleId = @id AND IsActive = 1")).recordset[0];
  if (!d) throw new CaseError("Document not found", 404);
  if (!["Verified", "Rejected"].includes(decision)) throw new CaseError("decision must be Verified or Rejected");
  if (decision === "Rejected" && !String(remarks || "").trim()) throw new CaseError("Say why it's rejected");
  if (d.CreatedBy && actorUserId && Number(d.CreatedBy) === Number(actorUserId)) throw new CaseError("You uploaded this document, so someone else has to verify it.", 403);
  await db.request().input("d", sql.Int, docId).input("s", sql.NVarChar(20), decision).input("rem", sql.NVarChar(1000), remarks || null).input("by", sql.Int, actorUserId)
    .query("UPDATE dbo.CrmResaleDocument SET Status = @s, Remarks = ISNULL(@rem, Remarks), VerifiedBy = @by, VerifiedAt = SYSDATETIME() WHERE Id = @d");
  return caseState(db, id);
}

async function documentFile(db, id, docId) {
  return (await db.request().input("d", sql.Int, docId).input("id", sql.Int, id)
    .query("SELECT FileName, FileBase64, MimeType FROM dbo.CrmResaleDocument WHERE Id = @d AND ResaleId = @id AND IsActive = 1")).recordset[0] || null;
}

module.exports = { caseState, confirmClearance, setSellerLoan, issueNoc, openBuyerApplication, issueFeeInvoice, recordFeePayment, deedStep, assertReadyToFinish, addDocument, reviewDocument, documentFile, CaseError, DOC_TYPES, DEED_STEPS };
