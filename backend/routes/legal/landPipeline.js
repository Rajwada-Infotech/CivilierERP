"use strict";

// Land Management pipeline — one workflow per land property (Land ID).
//   GET  /stats                     dashboard counts and recent land properties
//   GET  /:id                       header, every pipeline step with its status and gate, warnings
//   POST /:id/steps/:code           move a step: In Progress / Pending Verification / Completed /
//                                   Correction Required / Skipped (with a reason)
//   POST /:id/hold                  put the land on hold (category, reason)
//   POST /:id/resume                resume it
//   GET  /:id/audit                 the land's audit trail
//   POST /:id/ownership/change      step 5: first owner, or one change of ownership (sale, inheritance, gift…)
//   POST /:id/ownership/undo        step 5: undo the latest unverified change
//   POST /:id/ownership-transfer    step 23: the same change from the approved registered deed
//   POST /:id/final-checks/init     step 27: the final verification list
//   GET  /:id/register              step 29: the current land register and its snapshots; POST …/snapshot updates it
//   POST /:id/cancel                cancel the transaction (approve right); nothing is deleted
//   POST /enquiries/:id/convert     turn an enquiry into a land property (new Land ID)
//
// Gates are checked here, never only in the browser. A step completes only when every earlier step is
// Completed or Skipped and its own gate passes; reopening a finished step sends the finished steps after
// it back for re-verification (their history stays).

const express = require("express");
const { getPool, sql } = require("../../db");
const { requirePageRight, hasAnyPageAction } = require("../../middleware/requirePageRight");
const { canAct } = require("./approvalAuthority");
const apiRateLimit = require("../../middleware/apiRateLimit");
const { writeAudit, nextCodeSql, codePrefix } = require("./legalAudit");
const { documentGate } = require("./landDocuments");
const { DUE_DILIGENCE_CHECKS, FINAL_CHECKS } = require("./masterConfig");

const router = express.Router();
router.use(apiRateLimit);

const LAND_PAGE = "legal-land-master";
const ENQUIRY_PAGE = "legal-land-enquiry";
// Steps whose screens and gates exist today; later steps arrive phase by phase.
// Steps of later phases (no screen yet) are left out of the "finish earlier steps first" rule, so step 9
// (Phase 3) is not held up by step 8 (Phase 4); they join the rule when their phase is built.
const LIVE_PHASE = 6;
const CHECKS_PER_RECORD = 7;
const DONE = new Set(["Completed", "Skipped"]);
const STATUSES = ["In Progress", "Pending Verification", "Completed", "Correction Required", "Skipped"];
const HOLD_CATEGORIES = ["Legal Dispute", "Ownership Mismatch", "Document Missing", "Mortgage / Loan Issue", "Court Case", "Buyer / Seller Issue", "Financial Issue", "Management Decision", "Other"];
const OWNER_ROLES = ["Owner", "Joint Owner", "Legal Heir"];

const idParam = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const text = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

const requireApprove = async (req, res) => {
  if (await hasAnyPageAction(req, LAND_PAGE, ["approve"])) return true;
  res.status(403).json({ error: "Only a user with approve rights on Land Property can do this" });
  return false;
};

async function loadLand(conn, id) {
  const r = await conn.request().input("Id", sql.Int, id).query(`
    SELECT l.LandId, l.LandCode, l.LandName, l.DistrictId, l.MouzaId, l.Area, l.AreaUnitId, l.EnquiryId,
           l.LandStatus, l.WorkflowStatus, l.IsOnHold, l.IsActive, l.CreatedAt, l.IsCancelled, l.CancelReason, l.CancelledAt, l.EntryType,
           d.DistrictName, m.MouzaName, m.JLNo, u.UnitName, e.EnquiryNo
    FROM dbo.LegalLand l
    LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = l.DistrictId
    LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId
    LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = l.AreaUnitId
    LEFT JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = l.EnquiryId
    WHERE l.LandId = @Id`);
  return r.recordset[0] || null;
}

/** What each live step still needs before it can be Completed ([] = ready), plus non-blocking warnings. */
async function gates(conn, land) {
  const r = await conn.request().input("Id", sql.Int, land.LandId).query(`
    SELECT lp.LandRole, lp.SharePct, p.FullName, p.Pan, p.Aadhaar
      FROM dbo.LegalLandParty lp JOIN dbo.LegalPerson p ON p.PersonId = lp.PersonId
      WHERE lp.LandId = @Id AND lp.IsActive = 1;
    SELECT 'RS' AS Kind, VerificationStatus FROM dbo.LegalLandRsRecord WHERE LandId = @Id AND IsActive = 1
    UNION ALL SELECT 'LR', VerificationStatus FROM dbo.LegalLandLrRecord WHERE LandId = @Id AND IsActive = 1;`);
  const [parties, records] = r.recordsets;
  const need = { ENQUIRY: [], PROPERTY: [], PARTIES: [], RECORD_MAPPING: [], OWNERSHIP: [], DOCUMENTS: [], CASE_MORTGAGE: [], DUE_DILIGENCE: [], CLEARANCE: [],
    PURCHASE_SALE: [], VALUATION: [], AGREEMENT: [], PARTY_APPROVAL: [], PAYMENT: [],
    DEED_PREP: [], DRAFT_VERIFY: [], STAMP_DUTY: [], APPOINTMENT: [], SRO_REGISTRATION: [], REGISTRATION_RESULT: [], REGISTERED_DEED: [], DEED_APPROVAL: [],
    OWNERSHIP_TRANSFER: [], MUTATION_APPLY: [], MUTATION_RESULT: [], NEW_KHATIAN: [], FINAL_VERIFY: [], SETTLEMENT: [], REGISTER_UPDATE: [], AUDIT_REPORTS: [], CLOSED: [] };
  const warnings = [];

  if (!land.EnquiryId) need.ENQUIRY.push("No enquiry is linked. If the land was entered directly, skip this step with a reason.");

  for (const [col, label] of [["LandName", "Land title"], ["DistrictId", "District"], ["MouzaId", "Mouza"], ["Area", "Total land area"], ["AreaUnitId", "Area unit"]]) {
    if (land[col] === null || land[col] === undefined || land[col] === "") need.PROPERTY.push(`${label} is not entered`);
  }

  const owners = parties.filter((p) => OWNER_ROLES.includes(p.LandRole));
  if (!owners.length) need.PARTIES.push("Link at least one current owner, joint owner or legal heir");
  else if (owners.some((p) => p.SharePct === null)) need.PARTIES.push("Enter each current owner's share");
  else {
    // Shares are never adjusted automatically; an incomplete total stays pending verification.
    const total = owners.reduce((s, p) => s + Number(p.SharePct), 0);
    if (Math.abs(total - 100) > 0.0001) need.PARTIES.push(`Current owners' shares add up to ${Number(total.toFixed(4))}%, not 100%`);
  }
  // A seller is not automatically the legal owner: flag sellers who match no current owner.
  const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  for (const s of parties.filter((p) => p.LandRole === "Seller")) {
    const match = owners.some((o) => (s.Pan && o.Pan === s.Pan) || (s.Aadhaar && o.Aadhaar === s.Aadhaar) || norm(o.FullName) === norm(s.FullName));
    if (!match) warnings.push(`Seller ${s.FullName} does not match any current owner of this land`);
  }

  if (!records.length) need.RECORD_MAPPING.push("Enter at least one RS or LR record");
  const open = records.filter((x) => x.VerificationStatus !== "Verified");
  if (open.length) need.RECORD_MAPPING.push(`${open.length} RS / LR record(s) are not verified yet`);

  // Step 5: the ownership chain — every record, transfer, inheritance and partition verified, current shares
  // adding to 100%, and each ownership record's seven checks reviewed (Verified or Not Applicable).
  const o = (await conn.request().input("Id", sql.Int, land.LandId).query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.LegalOwnershipRecord WHERE LandId = @Id AND IsActive = 1) AS records,
      (SELECT COUNT(*) FROM dbo.LegalOwnershipRecord WHERE LandId = @Id AND IsActive = 1 AND ValidTo IS NULL) AS currentOwners,
      (SELECT SUM(SharePct) FROM dbo.LegalOwnershipRecord WHERE LandId = @Id AND IsActive = 1 AND ValidTo IS NULL) AS currentShare,
      (SELECT COUNT(*) FROM dbo.LegalOwnershipRecord WHERE LandId = @Id AND IsActive = 1 AND VerificationStatus <> 'Verified') AS recordsOpen,
      (SELECT COUNT(*) FROM dbo.LegalOwnershipEvent WHERE LandId = @Id AND IsActive = 1 AND VerificationStatus <> 'Verified') AS eventsOpen,
      (SELECT COUNT(*) FROM dbo.LegalInheritance WHERE LandId = @Id AND IsActive = 1 AND VerificationStatus <> 'Verified') AS inheritOpen,
      (SELECT COUNT(*) FROM dbo.LegalPartition WHERE LandId = @Id AND IsActive = 1 AND VerificationStatus <> 'Verified') AS partitionOpen,
      (SELECT COUNT(*) FROM dbo.LegalOwnershipRecord r WHERE r.LandId = @Id AND r.IsActive = 1 AND
         (SELECT COUNT(*) FROM dbo.LegalOwnershipCheck c WHERE c.RecordId = r.RecordId AND c.IsActive = 1 AND c.Result IN ('Verified', 'Not Applicable')) < ${CHECKS_PER_RECORD}) AS checksOpen,
      (SELECT COUNT(*) FROM dbo.LegalOwnershipCheck WHERE LandId = @Id AND IsActive = 1 AND Result IN ('Rejected', 'Needs Correction', 'Reattachment Required')) AS checksFailed`)).recordset[0];
  if (!o.currentOwners) need.OWNERSHIP.push("Add the current owner(s) as ownership records (no end date)");
  else if (Math.abs(Number(o.currentShare) - 100) > 0.0001) need.OWNERSHIP.push(`Current owners' shares add up to ${Number(Number(o.currentShare).toFixed(4))}%, not 100%`);
  if (o.recordsOpen) need.OWNERSHIP.push(`${o.recordsOpen} ownership record(s) not verified`);
  if (o.eventsOpen) need.OWNERSHIP.push(`${o.eventsOpen} ownership transfer(s) not verified`);
  if (o.inheritOpen) need.OWNERSHIP.push(`${o.inheritOpen} inheritance record(s) not verified`);
  if (o.partitionOpen) need.OWNERSHIP.push(`${o.partitionOpen} partition record(s) not verified`);
  if (o.checksFailed) need.OWNERSHIP.push(`${o.checksFailed} verification check(s) rejected or needing correction`);
  else if (o.checksOpen) need.OWNERSHIP.push(`${o.checksOpen} ownership record(s) without all ${CHECKS_PER_RECORD} checks reviewed`);

  // Step 6: required documents from the land's checklist.
  const docs = await documentGate(conn, land.LandId);
  need.DOCUMENTS.push(...docs.missing);

  // Steps 7, 9, 10: legal verification.
  const lv = (await conn.request().input("Id", sql.Int, land.LandId).query(`
    SELECT CheckType, Result, VerificationStatus FROM dbo.LegalVerificationCheck WHERE LandId = @Id AND IsActive = 1;
    SELECT c.CaseNumber, c.VerificationStatus, s.Name AS CaseStatus FROM dbo.LegalCase c
      LEFT JOIN dbo.LegalLookupValue s ON s.LookupId = c.LegalStatusId WHERE c.LandId = @Id AND c.IsActive = 1;
    SELECT LenderName, MortgageStatus, VerificationStatus FROM dbo.LegalMortgage WHERE LandId = @Id AND IsActive = 1;
    SELECT CheckItem, Result FROM dbo.LegalDueDiligence WHERE LandId = @Id AND IsActive = 1;
    SELECT OpinionNo, FinalOpinion, OpinionStatus FROM dbo.LegalOpinion WHERE LandId = @Id AND IsActive = 1;
    SELECT TOP 1 ClearanceNo, Decision, ConditionsMet FROM dbo.LegalClearance WHERE LandId = @Id AND IsActive = 1 ORDER BY ClearanceId DESC;`)).recordsets;
  const [vchecks, cases, mortgages, dd, opinions, clearance] = lv;

  // Step 7: the encumbrance and court case searches must actually have been done and reviewed;
  // a "Not Found" counts, "Not Checked" and "Search Failed" do not.
  for (const type of ["Encumbrance Search", "Court Case Verification"]) {
    const done = vchecks.filter((c) => c.CheckType === type && !["Not Checked", "Search Failed"].includes(c.Result));
    if (!done.length) need.CASE_MORTGAGE.push(`${type} not done yet (a failed or unchecked search does not count)`);
    else if (!done.some((c) => c.VerificationStatus === "Verified")) need.CASE_MORTGAGE.push(`${type} not verified`);
  }
  const vOpen = vchecks.filter((c) => c.VerificationStatus !== "Verified").length;
  if (vOpen) need.CASE_MORTGAGE.push(`${vOpen} verification check(s) not verified`);
  const cOpen = cases.filter((c) => c.VerificationStatus !== "Verified").length;
  if (cOpen) need.CASE_MORTGAGE.push(`${cOpen} court case record(s) not verified`);
  const mOpen = mortgages.filter((m) => m.VerificationStatus !== "Verified").length;
  if (mOpen) need.CASE_MORTGAGE.push(`${mOpen} mortgage record(s) not verified`);
  // Risks are recorded here and weighed at legal clearance, so they warn rather than block.
  for (const c of cases.filter((x) => ["Open", "Pending", "Appealed"].includes(x.CaseStatus))) warnings.push(`Court case ${c.CaseNumber} is ${String(c.CaseStatus).toLowerCase()}`);
  for (const m of mortgages.filter((x) => ["Mortgage Active", "Loan Outstanding", "Release Pending", "Needs Investigation"].includes(x.MortgageStatus))) warnings.push(`Mortgage with ${m.LenderName}: ${m.MortgageStatus}`);
  for (const c of vchecks.filter((x) => x.Result === "Found - Issue")) warnings.push(`${c.CheckType} found an issue`);

  // Step 9: every due diligence check reviewed, and an approved legal opinion.
  const ddMissing = DUE_DILIGENCE_CHECKS.filter((k) => !dd.some((d) => d.CheckItem === k));
  if (ddMissing.length) need.DUE_DILIGENCE.push(`${ddMissing.length} due diligence check(s) not on the list yet`);
  const ddPending = dd.filter((d) => d.Result === "Pending").length;
  if (ddPending) need.DUE_DILIGENCE.push(`${ddPending} due diligence check(s) still pending`);
  if (!opinions.some((o) => o.OpinionStatus === "Approved")) need.DUE_DILIGENCE.push("No approved legal opinion yet");
  for (const d of dd.filter((x) => x.Result === "Issue Found")) warnings.push(`Due diligence: issue found in ${d.CheckItem}`);

  // Step 10: the latest clearance decision.
  const cl = clearance[0];
  if (!cl) need.CLEARANCE.push("No legal clearance decision recorded");
  else if (cl.Decision === "Cleared with Conditions" && !cl.ConditionsMet) need.CLEARANCE.push(`${cl.ClearanceNo}: cleared with conditions — mark the conditions met (or approved) first`);
  else if (!["Cleared", "Cleared with Conditions"].includes(cl.Decision)) need.CLEARANCE.push(`${cl.ClearanceNo}: ${cl.Decision}`);

  // Phase 4 (steps 8, 11–14) and Phase 5 (steps 15–22).
  const [txns, vals, agreements, approvals, pays, deeds, drafts, dchecks, duties, regPays, appts, attempts, regDeeds] = (await conn.request().input("Id", sql.Int, land.LandId).query(`
    SELECT TransactionId, TransactionNo, TotalValue, AdvanceAmount, TxnStatus FROM dbo.LegalLandTransaction WHERE LandId = @Id AND IsActive = 1 AND TxnStatus <> N'Cancelled' AND TxnType = N'Purchase';
    SELECT VerificationStatus FROM dbo.LegalValuation WHERE LandId = @Id AND IsActive = 1;
    SELECT AgreementId, AgreementNo, AgreementStatus, AdvanceAmount FROM dbo.LegalAgreement WHERE LandId = @Id AND IsActive = 1;
    SELECT AgreementId, PartyRole, ConsentStatus, PartyName FROM dbo.LegalPartyApproval WHERE LandId = @Id AND IsActive = 1;
    SELECT TransactionId, Amount, VerificationStatus FROM dbo.LegalPayment WHERE LandId = @Id AND IsActive = 1;
    SELECT DeedId, DeedCode, RegistrationStatus FROM dbo.LegalLandDeed WHERE LandId = @Id AND IsActive = 1;
    SELECT DraftId, DeedId, VersionNo, ReviewStatus FROM dbo.LegalDeedDraft WHERE LandId = @Id AND IsActive = 1;
    SELECT DraftId, Result FROM dbo.LegalDeedDraftCheck WHERE LandId = @Id AND IsActive = 1;
    SELECT DeedId, TotalPayable, VerificationStatus FROM dbo.LegalStampDuty WHERE LandId = @Id AND IsActive = 1;
    SELECT DeedId, Amount, VerificationStatus FROM dbo.LegalRegPayment WHERE LandId = @Id AND IsActive = 1;
    SELECT AppointmentStatus FROM dbo.LegalRegAppointment WHERE LandId = @Id AND IsActive = 1;
    SELECT AttemptId, Result FROM dbo.LegalRegAttempt WHERE LandId = @Id AND IsActive = 1 ORDER BY AttemptDate, AttemptId;
    SELECT ApprovalStatus FROM dbo.LegalRegisteredDeed WHERE LandId = @Id AND IsActive = 1;`)).recordsets;

  if (!txns.length) need.PURCHASE_SALE.push("Record the purchase or sale transaction");
  if (!vals.some((v) => v.VerificationStatus === "Verified")) need.VALUATION.push("No verified valuation / survey yet");
  const signed = agreements.filter((a) => a.AgreementStatus === "Signed");
  if (!signed.length) need.AGREEMENT.push(agreements.length ? "The agreement is not signed by both sides yet" : "Record the agreement");
  if (signed.length) {
    const ap = approvals.filter((a) => signed.some((g) => g.AgreementId === a.AgreementId));
    if (!ap.some((a) => a.PartyRole === "Buyer") || !ap.some((a) => ["Seller", "Co-owner"].includes(a.PartyRole))) need.PARTY_APPROVAL.push("List every buyer and seller on the signed agreement");
    const open = ap.filter((a) => !["Approved", "Not Applicable"].includes(a.ConsentStatus));
    if (open.length) need.PARTY_APPROVAL.push(`${open.length} party approval(s) still pending or rejected`);
    // Buying the whole land needs every current owner's consent, however many share the same Dag.
    const owners = (await conn.request().input("Id", sql.Int, land.LandId).query(
      "SELECT OwnerName FROM dbo.LegalOwnershipRecord WHERE LandId = @Id AND IsActive = 1 AND ValidTo IS NULL")).recordset;
    const norm = (x) => String(x || "").toLowerCase().replace(/\s+/g, " ").trim();
    const missingOwners = owners.filter((o) => !ap.some((a) => norm(a.PartyName) === norm(o.OwnerName)));
    if (missingOwners.length) need.PARTY_APPROVAL.push(`Not listed on the agreement: ${missingOwners.map((o) => o.OwnerName).join(", ")} (current owner${missingOwners.length > 1 ? "s" : ""})`);
  } else need.PARTY_APPROVAL.push("Waiting for a signed agreement");
  const verifiedPaid = pays.filter((x) => x.VerificationStatus === "Verified").reduce((a, x) => a + Number(x.Amount), 0);
  const advance = Number(signed[0]?.AdvanceAmount ?? txns[0]?.AdvanceAmount ?? 0);
  if (!pays.length) need.PAYMENT.push("No payment recorded");
  else if (verifiedPaid + 0.005 < advance) need.PAYMENT.push(`Verified payments ₹${verifiedPaid.toLocaleString("en-IN")} are below the advance of ₹${advance.toLocaleString("en-IN")}`);
  const pPend = pays.filter((x) => x.VerificationStatus !== "Verified").length;
  if (pPend) need.PAYMENT.push(`${pPend} payment(s) not verified`);

  const deed = deeds[0];
  if (!deed) for (const k of ["DEED_PREP", "DRAFT_VERIFY", "STAMP_DUTY", "APPOINTMENT", "SRO_REGISTRATION", "REGISTRATION_RESULT", "REGISTERED_DEED", "DEED_APPROVAL"]) need[k].push("Prepare the deed first");
  else {
    const myDrafts = drafts.filter((d) => d.DeedId === deed.DeedId).sort((a, b) => b.VersionNo - a.VersionNo);
    if (!myDrafts.length) need.DEED_PREP.push("Upload the deed draft");
    const latest = myDrafts[0];
    if (!latest) need.DRAFT_VERIFY.push("No draft to verify");
    else {
      const ck = dchecks.filter((c) => c.DraftId === latest.DraftId);
      const bad = ck.filter((c) => !["Correct", "Not Applicable"].includes(c.Result)).length;
      if (bad) need.DRAFT_VERIFY.push(`Draft v${latest.VersionNo}: ${bad} check(s) not correct yet`);
      if (latest.ReviewStatus !== "Approved") need.DRAFT_VERIFY.push(`Draft v${latest.VersionNo} is ${latest.ReviewStatus.toLowerCase()}`);
    }
    const duty = duties.filter((d) => d.DeedId === deed.DeedId && d.VerificationStatus === "Verified").pop();
    const paidFees = regPays.filter((p) => p.DeedId === deed.DeedId && p.VerificationStatus === "Verified").reduce((a, p) => a + Number(p.Amount), 0);
    if (!duty) need.STAMP_DUTY.push("No verified stamp duty / fee calculation");
    else if (paidFees + 0.005 < Number(duty.TotalPayable)) need.STAMP_DUTY.push(`Verified fee payments ₹${paidFees.toLocaleString("en-IN")} of ₹${Number(duty.TotalPayable).toLocaleString("en-IN")} payable`);
    if (!appts.some((a) => ["Scheduled", "Rescheduled", "Completed"].includes(a.AppointmentStatus))) need.APPOINTMENT.push("No registration appointment scheduled");
    // An appointment or a payment never makes a registration successful; only a recorded attempt does.
    if (!attempts.length) need.SRO_REGISTRATION.push("Record the registration attempt at the Sub-Registrar office");
    const last = attempts[attempts.length - 1];
    if (!last || last.Result !== "Successful") need.REGISTRATION_RESULT.push(last ? `Last attempt: ${last.Result} — correct and re-submit` : "No registration result yet");
    if (!regDeeds.length) need.REGISTERED_DEED.push("Upload the registered deed");
    if (!regDeeds.some((d) => d.ApprovalStatus === "Approved")) need.DEED_APPROVAL.push("The registered deed is not approved yet");
  }

  // Phase 6 (steps 23–31).
  const [xfer, muts, mrecs, fchecks, settles, snaps] = (await conn.request().input("Id", sql.Int, land.LandId).query(`
    SELECT e.EventId, e.VerificationStatus,
           (SELECT COUNT(*) FROM dbo.LegalOwnershipRecord r WHERE r.EventId = e.EventId AND r.IsActive = 1 AND r.VerificationStatus <> N'Verified') AS RecordsOpen,
           (SELECT COUNT(*) FROM dbo.LegalRegisteredDeed d WHERE d.RegisteredId = e.RegisteredDeedId AND d.ApprovalStatus = N'Approved') AS DeedApproved
      FROM dbo.LegalOwnershipEvent e WHERE e.LandId = @Id AND e.IsActive = 1 AND e.RegisteredDeedId IS NOT NULL;
    SELECT MutationId, ApplicationNo, ApplicationStatus FROM dbo.LegalMutation WHERE LandId = @Id AND IsActive = 1 ORDER BY MutationId;
    SELECT VerificationStatus FROM dbo.LegalMutationRecord WHERE LandId = @Id AND IsActive = 1;
    SELECT CheckItem, Result FROM dbo.LegalFinalCheck WHERE LandId = @Id AND IsActive = 1;
    SELECT SettlementStatus, ApprovedAt FROM dbo.LegalSettlement WHERE LandId = @Id AND IsActive = 1;
    SELECT MAX(CreatedAt) AS LastSnapshot FROM dbo.LegalLandRegisterSnapshot WHERE LandId = @Id;`)).recordsets;

  if (!xfer.length) need.OWNERSHIP_TRANSFER.push("Record the ownership transfer from the approved registered deed");
  else {
    if (!xfer.some((e) => e.DeedApproved)) need.OWNERSHIP_TRANSFER.push("The transfer's registered deed is not approved");
    if (xfer.some((e) => e.VerificationStatus !== "Verified")) need.OWNERSHIP_TRANSFER.push("The ownership transfer is not verified");
    const open = xfer.reduce((a, e) => a + e.RecordsOpen, 0);
    if (open) need.OWNERSHIP_TRANSFER.push(`${open} ownership record(s) from the transfer not verified`);
  }
  const mut = muts[muts.length - 1];
  if (!mut || ["Not Applied", "Draft"].includes(mut.ApplicationStatus) || !mut.ApplicationNo) need.MUTATION_APPLY.push("Submit the mutation application and record its number");
  // A registered deed does not mean the mutation is complete.
  if (!mut || mut.ApplicationStatus !== "Approved") need.MUTATION_RESULT.push(mut ? `Mutation is ${mut.ApplicationStatus.toLowerCase()} — follow up hearings / objections` : "No mutation yet");
  if (!mrecs.some((r) => r.VerificationStatus === "Verified")) need.NEW_KHATIAN.push("Record and verify the new Khatian / RoR");
  const fMissing = FINAL_CHECKS.filter((k) => !fchecks.some((c) => c.CheckItem === k)).length;
  if (fMissing) need.FINAL_VERIFY.push(`${fMissing} final check(s) not on the list yet`);
  const fOpen = fchecks.filter((c) => !["Confirmed", "Not Applicable"].includes(c.Result)).length;
  if (fOpen) need.FINAL_VERIFY.push(`${fOpen} final check(s) not confirmed`);
  const approvedSettle = settles.filter((x) => x.SettlementStatus === "Approved");
  if (!approvedSettle.length) need.SETTLEMENT.push("Financial settlement not approved");
  const lastSettle = approvedSettle.map((x) => new Date(x.ApprovedAt)).sort((a, b) => b - a)[0];
  const lastSnap = snaps[0]?.LastSnapshot ? new Date(snaps[0].LastSnapshot) : null;
  if (!lastSnap) need.REGISTER_UPDATE.push("Update the land register");
  else if (lastSettle && lastSnap < lastSettle) need.REGISTER_UPDATE.push("The land register was updated before the settlement — update it again");
  if (land.IsOnHold) need.CLOSED.push("The land is on hold");

  const milestones = {
    deedRegistered: regDeeds.some((d) => d.ApprovalStatus === "Approved"),
    mutationCompleted: mut?.ApplicationStatus === "Approved" && mrecs.some((r) => r.VerificationStatus === "Verified"),
    settlementApproved: approvedSettle.length > 0,
  };

  const counts = {
    transactions: txns.length,
    paidVerified: verifiedPaid,
    ownershipRecords: o.records,
    docsRequired: docs.counts.required,
    docsDone: docs.counts.done,
    parties: parties.length,
    owners: owners.length,
    rs: records.filter((x) => x.Kind === "RS").length,
    lr: records.filter((x) => x.Kind === "LR").length,
    recordsVerified: records.length - open.length,
  };
  return { need, warnings, counts, milestones };
}

async function loadSteps(conn, landId) {
  const r = await conn.request().input("Id", sql.Int, landId).query(`
    SELECT s.StepNo, s.StepCode, s.StepName, s.Phase, s.IsSkippable,
           ISNULL(st.Status, 'Not Started') AS Status, st.Remarks, st.SkipReason, st.UpdatedAt,
           (SELECT name FROM dbo.users WHERE id = st.UpdatedBy) AS UpdatedByName,
           (SELECT name FROM dbo.users WHERE id = st.ResponsibleUserId) AS ResponsibleName
    FROM dbo.LegalWorkflowStep s
    LEFT JOIN dbo.LegalWorkflowStepState st ON st.StepCode = s.StepCode AND st.LandId = @Id
    WHERE s.IsActive = 1 ORDER BY s.StepNo`);
  return r.recordset;
}

/** Keeps LegalLand.WorkflowStatus on the first unfinished step's name. */
async function syncWorkflowStatus(conn, landId) {
  await conn.request().input("Id", sql.Int, landId).query(`
    UPDATE dbo.LegalLand SET WorkflowStatus = ISNULL((
      SELECT TOP 1 s.StepName FROM dbo.LegalWorkflowStep s
      LEFT JOIN dbo.LegalWorkflowStepState st ON st.StepCode = s.StepCode AND st.LandId = @Id
      WHERE s.IsActive = 1 AND ISNULL(st.Status, 'Not Started') NOT IN ('Completed', 'Skipped')
      ORDER BY s.StepNo), 'Completed')
    WHERE LandId = @Id`);
}

/** Moves one step and records the change in its history (`from` is null for a step never started). */
async function moveStep(conn, req, landId, code, from, to, { remarks = null, skipReason = null } = {}) {
  await conn.request()
    .input("LandId", sql.Int, landId).input("Code", sql.NVarChar(40), code)
    .input("Prev", sql.NVarChar(30), from).input("Status", sql.NVarChar(30), to)
    .input("Remarks", sql.NVarChar(1000), remarks).input("SkipReason", sql.NVarChar(500), skipReason)
    .input("UserId", sql.Int, req.user?.userId || null)
    .query(`
      MERGE dbo.LegalWorkflowStepState AS t
      USING (SELECT @LandId AS LandId, @Code AS StepCode) AS s ON t.LandId = s.LandId AND t.StepCode = s.StepCode
      WHEN MATCHED THEN UPDATE SET Status = @Status, Remarks = @Remarks, SkipReason = @SkipReason, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (LandId, StepCode, Status, Remarks, SkipReason, ResponsibleUserId, UpdatedBy, UpdatedAt)
        VALUES (@LandId, @Code, @Status, @Remarks, @SkipReason, @UserId, @UserId, SYSUTCDATETIME());
      INSERT INTO dbo.LegalWorkflowStepHistory (LandId, StepCode, PreviousStatus, NewStatus, Remarks, ChangedBy)
        VALUES (@LandId, @Code, @Prev, @Status, ISNULL(@SkipReason, @Remarks), @UserId);`);
}

// ── Routes ────────────────────────────────────────────────────────────────────────────────────────
router.get("/stats", requirePageRight(LAND_PAGE, "view"), async (_req, res) => {
  try {
    const r = await getPool().request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.LegalLand WHERE IsActive = 1) AS totalLands,
        (SELECT COUNT(*) FROM dbo.LegalLand WHERE IsActive = 1 AND ISNULL(VerificationStatus, 'Draft') = 'Draft') AS pendingVerificationLands,
        (SELECT COUNT(*) FROM dbo.LegalLand WHERE IsActive = 1 AND L1Status = 'Pending') AS l1PendingLands,
        (SELECT COUNT(*) FROM dbo.LegalLand WHERE IsActive = 1 AND L2Status = 'Pending') AS l2PendingLands,
        (SELECT COUNT(*) FROM dbo.LegalLandEnquiry WHERE IsActive = 1 AND EnquiryStatus IN ('New', 'Under Review', 'Interested', 'On Hold')) AS activeEnquiries,
        (SELECT COUNT(*) FROM dbo.LegalLand WHERE IsActive = 1 AND EntryType = N'New Acquisition' AND IsOnHold = 0 AND ISNULL(WorkflowStatus, '') <> 'Completed') AS inProgress,
        (SELECT COUNT(*) FROM dbo.LegalLand WHERE IsActive = 1 AND IsOnHold = 1) AS onHold,
        (SELECT COUNT(DISTINCT LandId) FROM dbo.LegalWorkflowStepState WHERE Status = 'Pending Verification') AS pendingVerification,
        (SELECT COUNT(*) FROM dbo.LegalLand WHERE IsActive = 1 AND EntryType = N'New Acquisition' AND WorkflowStatus = 'Completed') AS completed,
        (SELECT COUNT(*) FROM dbo.LegalLand WHERE IsActive = 1 AND EntryType = N'Existing / Backlog') AS backlogLands;
      SELECT TOP 8 l.LandId, l.LandCode, l.LandName, l.WorkflowStatus, l.IsOnHold, m.MouzaName, m.JLNo, l.CreatedAt
      FROM dbo.LegalLand l LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId
      WHERE l.IsActive = 1 ORDER BY ISNULL(l.UpdatedAt, l.CreatedAt) DESC;
      -- Waiting for a reviewer: every record whose verification / approval is still open.
      SELECT x.Kind, COUNT(*) AS N FROM (
        SELECT N'Ownership records' AS Kind FROM dbo.LegalOwnershipRecord WHERE IsActive = 1 AND VerificationStatus = N'Pending'
        UNION ALL SELECT N'Ownership transfers' FROM dbo.LegalOwnershipEvent WHERE IsActive = 1 AND VerificationStatus = N'Pending'
        UNION ALL SELECT N'Documents' FROM dbo.LegalLandDocument d JOIN dbo.LegalLandDocumentVersion v ON v.DocumentId = d.DocumentId AND v.VersionNo = d.CurrentVersionNo WHERE d.IsActive = 1 AND v.ReviewStatus = N'Pending'
        UNION ALL SELECT N'Legal opinions' FROM dbo.LegalOpinion WHERE IsActive = 1 AND OpinionStatus = N'Under Review'
        UNION ALL SELECT N'Payments' FROM dbo.LegalPayment WHERE IsActive = 1 AND VerificationStatus = N'Pending'
        UNION ALL SELECT N'Deed drafts' FROM dbo.LegalDeedDraft WHERE IsActive = 1 AND ReviewStatus = N'Pending'
        UNION ALL SELECT N'Registered deeds' FROM dbo.LegalRegisteredDeed WHERE IsActive = 1 AND ApprovalStatus = N'Pending'
        UNION ALL SELECT N'Settlements' FROM dbo.LegalSettlement WHERE IsActive = 1 AND SettlementStatus = N'Submitted'
      ) x GROUP BY x.Kind ORDER BY N DESC;
      SELECT TOP 6 a.AppointmentDate, a.AppointmentTime, a.TokenNo, o.OfficeName, l.LandId, l.LandCode, l.LandName
      FROM dbo.LegalRegAppointment a JOIN dbo.LegalLand l ON l.LandId = a.LandId LEFT JOIN dbo.LegalRegistrationOffice o ON o.OfficeId = a.RegistrationOfficeId
      WHERE a.IsActive = 1 AND a.AppointmentStatus IN (N'Scheduled', N'Rescheduled') AND a.AppointmentDate >= CAST(SYSDATETIME() AS DATE) ORDER BY a.AppointmentDate;
      SELECT TOP 6 p.PaymentDate, p.Amount, p.TransactionRef, l.LandId, l.LandCode, l.LandName
      FROM dbo.LegalPayment p JOIN dbo.LegalLand l ON l.LandId = p.LandId WHERE p.IsActive = 1 AND p.VerificationStatus <> N'Verified' ORDER BY p.PaymentDate;
      SELECT TOP 6 c.CaseNumber, c.CourtName, c.NextHearingDate, s.Name AS Status, l.LandId, l.LandCode
      FROM dbo.LegalCase c JOIN dbo.LegalLand l ON l.LandId = c.LandId LEFT JOIN dbo.LegalLookupValue s ON s.LookupId = c.LegalStatusId
      WHERE c.IsActive = 1 AND s.Name IN (N'Open', N'Pending', N'Appealed') ORDER BY c.NextHearingDate;
      SELECT TOP 6 e.EventDate, ISNULL(e.PreviousOwnerName, N'—') AS FromName, e.NewOwnerName AS ToName, t.Name AS TransferType, l.LandId, l.LandCode
      FROM dbo.LegalOwnershipEvent e JOIN dbo.LegalLand l ON l.LandId = e.LandId LEFT JOIN dbo.LegalLookupValue t ON t.LookupId = e.TransferTypeId
      WHERE e.IsActive = 1 ORDER BY e.EventDate DESC, e.EventId DESC;
      SELECT
        (SELECT COUNT(DISTINCT d.LandId) FROM dbo.LegalLandDeed d WHERE d.IsActive = 1 AND d.RegistrationStatus NOT IN (N'Successfully Registered', N'Registered Deed Awaiting', N'Completed')) AS pendingRegistration,
        (SELECT COUNT(*) FROM dbo.LegalRegisteredDeed rd WHERE rd.IsActive = 1 AND NOT EXISTS (SELECT 1 FROM dbo.LegalMutation m WHERE m.RegisteredDeedId = rd.RegisteredId AND m.ApplicationStatus = N'Approved')) AS mutationPending;
      SELECT l.LandId, l.LandCode, l.LandName, l.EntryType, l.LandStatus, l.PossessionStatus, l.WorkflowStatus, l.IsOnHold,
             CAST(l.Area AS FLOAT) AS Area, u.UnitName, d.DistrictName, m.MouzaName, m.JLNo,
             ISNULL(l.VerificationStatus, N'Draft') AS VerificationStatus,
             ISNULL(l.L1Status, N'Pending') AS L1Status,
             ISNULL(l.L2Status, N'Pending') AS L2Status,
             l.CreatedAt, ISNULL(l.UpdatedAt, l.CreatedAt) AS LastUpdated
      FROM dbo.LegalLand l
      LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = l.DistrictId
      LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId
      LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = l.AreaUnitId
      WHERE l.IsActive = 1
      ORDER BY l.LandId DESC;`);
    const [counts, recent, approvals, appointments, payments, cases, transfers, more, allLands] = r.recordsets;
    res.json({ ...counts[0], ...more[0], recent, approvals, appointments, payments, cases, transfers, allLands });
  } catch (err) {
    console.error("[legal-land] stats:", err.message);
    res.status(500).json({ error: "Could not load land statistics" });
  }
});

// GET /api/legal/land/pending-queue: All land records waiting for Verification or L1/L2 Approval
router.get("/pending-queue", requirePageRight(LAND_PAGE, "view"), async (_req, res) => {
  try {
    const r = await getPool().request().query(`
      SELECT l.LandId, l.LandCode, l.LandName, l.EntryType, l.LandStatus,
             ISNULL(l.VerificationStatus, N'Draft') AS VerificationStatus,
             ISNULL(l.L1Status, N'Pending') AS L1Status,
             ISNULL(l.L2Status, N'Pending') AS L2Status,
             l.WorkflowStatus,
             CAST(l.Area AS FLOAT) AS Area, u.UnitName, d.DistrictName, m.MouzaName, m.JLNo,
             CASE
               WHEN ISNULL(l.VerificationStatus, 'Draft') <> 'Verified' THEN 'Verification Pending'
               WHEN ISNULL(l.L1Status, 'Pending') = 'Pending' THEN 'L1 Legal Review'
               WHEN ISNULL(l.L2Status, 'Pending') = 'Pending' THEN 'L2 Executive Approval'
               ELSE 'Approved'
             END AS Stage,
             DATEDIFF(day, ISNULL(l.UpdatedAt, l.CreatedAt), SYSUTCDATETIME()) AS WaitingDays,
             l.CreatedAt, ISNULL(l.UpdatedAt, l.CreatedAt) AS LastUpdated,
             (SELECT name FROM dbo.users WHERE id = l.CreatedBy) AS CreatedByName
      FROM dbo.LegalLand l
      LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = l.DistrictId
      LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId
      LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = l.AreaUnitId
      WHERE l.IsActive = 1
        AND (ISNULL(l.VerificationStatus, 'Draft') <> 'Verified' OR ISNULL(l.L1Status, 'Pending') = 'Pending' OR ISNULL(l.L2Status, 'Pending') = 'Pending')
      ORDER BY l.UpdatedAt DESC, l.LandId DESC;
    `);
    res.json(r.recordset);
  } catch (err) {
    console.error("[legal-land] pending-queue error:", err.message);
    res.status(500).json({ error: "Could not load land approval queue" });
  }
});

// The land's profile overview: identity, current owners and the counts of what is recorded against it.
router.get("/:id/overview", requirePageRight(LAND_PAGE, "view"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid land" });
  try {
    const r = await getPool().request().input("Id", sql.Int, id).query(`
      SELECT l.LandId, l.LandCode, l.LandName, l.EntryType, l.LandStatus, l.PossessionStatus, l.WorkflowStatus, l.IsOnHold, l.IsActive,
             l.Area, u.UnitName, l.LocationAddress, l.AcquisitionDate, l.AcquisitionDateApprox, l.AcquisitionType,
             l.RsDagNo, l.LrDagNo, l.RsKhatianNo, l.LrKhatianNo,
             l.NorthBoundary, l.SouthBoundary, l.EastBoundary, l.WestBoundary, l.GpsLatitude, l.GpsLongitude, l.Remarks,
             ISNULL(l.VerificationStatus, N'Draft') AS VerificationStatus,
             ISNULL(l.L1Status, N'Pending') AS L1Status, l.L1ReviewedAt, l.L1Remarks,
             (SELECT name FROM dbo.users WHERE id = l.L1ReviewerId) AS L1ReviewerName,
             ISNULL(l.L2Status, N'Pending') AS L2Status, l.L2ApprovedAt, l.L2Remarks,
             (SELECT name FROM dbo.users WHERE id = l.L2ApproverId) AS L2ApproverName,
             sd.SubDivisionName, b.BlockName, lt.LandTypeName,
             d.DistrictName, m.MouzaName, m.JLNo, l.CreatedAt, ISNULL(l.UpdatedAt, l.CreatedAt) AS LastUpdated,
             (SELECT name FROM dbo.users WHERE id = l.CreatedBy) AS CreatedByName
      FROM dbo.LegalLand l
      LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = l.AreaUnitId
      LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = l.DistrictId
      LEFT JOIN dbo.LegalSubDivision sd ON sd.SubDivisionId = l.SubDivisionId
      LEFT JOIN dbo.LegalBlock b ON b.BlockId = l.BlockId
      LEFT JOIN dbo.LegalLandType lt ON lt.LandTypeId = l.LandTypeId
      LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId
      WHERE l.LandId = @Id;
      SELECT ISNULL(o.OwnerName, p.FullName) AS OwnerName, o.SharePct, o.ValidFrom, o.VerificationStatus
      FROM dbo.LegalOwnershipRecord o LEFT JOIN dbo.LegalPerson p ON p.PersonId = o.PersonId
      WHERE o.LandId = @Id AND o.IsActive = 1 AND o.ValidTo IS NULL ORDER BY o.SharePct DESC;
      SELECT
        (SELECT COUNT(*) FROM dbo.LegalOwnershipRecord WHERE LandId = @Id AND IsActive = 1) AS ownershipRecords,
        (SELECT COUNT(*) FROM dbo.LegalOwnershipEvent WHERE LandId = @Id AND IsActive = 1) AS transfers,
        (SELECT COUNT(*) FROM dbo.LegalLandDocument WHERE LandId = @Id AND IsActive = 1) AS documents,
        (SELECT COUNT(*) FROM dbo.LegalLandDocument dd JOIN dbo.LegalLandDocumentVersion v ON v.DocumentId = dd.DocumentId AND v.VersionNo = dd.CurrentVersionNo
           WHERE dd.LandId = @Id AND dd.IsActive = 1 AND v.ReviewStatus <> N'Verified') AS documentsUnverified,
        (SELECT COUNT(*) FROM dbo.LegalCase c LEFT JOIN dbo.LegalLookupValue s ON s.LookupId = c.LegalStatusId
           WHERE c.LandId = @Id AND c.IsActive = 1 AND ISNULL(s.Name, N'') NOT IN (N'Closed', N'Disposed', N'Resolved', N'Dismissed')) AS activeCases,
        (SELECT COUNT(*) FROM dbo.LegalLandLegalRecord WHERE LandId = @Id AND IsActive = 1) AS legalRecords,
        -- The Legal history tab holds both court cases and the other legal records.
        (SELECT COUNT(*) FROM dbo.LegalLandLegalRecord WHERE LandId = @Id AND IsActive = 1)
          + (SELECT COUNT(*) FROM dbo.LegalCase WHERE LandId = @Id AND IsActive = 1) AS legalHistory,
        (SELECT COUNT(*) FROM dbo.LegalMortgage WHERE LandId = @Id AND IsActive = 1
           AND (LoanStatus IN (N'Active', N'Overdue') OR MortgageStatus IN (N'Mortgage Active', N'Loan Outstanding', N'Release Pending'))) AS activeMortgages,
        (SELECT COUNT(*) FROM dbo.LegalMortgage WHERE LandId = @Id AND IsActive = 1) AS mortgages,
        (SELECT COUNT(*) FROM dbo.LegalMutation WHERE LandId = @Id AND IsActive = 1) AS mutations,
        (SELECT COUNT(*) FROM dbo.LegalPayment WHERE LandId = @Id AND IsActive = 1) AS payments,
        (SELECT COUNT(*) FROM dbo.LegalLandTax WHERE LandId = @Id AND IsActive = 1) AS taxRecords,
        (SELECT COUNT(*) FROM dbo.LegalValuation WHERE LandId = @Id AND IsActive = 1) AS valuations,
        (SELECT COUNT(*) FROM dbo.LegalLandRsRecord WHERE LandId = @Id AND IsActive = 1) + (SELECT COUNT(*) FROM dbo.LegalLandLrRecord WHERE LandId = @Id AND IsActive = 1) AS landRecords,
        -- Everything recorded but still waiting for a verifier (data entered is not data verified).
        (SELECT COUNT(*) FROM dbo.LegalOwnershipRecord WHERE LandId = @Id AND IsActive = 1 AND VerificationStatus <> N'Verified')
          + (SELECT COUNT(*) FROM dbo.LegalOwnershipEvent WHERE LandId = @Id AND IsActive = 1 AND VerificationStatus <> N'Verified')
          + (SELECT COUNT(*) FROM dbo.LegalLandLegalRecord WHERE LandId = @Id AND IsActive = 1 AND VerificationStatus <> N'Verified')
          + (SELECT COUNT(*) FROM dbo.LegalMortgage WHERE LandId = @Id AND IsActive = 1 AND VerificationStatus <> N'Verified') AS awaitingVerification;`);
    const [land] = r.recordsets[0];
    if (!land) return res.status(404).json({ error: "Land not found" });
    res.json({ land, owners: r.recordsets[1], counts: r.recordsets[2][0] });
  } catch (err) {
    console.error("[legal-land] overview:", err.message);
    res.status(500).json({ error: "Could not load the land overview" });
  }
});

router.get("/:id", requirePageRight(LAND_PAGE, "view"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const land = await loadLand(pool, id);
    if (!land) return res.status(404).json({ error: "Land property not found" });
    const [steps, g, hold] = await Promise.all([
      loadSteps(pool, id),
      gates(pool, land),
      pool.request().input("Id", sql.Int, id).query(`
        SELECT TOP 1 h.HoldId, h.HoldCategory, h.HoldReason, h.HoldDate, h.ExpectedReviewDate, h.Remarks,
               (SELECT name FROM dbo.users WHERE id = h.HeldBy) AS HeldByName
        FROM dbo.LegalHold h WHERE h.LandId = @Id AND h.ResumedAt IS NULL ORDER BY h.HoldId DESC`),
    ]);
    let blockedFrom = null;
    const out = steps.map((s) => {
      const live = s.Phase <= LIVE_PHASE;
      if (!live) return { stepNo: s.StepNo, code: s.StepCode, name: s.StepName, phase: s.Phase, skippable: !!s.IsSkippable, status: s.Status, remarks: s.Remarks, skipReason: s.SkipReason, updatedAt: s.UpdatedAt, updatedBy: s.UpdatedByName, responsible: s.ResponsibleName, live, locked: false, missing: [] };
      const missing = live ? g.need[s.StepCode] || [] : [];
      const locked = blockedFrom !== null;
      if (!DONE.has(s.Status) && blockedFrom === null) blockedFrom = s.StepNo;
      return {
        stepNo: s.StepNo, code: s.StepCode, name: s.StepName, phase: s.Phase, skippable: !!s.IsSkippable,
        status: s.Status, remarks: s.Remarks, skipReason: s.SkipReason, updatedAt: s.UpdatedAt,
        updatedBy: s.UpdatedByName, responsible: s.ResponsibleName, live, locked, missing,
      };
    });
    const done = out.filter((s) => DONE.has(s.status)).length;
    res.json({
      land, hold: hold.recordset[0] || null, steps: out, counts: g.counts, warnings: g.warnings,
      milestones: { ...g.milestones, transactionClosed: out.find((s) => s.code === "CLOSED")?.status === "Completed" },
      progress: Math.round((done / Math.max(out.length, 1)) * 100), holdCategories: HOLD_CATEGORIES,
    });
  } catch (err) {
    console.error("[legal-land] pipeline:", err.message);
    res.status(500).json({ error: "Could not load the land pipeline" });
  }
});

router.post("/:id/steps/:code", requirePageRight(LAND_PAGE, "edit"), async (req, res) => {
  const id = idParam(req.params.id);
  const code = String(req.params.code || "").toUpperCase();
  const to = req.body?.status;
  const remarks = text(req.body?.remarks, 1000);
  const skipReason = text(req.body?.skipReason, 500);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  if (!STATUSES.includes(to)) return res.status(400).json({ error: `Status must be one of: ${STATUSES.join(", ")}` });
  if ((to === "Skipped" || to === "Correction Required") && !(await requireApprove(req, res))) return;
  if (to === "Skipped" && (!skipReason || skipReason.length < 5)) return res.status(400).json({ error: "Give the reason for skipping this step" });
  if (to === "Correction Required" && !remarks) return res.status(400).json({ error: "Say what needs correcting" });

  const tx = new sql.Transaction(getPool());
  try {
    await tx.begin();
    const land = await loadLand(tx, id);
    if (!land) { await tx.rollback(); return res.status(404).json({ error: "Land property not found" }); }
    if (land.IsOnHold) { await tx.rollback(); return res.status(409).json({ error: "This land is on hold. Resume it first." }); }
    if (!land.IsActive) { await tx.rollback(); return res.status(409).json({ error: "This land property is inactive" }); }
    if (land.IsCancelled) { await tx.rollback(); return res.status(409).json({ error: "This land's transaction is cancelled; its records are kept read-only" }); }
    // Lock this land's steps so two people cannot move them at once.
    await tx.request().input("Id", sql.Int, id).query("SELECT LandId FROM dbo.LegalLand WITH (UPDLOCK, ROWLOCK) WHERE LandId = @Id");
    const steps = await loadSteps(tx, id);
    const step = steps.find((s) => s.StepCode === code);
    const refuse = async (msg) => { await tx.rollback(); return res.status(409).json({ error: msg }); };
    if (!step) return refuse("Unknown step");
    if (step.Phase > LIVE_PHASE) return refuse(`${step.StepName} opens in a later phase of the Legal module`);
    if (step.Status === to) return refuse(`${step.StepName} is already ${to}`);
    if (to === "Skipped" && !step.IsSkippable) return refuse(`${step.StepName} cannot be skipped`);

    const earlier = steps.filter((s) => s.StepNo < step.StepNo && s.Phase <= LIVE_PHASE && !DONE.has(s.Status));
    if (["In Progress", "Pending Verification", "Completed", "Skipped"].includes(to) && earlier.length) {
      return refuse(`Finish ${earlier[0].StepNo}. ${earlier[0].StepName} first`);
    }
    if (to === "Completed") {
      const { need } = await gates(tx, land);
      const missing = need[code] || [];
      if (missing.length) return refuse(`${step.StepName} cannot be completed yet: ${missing.join("; ")}`);
    }

    await moveStep(tx, req, id, code, step.Status === "Not Started" ? null : step.Status, to, { remarks, skipReason });

    // Reopening a finished step: later finished steps go back for re-verification, with their history kept.
    const reopened = DONE.has(step.Status) && !DONE.has(to);
    const flagged = [];
    if (reopened) {
      for (const later of steps.filter((s) => s.StepNo > step.StepNo && DONE.has(s.Status))) {
        await moveStep(tx, req, id, later.StepCode, later.Status, "Pending Verification", { remarks: `Re-verify: ${step.StepName} was reopened` });
        flagged.push(later.StepName);
      }
    }
    await syncWorkflowStatus(tx, id);
    await writeAudit(tx, req, {
      action: "Workflow step changed", entityType: "Land Property", entityId: id, landId: id,
      oldValue: { step: step.StepName, status: step.Status }, newValue: { step: step.StepName, status: to },
      remarks: skipReason || remarks,
    });
    await tx.commit();
    res.json({ message: `${step.StepName}: ${to}`, reverify: flagged });
  } catch (err) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    console.error("[legal-land] step:", err.message);
    res.status(500).json({ error: "Could not update the step. Please try again." });
  }
});

router.post("/:id/hold", requirePageRight(LAND_PAGE, "edit"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  if (!(await requireApprove(req, res))) return;
  const category = req.body?.category;
  const reason = text(req.body?.reason, 1000);
  const review = req.body?.expectedReviewDate ? String(req.body.expectedReviewDate).slice(0, 10) : null;
  const fileId = req.body?.fileId ? idParam(req.body.fileId) : null;
  if (!HOLD_CATEGORIES.includes(category)) return res.status(400).json({ error: "Choose a hold category" });
  if (!reason) return res.status(400).json({ error: "Give the hold reason" });
  if (review && (!/^\d{4}-\d{2}-\d{2}$/.test(review) || Number.isNaN(Date.parse(review)))) return res.status(400).json({ error: "Expected review date is not valid" });
  try {
    const pool = getPool();
    const r = await pool.request()
      .input("Id", sql.Int, id).input("Category", sql.NVarChar(60), category).input("Reason", sql.NVarChar(1000), reason)
      .input("Review", sql.Date, review).input("FileId", sql.Int, fileId).input("Remarks", sql.NVarChar(1000), text(req.body?.remarks, 1000))
      .input("UserId", sql.Int, req.user?.userId || null)
      .query(`
        UPDATE dbo.LegalLand SET IsOnHold = 1, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @Id AND IsOnHold = 0;
        IF @@ROWCOUNT = 1
          INSERT INTO dbo.LegalHold (LandId, HoldCategory, HoldReason, HoldDate, HeldBy, ExpectedReviewDate, FileId, Remarks)
          OUTPUT INSERTED.HoldId AS id
          VALUES (@Id, @Category, @Reason, CAST(SYSDATETIME() AS DATE), @UserId, @Review, @FileId, @Remarks);`);
    if (!r.recordset?.length) return res.status(409).json({ error: "This land is already on hold, or does not exist" });
    await writeAudit(pool, req, { action: "Land put on hold", entityType: "Land Property", entityId: id, landId: id, newValue: { category, reason, expectedReviewDate: review } });
    res.json({ message: "Land put on hold" });
  } catch (err) {
    console.error("[legal-land] hold:", err.message);
    res.status(500).json({ error: "Could not put the land on hold" });
  }
});

router.post("/:id/resume", requirePageRight(LAND_PAGE, "edit"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  if (!(await requireApprove(req, res))) return;
  const remarks = text(req.body?.remarks, 1000);
  if (!remarks) return res.status(400).json({ error: "Say why the land is resumed" });
  try {
    const pool = getPool();
    const r = await pool.request().input("Id", sql.Int, id).input("Remarks", sql.NVarChar(1000), remarks).input("UserId", sql.Int, req.user?.userId || null)
      .query(`
        UPDATE dbo.LegalLand SET IsOnHold = 0, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @Id AND IsOnHold = 1;
        IF @@ROWCOUNT = 1
          UPDATE dbo.LegalHold SET ResumedBy = @UserId, ResumedAt = SYSUTCDATETIME(), ResumeRemarks = @Remarks
          OUTPUT INSERTED.HoldId AS id
          WHERE LandId = @Id AND ResumedAt IS NULL;`);
    if (!r.recordset?.length) return res.status(409).json({ error: "This land is not on hold" });
    await writeAudit(pool, req, { action: "Workflow resumed", entityType: "Land Property", entityId: id, landId: id, remarks });
    res.json({ message: "Land resumed" });
  } catch (err) {
    console.error("[legal-land] resume:", err.message);
    res.status(500).json({ error: "Could not resume the land" });
  }
});

router.get("/:id/audit", requirePageRight(LAND_PAGE, "view"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const r = await getPool().request().input("Id", sql.Int, id).query(`
      SELECT TOP 300 a.EventId, a.Action, a.EntityType, a.EntityId, a.OldValue, a.NewValue, a.Remarks, a.CreatedAt,
             (SELECT name FROM dbo.users WHERE id = a.UserId) AS UserName
      FROM dbo.LegalRecordAudit a WHERE a.LandId = @Id ORDER BY a.EventId DESC`);
    res.json(r.recordset);
  } catch (err) {
    console.error("[legal-land] audit:", err.message);
    res.status(500).json({ error: "Could not load the audit trail" });
  }
});

// Adds the due diligence checks this land does not have yet (all Pending), so the reviewer works down one list.
router.post("/:id/due-diligence/init", requirePageRight(LAND_PAGE, "edit"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const r = await pool.request().input("Id", sql.Int, id).input("UserId", sql.Int, req.user?.userId || null)
      .input("Items", sql.NVarChar(sql.MAX), JSON.stringify(DUE_DILIGENCE_CHECKS))
      .query(`
        INSERT INTO dbo.LegalDueDiligence (LandId, CheckItem, Result, CreatedBy)
        OUTPUT INSERTED.CheckItem
        SELECT @Id, j.value, N'Pending', @UserId FROM OPENJSON(@Items) j
        WHERE EXISTS (SELECT 1 FROM dbo.LegalLand WHERE LandId = @Id)
          AND NOT EXISTS (SELECT 1 FROM dbo.LegalDueDiligence d WHERE d.LandId = @Id AND d.CheckItem = j.value);`);
    if (r.recordset.length) await writeAudit(pool, req, { action: "Due diligence list created", entityType: "Land Property", entityId: id, landId: id, newValue: { added: r.recordset.length } });
    res.json({ message: r.recordset.length ? `${r.recordset.length} check(s) added` : "Every check is already on the list" });
  } catch (err) {
    console.error("[legal-land] dd init:", err.message);
    res.status(500).json({ error: "Could not create the checklist" });
  }
});

// The land's money in one place: per purchase / sale, its value, verified and pending payments and balance;
// expenses kept apart. Balance = total value − verified payments.
router.get("/:id/finance", requirePageRight(LAND_PAGE, "view"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const r = await getPool().request().input("Id", sql.Int, id).query(`
      SELECT t.TransactionId, t.TransactionNo, t.TxnType, t.BuyerName, t.SellerNames, t.TotalValue, t.AdvanceAmount, t.TxnStatus,
             ISNULL((SELECT SUM(Amount) FROM dbo.LegalPayment p WHERE p.TransactionId = t.TransactionId AND p.IsActive = 1 AND p.VerificationStatus = N'Verified'), 0) AS Verified,
             ISNULL((SELECT SUM(Amount) FROM dbo.LegalPayment p WHERE p.TransactionId = t.TransactionId AND p.IsActive = 1 AND p.VerificationStatus <> N'Verified'), 0) AS Unverified
      FROM dbo.LegalLandTransaction t WHERE t.LandId = @Id AND t.IsActive = 1 ORDER BY t.TransactionId;
      SELECT x.Name AS ExpenseType, SUM(e.Amount) AS Amount FROM dbo.LegalExpense e JOIN dbo.LegalLookupValue x ON x.LookupId = e.ExpenseTypeId
      WHERE e.LandId = @Id AND e.IsActive = 1 GROUP BY x.Name ORDER BY x.Name;
      SELECT ISNULL(SUM(Amount), 0) AS Fees FROM dbo.LegalRegPayment WHERE LandId = @Id AND IsActive = 1 AND VerificationStatus = N'Verified';`);
    const [txns, expenses, fees] = r.recordsets;
    res.json({ transactions: txns.map((t) => ({ ...t, Balance: Number(t.TotalValue) - Number(t.Verified) })), expenses, registrationFees: fees[0].Fees });
  } catch (err) {
    console.error("[legal-land] finance:", err.message);
    res.status(500).json({ error: "Could not load the financial summary" });
  }
});

// ── Phase 6 ──────────────────────────────────────────────────────────────────────────────────────

// ── Ownership chain (step 5, and step 23 from the registered deed) ───────────────────────────────
// One change of ownership at a time, the way a chain of title is read: the land's current owners give
// (all or part of) their shares to new owners on a date. The giving owners' records end the day before,
// anyone giving only part keeps the rest in a new record from that date, and every new owner gets a record
// starting on that date. A transfer event is written per new owner (From = the giving owners), plus the
// inheritance (with heirs) or partition record when the type calls for it. Nothing earlier is overwritten.

const dateOk = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const shareOk = (n) => Number.isFinite(n) && n > 0 && n <= 100;

/** Reads and checks the body of an ownership change. Returns { error } or the clean values. */
function readChange(b) {
  const first = b.first === true;
  const date = typeof b.date === "string" ? b.date.slice(0, 10) : "";
  const from = Array.isArray(b.from) ? b.from.map((x) => ({ recordId: idParam(x.recordId), share: Number(x.sharePct) })) : [];
  const to = Array.isArray(b.to)
    ? b.to.map((x) => ({ name: text(x.name, 200), guardian: text(x.guardian, 200), relationshipTypeId: idParam(x.relationshipTypeId), share: Number(x.sharePct) }))
    : [];
  if (!dateOk(date)) return { error: first ? "Enter the date the first owner's ownership starts" : "Enter the date of the change" };
  if (!first && !idParam(b.transferTypeId)) return { error: "Choose how the ownership changed (sale, inheritance, gift…)" };
  if (!to.length || to.some((x) => !x.name || !shareOk(x.share))) return { error: "Enter each new owner's name and share (%)" };
  if (first) {
    const total = to.reduce((a, x) => a + x.share, 0);
    if (total > 100.0001) return { error: `First owners' shares add up to ${total}% — more than 100%` };
  } else {
    if (!from.length || from.some((x) => !x.recordId || !shareOk(x.share))) return { error: "Choose who gives the land and the share (%) each gives" };
    const out = from.reduce((a, x) => a + x.share, 0);
    const into = to.reduce((a, x) => a + x.share, 0);
    if (Math.abs(out - into) > 0.0001) return { error: `Shares given (${out}%) and shares received (${into}%) must be equal` };
  }
  const inh = b.inheritance || {};
  if (inh.dateOfDeath && !dateOk(String(inh.dateOfDeath).slice(0, 10))) return { error: "Date of death is not valid" };
  return {
    first, date, from, to,
    transferTypeId: idParam(b.transferTypeId),
    ownershipTypeId: idParam(b.ownershipTypeId),
    doc: {
      docTypeId: idParam(b.docTypeId), documentNo: text(b.documentNo, 100), deedNo: text(b.deedNo, 60), fileId: idParam(b.fileId),
      officeId: idParam(b.registrationOfficeId), regDate: dateOk(String(b.registrationDate || "").slice(0, 10)) ? String(b.registrationDate).slice(0, 10) : null,
      value: Number.isFinite(Number(b.transferValue)) && b.transferValue !== "" && b.transferValue != null ? Number(b.transferValue) : null,
    },
    inheritance: {
      dateOfDeath: inh.dateOfDeath ? String(inh.dateOfDeath).slice(0, 10) : null,
      deathCertFileId: idParam(inh.deathCertFileId), heirCertFileId: idParam(inh.heirCertFileId),
      supportingType: ["None", "Will", "Probate", "Succession Certificate", "Court Order"].includes(inh.supportingType) ? inh.supportingType : "None",
      supportingFileId: idParam(inh.supportingFileId), mutationRecordNo: text(inh.mutationRecordNo, 60),
    },
    partitionNewReferences: text(b.partitionNewReferences, 300),
    remarks: text(b.remarks, 1000),
  };
}

/**
 * Applies one ownership change inside `tx`. Returns { error } (nothing written) or { message }.
 * `registeredDeedId` links the change to step 22's approved deed (step 23).
 */
async function applyOwnershipChange(tx, req, landId, c, { registeredDeedId = null } = {}) {
  const userId = req.user?.userId || null;
  const lk = (await tx.request().input("Type", sql.Int, c.transferTypeId).query(`
    SELECT (SELECT Name FROM dbo.LegalLookupValue WHERE LookupId = @Type AND Category = N'transfer-type') AS typeName,
           (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'ownership-type' AND Name = N'Individual') AS individual,
           (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'ownership-type' AND Name = N'Inherited') AS inherited,
           (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'ownership-type' AND Name = N'Joint') AS joint`)).recordset[0];
  if (!c.first && !lk.typeName) return { error: "Choose a valid transfer type" };
  const typeName = lk.typeName || "First owner";

  // Who gives: current owners of this land, locked for the change.
  let recs = [];
  if (!c.first) {
    recs = (await tx.request().input("Land", sql.Int, landId).input("Ids", sql.NVarChar(sql.MAX), JSON.stringify(c.from.map((x) => x.recordId))).query(`
      SELECT RecordId, OwnerName, OwnerGuardian, PersonId, OwnershipTypeId, RelationshipTypeId, SharePct, ValidFrom
      FROM dbo.LegalOwnershipRecord WITH (UPDLOCK, ROWLOCK)
      WHERE LandId = @Land AND IsActive = 1 AND ValidTo IS NULL AND RecordId IN (SELECT CAST(value AS INT) FROM OPENJSON(@Ids))`)).recordset;
    for (const g of c.from) {
      const r = recs.find((x) => x.RecordId === g.recordId);
      if (!r) return { error: "One of the giving owners is not a current owner of this land" };
      if (g.share > Number(r.SharePct) + 0.0001) return { error: `${r.OwnerName} holds ${Number(r.SharePct)}% — cannot give ${g.share}%` };
      if (new Date(c.date) <= new Date(r.ValidFrom)) return { error: `The change date must be after ${r.OwnerName}'s ownership started (${String(r.ValidFrom.toISOString?.() ?? r.ValidFrom).slice(0, 10)})` };
    }
  } else {
    const current = (await tx.request().input("Land", sql.Int, landId).query(
      "SELECT ISNULL(SUM(SharePct), 0) AS s FROM dbo.LegalOwnershipRecord WHERE LandId = @Land AND IsActive = 1 AND ValidTo IS NULL")).recordset[0].s;
    const add = c.to.reduce((a, x) => a + x.share, 0);
    if (Number(current) + add > 100.0001) return { error: `This land already has ${Number(current)}% recorded; adding ${add}% would exceed 100%` };
  }
  const fromNames = recs.map((r) => r.OwnerName).join(", ").slice(0, 200) || null;
  const fromGuardian = recs.length === 1 ? recs[0].OwnerGuardian : null;
  const isInheritance = /inherit/i.test(typeName);
  const isPartition = /partition/i.test(typeName);
  const newOwnershipType = c.ownershipTypeId || (isInheritance ? lk.inherited : c.to.length > 1 ? lk.joint || lk.individual : lk.individual);

  // Inheritance: the deceased is the (single) giving owner; heirs are the receivers.
  let inheritanceId = null;
  if (isInheritance && recs.length) {
    const ins = await tx.request().input("Land", sql.Int, landId).input("Name", sql.NVarChar(200), recs[0].OwnerName).input("G", sql.NVarChar(200), recs[0].OwnerGuardian)
      .input("Person", sql.Int, recs[0].PersonId).input("Death", sql.Date, c.inheritance.dateOfDeath)
      .input("DC", sql.Int, c.inheritance.deathCertFileId).input("HC", sql.Int, c.inheritance.heirCertFileId || c.doc.fileId)
      .input("ST", sql.NVarChar(40), c.inheritance.supportingType).input("SF", sql.Int, c.inheritance.supportingFileId)
      .input("Mut", sql.NVarChar(60), c.inheritance.mutationRecordNo || c.doc.documentNo).input("UserId", sql.Int, userId)
      .query(`INSERT INTO dbo.LegalInheritance (LandId, DeceasedName, DeceasedGuardian, DeceasedPersonId, DateOfDeath, DeathCertFileId, HeirCertFileId, SupportingType, SupportingFileId, MutationRecordNo, VerificationStatus, CreatedBy)
              OUTPUT INSERTED.InheritanceId AS id
              VALUES (@Land, @Name, @G, @Person, @Death, @DC, @HC, @ST, @SF, @Mut, N'Pending', @UserId)`);
    inheritanceId = ins.recordset[0].id;
  }
  if (isPartition) {
    await tx.request().input("Land", sql.Int, landId).input("Date", sql.Date, c.date).input("UserId", sql.Int, userId)
      .input("Parties", sql.NVarChar(1000), `${fromNames || "Co-owners"} → ${c.to.map((x) => x.name).join(", ")}`.slice(0, 1000))
      .input("Shares", sql.NVarChar(1000), c.to.map((x) => `${x.name} ${x.share}%`).join(", ").slice(0, 1000))
      .input("Refs", sql.NVarChar(300), c.partitionNewReferences).input("File", sql.Int, c.doc.fileId)
      .query(`INSERT INTO dbo.LegalPartition (LandId, PartitionType, PartitionDate, PartiesInvolved, ShareDetails, NewReferences, DeedFileId, VerificationStatus, CreatedBy)
              VALUES (@Land, N'Mutual / Amicable', @Date, @Parties, @Shares, @Refs, @File, N'Pending', @UserId)`);
  }

  for (const n of c.to) {
    let eventId = null;
    {  // every owner, the first one too, gets a chain entry so it can be shown, edited and verified
      const ev = await tx.request()
        .input("Land", sql.Int, landId).input("Type", sql.Int, c.transferTypeId || (await tx.request().query("SELECT TOP 1 LookupId AS id FROM dbo.LegalLookupValue WHERE Category = N'transfer-type' AND Name = N'Sale'")).recordset[0]?.id)
        .input("Date", sql.Date, c.date).input("Prev", sql.NVarChar(200), fromNames).input("PrevG", sql.NVarChar(200), fromGuardian)
        .input("New", sql.NVarChar(200), n.name).input("NewG", sql.NVarChar(200), n.guardian)
        .input("DocType", sql.Int, c.doc.docTypeId).input("DocNo", sql.NVarChar(100), c.doc.documentNo).input("DeedNo", sql.NVarChar(60), c.doc.deedNo)
        .input("Office", sql.Int, c.doc.officeId).input("RegDate", sql.Date, c.doc.regDate).input("Share", sql.Decimal(7, 4), n.share)
        .input("Value", sql.Decimal(18, 2), c.doc.value).input("File", sql.Int, c.doc.fileId).input("Deed", sql.Int, registeredDeedId)
        .input("Remarks", sql.NVarChar(1000), c.first ? (c.remarks || "Earliest documented owner") : c.remarks).input("UserId", sql.Int, userId)
        .query(`
          INSERT INTO dbo.LegalOwnershipEvent (LandId, TransferTypeId, EventDate, PreviousOwnerName, PreviousOwnerGuardian, NewOwnerName, NewOwnerGuardian, DocTypeId, DocumentNo, DeedNo,
            RegistrationOfficeId, RegistrationDate, TransferSharePct, TransferValue, DocFileId, RegisteredDeedId, VerificationStatus, Remarks, CreatedBy)
          OUTPUT INSERTED.EventId AS id
          VALUES (@Land, @Type, @Date, @Prev, @PrevG, @New, @NewG, @DocType, @DocNo, @DeedNo, @Office, @RegDate, @Share, @Value, @File, @Deed, N'Pending', @Remarks, @UserId)`);
      eventId = ev.recordset[0].id;
    }
    await tx.request().input("Land", sql.Int, landId).input("Name", sql.NVarChar(200), n.name).input("G", sql.NVarChar(200), n.guardian)
      .input("Type", sql.Int, newOwnershipType).input("Rel", sql.Int, n.relationshipTypeId).input("Share", sql.Decimal(7, 4), n.share)
      .input("Date", sql.Date, c.date).input("Event", sql.Int, eventId).input("Prev", sql.NVarChar(200), fromNames)
      .input("File", sql.Int, c.doc.fileId).input("UserId", sql.Int, userId)
      .query(`INSERT INTO dbo.LegalOwnershipRecord (LandId, OwnerName, OwnerGuardian, OwnershipTypeId, RelationshipTypeId, SharePct, ValidFrom, EventId, PreviousOwnerName, TransferDocFileId, VerificationStatus, CreatedBy)
              VALUES (@Land, @Name, @G, @Type, @Rel, @Share, @Date, @Event, @Prev, @File, N'Pending', @UserId)`);
    if (inheritanceId) {
      await tx.request().input("Land", sql.Int, landId).input("Inh", sql.Int, inheritanceId).input("Name", sql.NVarChar(200), n.name).input("G", sql.NVarChar(200), n.guardian)
        .input("Rel", sql.Int, n.relationshipTypeId).input("Share", sql.Decimal(7, 4), n.share).input("UserId", sql.Int, userId)
        .query("INSERT INTO dbo.LegalInheritanceHeir (LandId, InheritanceId, HeirName, HeirGuardian, RelationshipTypeId, SharePct, CreatedBy) VALUES (@Land, @Inh, @Name, @G, @Rel, @Share, @UserId)");
    }
  }

  // The givers: end the day before; keep any share not given.
  for (const g of c.from) {
    const r = recs.find((x) => x.RecordId === g.recordId);
    await tx.request().input("Id", sql.Int, r.RecordId).input("Date", sql.Date, c.date).input("UserId", sql.Int, userId)
      .query("UPDATE dbo.LegalOwnershipRecord SET ValidTo = DATEADD(day, -1, @Date), UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME() WHERE RecordId = @Id");
    const rest = Number(r.SharePct) - g.share;
    if (rest > 0.0001) {
      await tx.request().input("Land", sql.Int, landId).input("Name", sql.NVarChar(200), r.OwnerName).input("G", sql.NVarChar(200), r.OwnerGuardian)
        .input("Person", sql.Int, r.PersonId).input("Type", sql.Int, r.OwnershipTypeId).input("Rel", sql.Int, r.RelationshipTypeId)
        .input("Share", sql.Decimal(7, 4), rest).input("Date", sql.Date, c.date).input("UserId", sql.Int, userId)
        .input("Note", sql.NVarChar(1000), `Keeps ${Number(rest.toFixed(4))}% after giving ${g.share}% (${typeName}, ${c.date})`)
        .query(`INSERT INTO dbo.LegalOwnershipRecord (LandId, OwnerName, OwnerGuardian, PersonId, OwnershipTypeId, RelationshipTypeId, SharePct, ValidFrom, VerificationStatus, VerificationRemarks, CreatedBy)
                VALUES (@Land, @Name, @G, @Person, @Type, @Rel, @Share, @Date, N'Pending', @Note, @UserId)`);
    }
  }

  await writeAudit(tx, req, {
    action: c.first ? "First owner recorded" : "Ownership changed", entityType: "Land Property", entityId: landId, landId,
    oldValue: recs.length ? { owners: recs.map((r) => ({ name: r.OwnerName, share: Number(r.SharePct) })) } : null,
    newValue: { type: typeName, date: c.date, given: c.from, to: c.to.map((x) => ({ name: x.name, share: x.share })), document: c.doc.documentNo || c.doc.deedNo },
    remarks: c.remarks,
  });
  return {
    message: c.first
      ? `${c.to.map((x) => x.name).join(", ")} recorded as first owner(s) from ${c.date}`
      : `${typeName}: ${fromNames} → ${c.to.map((x) => x.name).join(", ")} on ${c.date}. Previous ownership ends ${new Date(new Date(c.date).getTime() - 86400000).toISOString().slice(0, 10)}.`,
  };
}

// Step 5: add the first owner, or record one change of ownership.
router.post("/:id/ownership/change", requirePageRight(LAND_PAGE, "edit"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  const c = readChange(req.body || {});
  if (c.error) return res.status(400).json({ error: c.error });
  const tx = new sql.Transaction(getPool());
  try {
    await tx.begin();
    const land = await loadLand(tx, id);
    if (!land) { await tx.rollback(); return res.status(404).json({ error: "Land property not found" }); }
    if (land.IsCancelled) { await tx.rollback(); return res.status(409).json({ error: "This land's transaction is cancelled" }); }
    const r = await applyOwnershipChange(tx, req, id, c);
    if (r.error) { await tx.rollback(); return res.status(409).json({ error: r.error }); }
    await tx.commit();
    res.status(201).json({ message: r.message });
  } catch (err) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    console.error("[legal-land] ownership change:", err.message);
    res.status(500).json({ error: "Could not record the ownership change. Please try again." });
  }
});

// Step 5: undo the latest change (only while none of its records is verified). Its rows are deactivated, not
// deleted, and the owners it ended become current again.
router.post("/:id/ownership/undo", requirePageRight(LAND_PAGE, "edit"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  const tx = new sql.Transaction(getPool());
  try {
    await tx.begin();
    const refuse = async (s, msg) => { await tx.rollback(); return res.status(s).json({ error: msg }); };
    const last = (await tx.request().input("Land", sql.Int, id).query(`
      SELECT TOP 1 ValidFrom AS d FROM dbo.LegalOwnershipRecord WITH (UPDLOCK) WHERE LandId = @Land AND IsActive = 1 ORDER BY ValidFrom DESC, RecordId DESC`)).recordset[0];
    if (!last) return refuse(404, "No ownership recorded yet");
    const d = last.d;
    const rows = (await tx.request().input("Land", sql.Int, id).input("D", sql.Date, d).query(`
      SELECT (SELECT COUNT(*) FROM dbo.LegalOwnershipRecord WHERE LandId = @Land AND IsActive = 1 AND ValidFrom = @D AND VerificationStatus = N'Verified')
           + (SELECT COUNT(*) FROM dbo.LegalOwnershipEvent WHERE LandId = @Land AND IsActive = 1 AND EventDate = @D AND VerificationStatus = N'Verified') AS verified,
             (SELECT COUNT(*) FROM dbo.LegalOwnershipEvent WHERE LandId = @Land AND IsActive = 1 AND EventDate = @D AND RegisteredDeedId IS NOT NULL) AS fromDeed`)).recordset[0];
    if (rows.verified) return refuse(409, "The latest change is already verified — ask a reviewer to set it back to Pending first");
    if (rows.fromDeed) return refuse(409, "The latest change came from the registered deed (step 23) and cannot be undone here");
    const userId = req.user?.userId || null;
    await tx.request().input("Land", sql.Int, id).input("D", sql.Date, d).input("UserId", sql.Int, userId).query(`
      UPDATE dbo.LegalOwnershipRecord SET IsActive = 0, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @Land AND IsActive = 1 AND ValidFrom = @D;
      UPDATE dbo.LegalOwnershipEvent SET IsActive = 0, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @Land AND IsActive = 1 AND EventDate = @D;
      UPDATE h SET IsActive = 0, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME() FROM dbo.LegalInheritanceHeir h JOIN dbo.LegalInheritance i ON i.InheritanceId = h.InheritanceId
        WHERE i.LandId = @Land AND i.IsActive = 1 AND i.CreatedAt >= DATEADD(day, -1, CAST(@D AS DATETIME2)) AND i.VerificationStatus = N'Pending'
          AND EXISTS (SELECT 1 FROM dbo.LegalOwnershipRecord r WHERE r.LandId = @Land AND r.ValidTo = DATEADD(day, -1, @D) AND r.OwnerName = i.DeceasedName);
      UPDATE i SET IsActive = 0, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME() FROM dbo.LegalInheritance i
        WHERE i.LandId = @Land AND i.IsActive = 1 AND i.VerificationStatus = N'Pending'
          AND EXISTS (SELECT 1 FROM dbo.LegalOwnershipRecord r WHERE r.LandId = @Land AND r.ValidTo = DATEADD(day, -1, @D) AND r.OwnerName = i.DeceasedName);
      UPDATE dbo.LegalPartition SET IsActive = 0, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @Land AND IsActive = 1 AND PartitionDate = @D AND VerificationStatus = N'Pending';
      UPDATE dbo.LegalOwnershipRecord SET ValidTo = NULL, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @Land AND IsActive = 1 AND ValidTo = DATEADD(day, -1, @D);`);
    await writeAudit(tx, req, { action: "Ownership change undone", entityType: "Land Property", entityId: id, landId: id, oldValue: { date: d } });
    await tx.commit();
    res.json({ message: "Latest ownership change undone — the previous owners are current again" });
  } catch (err) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    console.error("[legal-land] ownership undo:", err.message);
    res.status(500).json({ error: "Could not undo. Please try again." });
  }
});

// Step 5: edit one change of ownership (identified by its date). Date, document and the new owners' names /
// father's names / relationships can change; shares cannot (delete and record the change again for that).
// A new date moves the previous owners' end date and the new owners' start date with it, and must stay after
// the givers' start and not after any later change. The edited change goes back to Pending for verification;
// a verified change can only be edited by a reviewer.
router.put("/:id/ownership/change/:date", requirePageRight(LAND_PAGE, "edit"), async (req, res) => {
  const id = idParam(req.params.id);
  const date = String(req.params.date || "").slice(0, 10);
  const b = req.body || {};
  const newDate = b.date ? String(b.date).slice(0, 10) : date;
  if (!id || !dateOk(date) || !dateOk(newDate)) return res.status(400).json({ error: "Invalid change or date" });
  const owners = Array.isArray(b.owners) ? b.owners.map((o) => ({ eventId: idParam(o.eventId), name: text(o.name, 200), guardian: text(o.guardian, 200), rel: idParam(o.relationshipTypeId) })) : [];
  if (owners.some((o) => !o.eventId || !o.name)) return res.status(400).json({ error: "Every new owner needs a name" });
  const tx = new sql.Transaction(getPool());
  try {
    await tx.begin();
    const refuse = async (s, msg) => { await tx.rollback(); return res.status(s).json({ error: msg }); };
    const evs = (await tx.request().input("Land", sql.Int, id).input("D", sql.Date, date).query(`
      SELECT EventId, VerificationStatus, RegisteredDeedId FROM dbo.LegalOwnershipEvent WITH (UPDLOCK) WHERE LandId = @Land AND IsActive = 1 AND EventDate = @D`)).recordset;
    if (!evs.length) return refuse(404, "Change not found");
    if (evs.some((e) => e.RegisteredDeedId)) return refuse(409, "This change came from the registered deed (step 23); edit the deed instead");
    const recs = (await tx.request().input("Land", sql.Int, id).input("D", sql.Date, date).query(`
      SELECT RecordId, ValidFrom, ValidTo, VerificationStatus, EventId FROM dbo.LegalOwnershipRecord WITH (UPDLOCK)
      WHERE LandId = @Land AND IsActive = 1 AND (ValidFrom = @D OR ValidTo = DATEADD(day, -1, @D))`)).recordset;
    const starting = recs.filter((r) => String(r.ValidFrom.toISOString().slice(0, 10)) === date);
    const givers = recs.filter((r) => r.ValidTo && String(r.ValidTo.toISOString().slice(0, 10)) === new Date(new Date(date).getTime() - 86400000).toISOString().slice(0, 10));
    const verified = evs.some((e) => e.VerificationStatus === "Verified") || starting.some((r) => r.VerificationStatus === "Verified");
    if (verified && !(await canAct(req, "Verifier", LAND_PAGE))) return refuse(409, "This change is verified — only a verifier can edit it");
    if (newDate !== date) {
      const giverStart = givers.map((r) => r.ValidFrom.toISOString().slice(0, 10)).sort().pop();
      if (giverStart && newDate <= giverStart) return refuse(409, `The date must be after ${giverStart}, when the previous owner's ownership started`);
      const laterEnd = starting.filter((r) => r.ValidTo).map((r) => r.ValidTo.toISOString().slice(0, 10)).sort()[0];
      if (laterEnd && newDate > laterEnd) return refuse(409, `The date cannot be after ${laterEnd}, when the next change ends these owners' ownership`);
      const clash = (await tx.request().input("Land", sql.Int, id).input("N", sql.Date, newDate).input("D", sql.Date, date)
        .query("SELECT TOP 1 1 AS x FROM dbo.LegalOwnershipEvent WHERE LandId = @Land AND IsActive = 1 AND EventDate = @N AND EventDate <> @D")).recordset[0];
      if (clash) return refuse(409, "Another change is already recorded on that date");
    }
    const userId = req.user?.userId || null;
    const r0 = tx.request().input("Land", sql.Int, id).input("D", sql.Date, date).input("N", sql.Date, newDate).input("UserId", sql.Int, userId)
      .input("DocType", sql.Int, idParam(b.docTypeId)).input("DocNo", sql.NVarChar(100), text(b.documentNo, 100)).input("DeedNo", sql.NVarChar(60), text(b.deedNo, 60))
      .input("File", sql.Int, idParam(b.fileId)).input("Value", sql.Decimal(18, 2), Number.isFinite(Number(b.transferValue)) && b.transferValue !== "" && b.transferValue != null ? Number(b.transferValue) : null)
      .input("Remarks", sql.NVarChar(1000), text(b.remarks, 1000));
    await r0.query(`
      UPDATE dbo.LegalOwnershipEvent SET EventDate = @N, DocTypeId = @DocType, DocumentNo = @DocNo, DeedNo = @DeedNo, DocFileId = @File, TransferValue = @Value, Remarks = @Remarks,
             VerificationStatus = N'Pending', VerifiedBy = NULL, VerifiedAt = NULL, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME()
      WHERE LandId = @Land AND IsActive = 1 AND EventDate = @D;
      UPDATE dbo.LegalOwnershipRecord SET ValidTo = DATEADD(day, -1, @N), UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME()
      WHERE LandId = @Land AND IsActive = 1 AND ValidTo = DATEADD(day, -1, @D);
      UPDATE dbo.LegalOwnershipRecord SET ValidFrom = @N, TransferDocFileId = ISNULL(@File, TransferDocFileId),
             VerificationStatus = N'Pending', VerifiedBy = NULL, VerifiedAt = NULL, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME()
      WHERE LandId = @Land AND IsActive = 1 AND ValidFrom = @D;
      UPDATE dbo.LegalPartition SET PartitionDate = @N WHERE LandId = @Land AND IsActive = 1 AND PartitionDate = @D;`);
    for (const o of owners) {
      await tx.request().input("Ev", sql.Int, o.eventId).input("Land", sql.Int, id).input("Name", sql.NVarChar(200), o.name).input("G", sql.NVarChar(200), o.guardian)
        .input("Rel", sql.Int, o.rel).query(`
          -- The heir row is found by the owner's old name, so it is renamed first.
          UPDATE dbo.LegalInheritanceHeir SET HeirName = @Name, HeirGuardian = @G, RelationshipTypeId = @Rel
          WHERE LandId = @Land AND IsActive = 1 AND HeirName = (SELECT TOP 1 NewOwnerName FROM dbo.LegalOwnershipEvent WHERE EventId = @Ev);
          UPDATE dbo.LegalOwnershipEvent SET NewOwnerName = @Name, NewOwnerGuardian = @G WHERE EventId = @Ev AND LandId = @Land;
          UPDATE dbo.LegalOwnershipRecord SET OwnerName = @Name, OwnerGuardian = @G, RelationshipTypeId = @Rel WHERE EventId = @Ev AND LandId = @Land AND IsActive = 1;`);
    }
    // Later changes name these owners as "From": keep those names in step.
    await tx.request().input("Land", sql.Int, id).input("N", sql.Date, newDate).query(`
      UPDATE later SET PreviousOwnerName = LEFT((SELECT STRING_AGG(r.OwnerName, ', ') FROM dbo.LegalOwnershipRecord r
                                                 WHERE r.LandId = @Land AND r.IsActive = 1 AND r.ValidTo = DATEADD(day, -1, later.EventDate)), 200)
      FROM dbo.LegalOwnershipEvent later
      WHERE later.LandId = @Land AND later.IsActive = 1 AND later.EventDate > @N
        AND EXISTS (SELECT 1 FROM dbo.LegalOwnershipRecord r WHERE r.LandId = @Land AND r.IsActive = 1 AND r.ValidFrom = @N AND r.ValidTo = DATEADD(day, -1, later.EventDate));`);
    await writeAudit(tx, req, { action: "Ownership change edited", entityType: "Land Property", entityId: id, landId: id, oldValue: { date }, newValue: { date: newDate, owners: owners.map((o) => o.name), document: text(b.documentNo, 100) } });
    await tx.commit();
    res.json({ message: `Change ${newDate !== date ? `moved to ${newDate} and ` : ""}updated — sent back for verification` });
  } catch (err) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    console.error("[legal-land] ownership edit:", err.message);
    res.status(500).json({ error: "Could not update the change. Please try again." });
  }
});

// Step 23: the same change, from an approved registered deed — Sale, with the deed as its document.
router.post("/:id/ownership-transfer", requirePageRight(LAND_PAGE, "edit"), async (req, res) => {
  const id = idParam(req.params.id);
  const b = req.body || {};
  const deedId = idParam(b.registeredDeedId);
  if (!id || !deedId) return res.status(400).json({ error: "Choose the registered deed" });
  const tx = new sql.Transaction(getPool());
  try {
    await tx.begin();
    const refuse = async (msg) => { await tx.rollback(); return res.status(409).json({ error: msg }); };
    const land = await loadLand(tx, id);
    if (!land) return refuse("Land property not found");
    if (land.IsOnHold || land.IsCancelled) return refuse("This land is on hold or cancelled");
    const deed = (await tx.request().input("Deed", sql.Int, deedId).input("Land", sql.Int, id).query(`
      SELECT RegisteredDeedNo, RegistrationDate, RegistrationOfficeId, DeedFileId, ApprovalStatus,
             (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'transfer-type' AND Name = N'Sale') AS sale,
             (SELECT TOP 1 DocTypeId FROM dbo.LegalDocumentType WHERE DocTypeCode = N'REG-DEED') AS regDeed
      FROM dbo.LegalRegisteredDeed WHERE RegisteredId = @Deed AND LandId = @Land AND IsActive = 1`)).recordset[0];
    if (!deed) return refuse("Registered deed not found on this land");
    if (deed.ApprovalStatus !== "Approved") return refuse("Approve the registered deed before recording the ownership transfer");
    const already = (await tx.request().input("Deed", sql.Int, deedId).query("SELECT TOP 1 1 AS x FROM dbo.LegalOwnershipEvent WHERE RegisteredDeedId = @Deed AND IsActive = 1")).recordset[0];
    if (already) return refuse("The ownership transfer for this deed is already recorded");
    const c = readChange({
      date: b.transferDate, transferTypeId: deed.sale,
      from: (b.sellers || []).map((x) => ({ recordId: x.recordId, sharePct: x.sharePct })),
      to: (b.buyers || []).map((x) => ({ name: x.name, guardian: x.guardian, sharePct: x.sharePct })),
      docTypeId: deed.regDeed, documentNo: deed.RegisteredDeedNo, deedNo: deed.RegisteredDeedNo, fileId: deed.DeedFileId,
      registrationOfficeId: deed.RegistrationOfficeId, registrationDate: deed.RegistrationDate?.toISOString?.().slice(0, 10), remarks: b.remarks,
    });
    if (c.error) { await tx.rollback(); return res.status(400).json({ error: c.error }); }
    const r = await applyOwnershipChange(tx, req, id, c, { registeredDeedId: deedId });
    if (r.error) return refuse(r.error);
    await tx.commit();
    res.status(201).json({ message: `Ownership transfer recorded from deed ${deed.RegisteredDeedNo} — verify the new records` });
  } catch (err) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    console.error("[legal-land] transfer:", err.message);
    res.status(500).json({ error: "Could not record the transfer. Please try again." });
  }
});

// Step 27: adds the final checks this land does not have yet.
router.post("/:id/final-checks/init", requirePageRight(LAND_PAGE, "edit"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const r = await getPool().request().input("Id", sql.Int, id).input("UserId", sql.Int, req.user?.userId || null)
      .input("Items", sql.NVarChar(sql.MAX), JSON.stringify(FINAL_CHECKS))
      .query(`
        INSERT INTO dbo.LegalFinalCheck (LandId, CheckItem, Result, CreatedBy)
        OUTPUT INSERTED.CheckItem
        SELECT @Id, j.value, N'Pending', @UserId FROM OPENJSON(@Items) j
        WHERE EXISTS (SELECT 1 FROM dbo.LegalLand WHERE LandId = @Id)
          AND NOT EXISTS (SELECT 1 FROM dbo.LegalFinalCheck c WHERE c.LandId = @Id AND c.CheckItem = j.value);`);
    res.json({ message: r.recordset.length ? `${r.recordset.length} check(s) added` : "Every check is already on the list" });
  } catch (err) {
    console.error("[legal-land] final init:", err.message);
    res.status(500).json({ error: "Could not create the checklist" });
  }
});

/** Step 29: the land's current register — owners and shares, area and unsold area, record references, deed, mutation, status. */
async function currentRegister(conn, id) {
  const r = await conn.request().input("Id", sql.Int, id).query(`
    SELECT l.LandCode, l.LandName, l.Area, u.UnitName, l.Area * u.SqFtFactor AS AreaSqft, l.LandStatus, l.WorkflowStatus, l.IsOnHold, l.IsCancelled,
           m.MouzaName, m.JLNo
      FROM dbo.LegalLand l LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = l.AreaUnitId LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId WHERE l.LandId = @Id;
    SELECT OwnerName, OwnerGuardian, SharePct, ValidFrom, VerificationStatus FROM dbo.LegalOwnershipRecord WHERE LandId = @Id AND IsActive = 1 AND ValidTo IS NULL ORDER BY SharePct DESC;
    SELECT ISNULL(SUM(t.TxnArea * tu.SqFtFactor), 0) AS SoldSqft FROM dbo.LegalLandTransaction t JOIN dbo.LegalAreaUnit tu ON tu.AreaUnitId = t.AreaUnitId
      WHERE t.LandId = @Id AND t.TxnType = N'Sale' AND t.TxnStatus IN (N'Registered', N'Completed') AND t.IsActive = 1;
    SELECT RsKhatianNo + ' / ' + RsDagNo AS Ref FROM dbo.LegalLandRsRecord WHERE LandId = @Id AND IsActive = 1;
    SELECT LrKhatianNo + ' / ' + LrDagNo AS Ref, 'Original' AS Kind FROM dbo.LegalLandLrRecord WHERE LandId = @Id AND IsActive = 1
    UNION ALL SELECT NewLrKhatianNo + ' / ' + NewLrDagNo, 'After mutation' FROM dbo.LegalMutationRecord WHERE LandId = @Id AND IsActive = 1;
    SELECT TOP 1 RegisteredDeedNo, RegistrationDate, ApprovalStatus FROM dbo.LegalRegisteredDeed WHERE LandId = @Id AND IsActive = 1 ORDER BY RegistrationDate DESC;
    SELECT TOP 1 ApplicationStatus, OrderNo FROM dbo.LegalMutation WHERE LandId = @Id AND IsActive = 1 ORDER BY MutationId DESC;
    SELECT TOP 1 Decision FROM dbo.LegalClearance WHERE LandId = @Id AND IsActive = 1 ORDER BY ClearanceId DESC;
    SELECT TOP 1 SettlementStatus FROM dbo.LegalSettlement WHERE LandId = @Id AND IsActive = 1 ORDER BY SettlementId DESC;`);
  const [land, owners, sold, rs, lr, deed, mutation, clearance, settlement] = r.recordsets;
  if (!land[0]) return null;
  const L = land[0];
  const remainingSqft = L.AreaSqft != null ? Number(L.AreaSqft) - Number(sold[0].SoldSqft) : null;
  return {
    landCode: L.LandCode, landName: L.LandName, mouza: L.MouzaName ? `${L.MouzaName} (J.L. ${L.JLNo ?? "-"})` : null,
    area: L.Area != null ? `${Number(L.Area)} ${L.UnitName ?? ""}`.trim() : null,
    remainingArea: remainingSqft != null ? `${Number(remainingSqft.toFixed(2))} sq ft` : null,
    owners: owners.map((o) => ({ name: o.OwnerName, guardian: o.OwnerGuardian, sharePct: Number(o.SharePct), since: o.ValidFrom, verification: o.VerificationStatus })),
    rsReferences: rs.map((x) => x.Ref), lrReferences: lr.map((x) => `${x.Ref} (${x.Kind})`),
    latestDeed: deed[0] ? { number: deed[0].RegisteredDeedNo, date: deed[0].RegistrationDate, approval: deed[0].ApprovalStatus } : null,
    mutationStatus: mutation[0] ? `${mutation[0].ApplicationStatus}${mutation[0].OrderNo ? ` (order ${mutation[0].OrderNo})` : ""}` : "Not applied",
    legalStatus: clearance[0]?.Decision ?? "No clearance yet",
    settlementStatus: settlement[0]?.SettlementStatus ?? "Not settled",
    workflowStatus: L.IsCancelled ? "Cancelled" : L.IsOnHold ? "On hold" : L.WorkflowStatus,
  };
}

router.get("/:id/register", requirePageRight(LAND_PAGE, "view"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const current = await currentRegister(pool, id);
    if (!current) return res.status(404).json({ error: "Land property not found" });
    const snaps = await pool.request().input("Id", sql.Int, id).query(`
      SELECT TOP 20 s.SnapshotId, s.CreatedAt, s.Remarks, s.SnapshotJson, (SELECT name FROM dbo.users WHERE id = s.CreatedBy) AS CreatedByName
      FROM dbo.LegalLandRegisterSnapshot s WHERE s.LandId = @Id ORDER BY s.SnapshotId DESC`);
    res.json({ current, snapshots: snaps.recordset.map((x) => ({ ...x, SnapshotJson: undefined, snapshot: JSON.parse(x.SnapshotJson) })) });
  } catch (err) {
    console.error("[legal-land] register:", err.message);
    res.status(500).json({ error: "Could not load the land register" });
  }
});

// Updating the register keeps a dated snapshot; earlier snapshots stay, so the history remains readable.
router.post("/:id/register/snapshot", requirePageRight(LAND_PAGE, "edit"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const current = await currentRegister(pool, id);
    if (!current) return res.status(404).json({ error: "Land property not found" });
    await pool.request().input("Id", sql.Int, id).input("Json", sql.NVarChar(sql.MAX), JSON.stringify(current))
      .input("Remarks", sql.NVarChar(500), text(req.body?.remarks, 500)).input("UserId", sql.Int, req.user?.userId || null)
      .query("INSERT INTO dbo.LegalLandRegisterSnapshot (LandId, SnapshotJson, Remarks, CreatedBy) VALUES (@Id, @Json, @Remarks, @UserId)");
    await writeAudit(pool, req, { action: "Land register updated", entityType: "Land Property", entityId: id, landId: id, newValue: { owners: current.owners.length, mutation: current.mutationStatus } });
    res.status(201).json({ message: "Land register updated" });
  } catch (err) {
    console.error("[legal-land] snapshot:", err.message);
    res.status(500).json({ error: "Could not update the land register" });
  }
});

// Cancelling a land's transaction never deletes anything; the pipeline is frozen and the reason is kept.
// DELETE /:id — remove a land and everything recorded on it, in one transaction (all or nothing).
// Needs the delete right on Land Property; the caller confirms by sending the Land ID. The enquiry it was converted
// from goes too; the uploaded files of its documents are removed when nothing else uses them. One audit entry
// (without a land link, since the land is gone) records who deleted which land.
router.delete("/:id", requirePageRight(LAND_PAGE, "delete"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid land" });
  const pool = getPool();
  try {
    const land = (await pool.request().input("Id", sql.Int, id).query("SELECT LandId, LandCode, LandName, EnquiryId FROM dbo.LegalLand WHERE LandId = @Id")).recordset[0];
    if (!land) return res.status(404).json({ error: "Land not found" });
    if (String(req.body?.confirmCode || "").trim() !== land.LandCode) {
      return res.status(400).json({ error: `Type the Land ID ${land.LandCode} to confirm the delete` });
    }
    const r = await pool.request().input("Id", sql.Int, id).query(`
      SET XACT_ABORT OFF;
      BEGIN TRANSACTION;
      DECLARE @files TABLE (FileId INT);
      IF OBJECT_ID(N'dbo.LegalLandDocumentVersion', N'U') IS NOT NULL
        INSERT INTO @files SELECT v.FileId FROM dbo.LegalLandDocumentVersion v JOIN dbo.LegalLandDocument d ON d.DocumentId = v.DocumentId WHERE d.LandId = @Id;
      -- Child rows that hang off a land's own rows rather than the land itself.
      DELETE v FROM dbo.LegalLandDocumentVersion v JOIN dbo.LegalLandDocument d ON d.DocumentId = v.DocumentId WHERE d.LandId = @Id;
      IF OBJECT_ID(N'dbo.LegalInheritanceHeir', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.LegalInheritanceHeir', N'LandId') IS NULL
        DELETE h FROM dbo.LegalInheritanceHeir h JOIN dbo.LegalInheritance i ON i.InheritanceId = h.InheritanceId WHERE i.LandId = @Id;
      UPDATE dbo.LegalLand SET EnquiryId = NULL WHERE LandId = @Id;

      -- Every other Legal table with a LandId, in repeated passes so children go before parents.
      DECLARE @work TABLE (Name SYSNAME PRIMARY KEY, Done BIT NOT NULL DEFAULT 0);
      INSERT INTO @work (Name)
      SELECT t.name FROM sys.tables t JOIN sys.columns c ON c.object_id = t.object_id AND c.name = N'LandId'
      WHERE t.schema_id = SCHEMA_ID(N'dbo') AND t.name LIKE N'Legal%' AND t.name NOT IN (N'LegalLand', N'LegalLandEnquiry');
      DECLARE @pass INT = 0, @left INT = 1, @name SYSNAME, @sql NVARCHAR(MAX);
      WHILE @pass < 15 AND @left > 0
      BEGIN
        SET @pass += 1;
        DECLARE w CURSOR LOCAL FAST_FORWARD FOR SELECT Name FROM @work WHERE Done = 0 ORDER BY Name;
        OPEN w; FETCH NEXT FROM w INTO @name;
        WHILE @@FETCH_STATUS = 0
        BEGIN
          BEGIN TRY
            SET @sql = N'DELETE FROM dbo.' + QUOTENAME(@name) + N' WHERE LandId = @Id';
            EXEC sp_executesql @sql, N'@Id INT', @Id = @Id;
            UPDATE @work SET Done = 1 WHERE Name = @name;
          END TRY
          BEGIN CATCH
          END CATCH;
          FETCH NEXT FROM w INTO @name;
        END
        CLOSE w; DEALLOCATE w;
        SET @left = (SELECT COUNT(*) FROM @work WHERE Done = 0);
      END

      DECLARE @blocked NVARCHAR(MAX) = (SELECT STRING_AGG(Name, N', ') FROM @work WHERE Done = 0);
      IF @blocked IS NULL
      BEGIN
        BEGIN TRY
          DELETE FROM dbo.LegalLandEnquiry WHERE LandId = @Id;
          DELETE FROM dbo.LegalLand WHERE LandId = @Id;
        END TRY
        BEGIN CATCH
          SET @blocked = ERROR_MESSAGE();
        END CATCH
      END

      IF @blocked IS NOT NULL
      BEGIN
        ROLLBACK TRANSACTION;
        SELECT CAST(0 AS BIT) AS ok, @blocked AS blocked;
      END
      ELSE
      BEGIN
        -- The document files, unless another record still uses one.
        DECLARE @cond NVARCHAR(MAX) = N'';
        SELECT @cond = @cond + N' AND NOT EXISTS (SELECT 1 FROM ' + QUOTENAME(SCHEMA_NAME(t.schema_id)) + N'.' + QUOTENAME(t.name)
                             + N' x WHERE x.' + QUOTENAME(c.name) + N' = f.FileId)'
        FROM sys.foreign_key_columns fkc
        JOIN sys.tables t ON t.object_id = fkc.parent_object_id
        JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
        WHERE fkc.referenced_object_id = OBJECT_ID(N'dbo.LegalMasterFile');
        CREATE TABLE #gone (FileId INT); INSERT INTO #gone SELECT DISTINCT FileId FROM @files;
        SET @sql = N'DELETE f FROM dbo.LegalMasterFile f WHERE f.FileId IN (SELECT FileId FROM #gone)' + @cond;
        EXEC sp_executesql @sql;
        DROP TABLE #gone;
        COMMIT TRANSACTION;
        SELECT CAST(1 AS BIT) AS ok, NULL AS blocked;
      END`);
    const out = r.recordsets[r.recordsets.length - 1][0];
    if (!out?.ok) {
      console.error("[legal-land] delete blocked:", out?.blocked);
      return res.status(409).json({ error: `${land.LandCode} could not be deleted — other records still refer to it (${out?.blocked}). Nothing was deleted.` });
    }
    await writeAudit(pool, req, { action: "Land deleted", entityType: "Land Property", entityId: id, landId: null, oldValue: { landCode: land.LandCode, landName: land.LandName } });
    res.json({ message: `${land.LandCode} and all its records were deleted` });
  } catch (err) {
    console.error("[legal-land] delete:", err.message);
    res.status(500).json({ error: "Could not delete the land. Nothing was changed." });
  }
});

router.post("/:id/cancel", requirePageRight(LAND_PAGE, "edit"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  if (!(await requireApprove(req, res))) return;
  const reason = text(req.body?.reason, 1000);
  if (!reason || reason.length < 5) return res.status(400).json({ error: "Give the cancellation reason" });
  try {
    const pool = getPool();
    const r = await pool.request().input("Id", sql.Int, id).input("Reason", sql.NVarChar(1000), reason).input("UserId", sql.Int, req.user?.userId || null)
      .query(`UPDATE dbo.LegalLand SET IsCancelled = 1, CancelReason = @Reason, CancelledBy = @UserId, CancelledAt = SYSUTCDATETIME(), UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME()
              OUTPUT INSERTED.LandId WHERE LandId = @Id AND IsCancelled = 0`);
    if (!r.recordset.length) return res.status(409).json({ error: "This land is already cancelled, or does not exist" });
    await writeAudit(pool, req, { action: "Transaction cancelled", entityType: "Land Property", entityId: id, landId: id, remarks: reason });
    res.json({ message: "Cancelled — every record is kept" });
  } catch (err) {
    console.error("[legal-land] cancel:", err.message);
    res.status(500).json({ error: "Could not cancel" });
  }
});

// An enquiry's status from its row: Reject / Hold (reason required) or back to Under Review. The reason is
// added to the enquiry's notes with the date; a converted enquiry cannot change.
// ── Acquisition helpers ──────────────────────────────────────────────────────────────────────────
/** The land's current owners with their shares (step 5), for purchase and approvals. */
const currentOwners = async (conn, landId) => (await conn.request().input("Land", sql.Int, landId).query(`
  SELECT OwnerName, OwnerGuardian, PersonId, CAST(SharePct AS FLOAT) AS SharePct FROM dbo.LegalOwnershipRecord
  WHERE LandId = @Land AND IsActive = 1 AND ValidTo IS NULL ORDER BY SharePct DESC, RecordId`)).recordset;

// Step 8: start the purchase from what the land already holds — sellers = every current owner with their share,
// area = the land's area. One purchase covers the whole land however many owners share the Dag.
router.post("/:id/purchase/from-owners", requirePageRight(LAND_PAGE, "create"), async (req, res) => {
  const id = idParam(req.params.id);
  const buyer = text(req.body?.buyerName, 200);
  const value = Number(req.body?.totalValue);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  if (!buyer) return res.status(400).json({ error: "Enter the buyer (company)" });
  if (!(value > 0)) return res.status(400).json({ error: "Enter the total land value" });
  try {
    const pool = getPool();
    const owners = await currentOwners(pool, id);
    if (!owners.length) return res.status(409).json({ error: "Record the land's current owners first (step 5)" });
    const land = (await pool.request().input("Id", sql.Int, id).query("SELECT Area, AreaUnitId FROM dbo.LegalLand WHERE LandId = @Id")).recordset[0];
    if (!land?.Area || !land.AreaUnitId) return res.status(409).json({ error: "Enter the land's total area and unit first (step 2)" });
    const exists = (await pool.request().input("Id", sql.Int, id).query("SELECT TOP 1 TransactionNo FROM dbo.LegalLandTransaction WHERE LandId = @Id AND IsActive = 1 AND TxnType = N'Purchase' AND TxnStatus <> N'Cancelled'")).recordset[0];
    if (exists) return res.status(409).json({ error: `A purchase (${exists.TransactionNo}) is already recorded for this land` });
    const sellers = owners.map((o) => `${o.OwnerName} (${Number(o.SharePct.toFixed(4))}%)`).join(", ").slice(0, 500);
    const r = await pool.request()
      .input("Prefix", sql.NVarChar(20), codePrefix("TXN")).input("Land", sql.Int, id).input("Buyer", sql.NVarChar(200), buyer)
      .input("BuyerId", sql.Int, idParam(req.body?.buyerId)).input("Sellers", sql.NVarChar(500), sellers)
      .input("Area", sql.Decimal(18, 6), land.Area).input("Unit", sql.Int, land.AreaUnitId).input("Value", sql.Decimal(18, 2), value)
      .input("Rate", sql.Decimal(18, 2), Number(land.Area) ? value / Number(land.Area) : null)
      .input("Advance", sql.Decimal(18, 2), Number(req.body?.advanceAmount) > 0 ? Number(req.body.advanceAmount) : null)
      .input("UserId", sql.Int, req.user?.userId || null)
      .query(`
        INSERT INTO dbo.LegalLandTransaction (TransactionNo, LandId, TxnType, BuyerName, BuyerId, SellerNames, TxnArea, AreaUnitId, RatePerUnit, TotalValue, AdvanceAmount, TxnStatus, CreatedBy)
        OUTPUT INSERTED.TransactionNo AS no
        SELECT ${nextCodeSql("LegalLandTransaction", "TransactionNo", "@Prefix")}, @Land, N'Purchase', @Buyer, @BuyerId, @Sellers, @Area, @Unit, @Rate, @Value, @Advance, N'Draft', @UserId`);
    await writeAudit(pool, req, { action: "Purchase started", entityType: "Land Property", entityId: id, landId: id, newValue: { no: r.recordset[0].no, buyer, sellers, value } });
    res.status(201).json({ message: `Purchase ${r.recordset[0].no}: ${buyer} buys the whole land from ${owners.length} owner(s)` });
  } catch (err) {
    console.error("[legal-land] purchase from owners:", err.message);
    res.status(500).json({ error: "Could not start the purchase" });
  }
});

// Step 13: list every current owner (Seller, with share) and the buyer on an agreement, once each.
router.post("/:id/approvals/from-owners", requirePageRight(LAND_PAGE, "create"), async (req, res) => {
  const id = idParam(req.params.id);
  const agreementId = idParam(req.body?.agreementId);
  if (!id || !agreementId) return res.status(400).json({ error: "Choose the agreement" });
  try {
    const pool = getPool();
    const agr = (await pool.request().input("A", sql.Int, agreementId).input("Land", sql.Int, id).query(`
      SELECT a.AgreementId, t.BuyerName, t.BuyerId FROM dbo.LegalAgreement a JOIN dbo.LegalLandTransaction t ON t.TransactionId = a.TransactionId
      WHERE a.AgreementId = @A AND a.LandId = @Land AND a.IsActive = 1`)).recordset[0];
    if (!agr) return res.status(404).json({ error: "Agreement not found on this land" });
    const owners = await currentOwners(pool, id);
    const rows = [...owners.map((o) => ({ name: o.OwnerName, person: o.PersonId, role: owners.length > 1 ? "Co-owner" : "Seller", share: o.SharePct })),
      { name: agr.BuyerName, person: agr.BuyerId, role: "Buyer", share: null }];
    let added = 0;
    for (const x of rows) {
      const r = await pool.request().input("Land", sql.Int, id).input("A", sql.Int, agreementId).input("Name", sql.NVarChar(200), x.name)
        .input("Person", sql.Int, x.person).input("Role", sql.NVarChar(30), x.role).input("Share", sql.Decimal(7, 4), x.share).input("UserId", sql.Int, req.user?.userId || null)
        .query(`
          IF NOT EXISTS (SELECT 1 FROM dbo.LegalPartyApproval WHERE AgreementId = @A AND PartyName = @Name AND IsActive = 1)
            INSERT INTO dbo.LegalPartyApproval (LandId, AgreementId, PartyName, PersonId, PartyRole, OwnershipSharePct, ConsentStatus, IdVerification, CreatedBy)
            OUTPUT INSERTED.ApprovalId VALUES (@Land, @A, @Name, @Person, @Role, @Share, N'Pending', N'Pending', @UserId);`);
      added += r.recordset?.length ? 1 : 0;
    }
    res.json({ message: added ? `${added} part${added > 1 ? "ies" : "y"} added — record each one's consent` : "Every owner and the buyer are already listed" });
  } catch (err) {
    console.error("[legal-land] approvals from owners:", err.message);
    res.status(500).json({ error: "Could not add the parties" });
  }
});

// Everything recorded on one land, section by section — for the full-details page and its PDF.
router.get("/:id/dossier", requirePageRight(LAND_PAGE, "view"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const r = await getPool().request().input("Id", sql.Int, id).query(`
      SELECT l.LandCode, l.LandName, l.LocationAddress, l.Area, u.UnitName, lt.LandTypeName, l.LandStatus, l.WorkflowStatus, l.IsOnHold, l.IsCancelled,
             d.DistrictName, sd.SubDivisionName, b.BlockName, v.VillageName, ps.StationName, mu.BodyName AS Municipality, m.MouzaName, m.JLNo,
             l.NorthBoundary, l.SouthBoundary, l.EastBoundary, l.WestBoundary, l.GpsLatitude, l.GpsLongitude, e.EnquiryNo, l.CreatedAt
        FROM dbo.LegalLand l
        LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = l.AreaUnitId LEFT JOIN dbo.LegalLandType lt ON lt.LandTypeId = l.LandTypeId
        LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = l.DistrictId LEFT JOIN dbo.LegalSubDivision sd ON sd.SubDivisionId = l.SubDivisionId
        LEFT JOIN dbo.LegalBlock b ON b.BlockId = l.BlockId LEFT JOIN dbo.LegalVillage v ON v.VillageId = l.VillageId
        LEFT JOIN dbo.LegalPoliceStation ps ON ps.PoliceStationId = l.PoliceStationId LEFT JOIN dbo.LegalMunicipality mu ON mu.MunicipalityId = l.MunicipalityId
        LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId LEFT JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = l.EnquiryId
        WHERE l.LandId = @Id;
      SELECT OwnerName, OwnerGuardian, CAST(SharePct AS FLOAT) AS SharePct, ValidFrom, ValidTo, VerificationStatus FROM dbo.LegalOwnershipRecord WHERE LandId = @Id AND IsActive = 1 ORDER BY ValidFrom, RecordId;
      SELECT e.EventDate, t.Name AS TransferType, e.PreviousOwnerName, e.NewOwnerName, CAST(e.TransferSharePct AS FLOAT) AS SharePct, ISNULL(e.DocumentNo, e.DeedNo) AS DocumentNo, e.DocFileId, f.FileName AS DocFileName, e.VerificationStatus
        FROM dbo.LegalOwnershipEvent e LEFT JOIN dbo.LegalMasterFile f ON f.FileId = e.DocFileId LEFT JOIN dbo.LegalLookupValue t ON t.LookupId = e.TransferTypeId WHERE e.LandId = @Id AND e.IsActive = 1 ORDER BY e.EventDate, e.EventId;
      SELECT 'RS' AS Kind, RsKhatianNo AS Khatian, RsDagNo AS Dag, RecordedHolder, CAST(Area AS FLOAT) AS Area, Share, VerificationStatus, DocFileId,
             (SELECT FileName FROM dbo.LegalMasterFile WHERE FileId = DocFileId) AS DocFileName FROM dbo.LegalLandRsRecord WHERE LandId = @Id AND IsActive = 1
      UNION ALL SELECT 'LR', LrKhatianNo, LrDagNo, RecordedHolder, CAST(Area AS FLOAT), Share, VerificationStatus, DocFileId,
             (SELECT FileName FROM dbo.LegalMasterFile WHERE FileId = DocFileId) FROM dbo.LegalLandLrRecord WHERE LandId = @Id AND IsActive = 1
      UNION ALL SELECT 'LR (after mutation)', NewLrKhatianNo, NewLrDagNo, RecordedHolder, CAST(UpdatedArea AS FLOAT), CAST(CAST(NewSharePct AS DECIMAL(7,2)) AS NVARCHAR(20)) + '%', VerificationStatus, RorFileId,
             (SELECT FileName FROM dbo.LegalMasterFile WHERE FileId = RorFileId) FROM dbo.LegalMutationRecord WHERE LandId = @Id AND IsActive = 1;
      SELECT d.DocumentCode, d.Title, t.DocTypeName, d.DocumentNo, d.CurrentVersionNo, v.ReviewStatus, v.FileId AS DocFileId,
             (SELECT FileName FROM dbo.LegalMasterFile WHERE FileId = v.FileId) AS DocFileName FROM dbo.LegalLandDocument d
        JOIN dbo.LegalDocumentType t ON t.DocTypeId = d.DocTypeId JOIN dbo.LegalLandDocumentVersion v ON v.DocumentId = d.DocumentId AND v.VersionNo = d.CurrentVersionNo
        WHERE d.LandId = @Id AND d.IsActive = 1 ORDER BY d.DocumentCode;
      SELECT 'Court case' AS Kind, CaseNumber + ' — ' + CourtName AS Detail, (SELECT Name FROM dbo.LegalLookupValue WHERE LookupId = LegalStatusId) AS Status FROM dbo.LegalCase WHERE LandId = @Id AND IsActive = 1
      UNION ALL SELECT 'Mortgage', LenderName, MortgageStatus FROM dbo.LegalMortgage WHERE LandId = @Id AND IsActive = 1
      UNION ALL SELECT 'Search: ' + CheckType, ISNULL(SearchSource, ''), Result FROM dbo.LegalVerificationCheck WHERE LandId = @Id AND IsActive = 1
      UNION ALL SELECT 'Legal opinion', OpinionNo + ' — ' + FinalOpinion, OpinionStatus FROM dbo.LegalOpinion WHERE LandId = @Id AND IsActive = 1
      UNION ALL SELECT 'Legal clearance', ClearanceNo, Decision FROM dbo.LegalClearance WHERE LandId = @Id AND IsActive = 1;
      SELECT t.TransactionNo, t.TxnType, t.BuyerName, t.SellerNames, CAST(t.TxnArea AS FLOAT) AS Area, au.UnitName, t.TotalValue, t.TxnStatus,
             ISNULL((SELECT SUM(Amount) FROM dbo.LegalPayment p WHERE p.TransactionId = t.TransactionId AND p.IsActive = 1 AND p.VerificationStatus = N'Verified'), 0) AS Paid
        FROM dbo.LegalLandTransaction t LEFT JOIN dbo.LegalAreaUnit au ON au.AreaUnitId = t.AreaUnitId WHERE t.LandId = @Id AND t.IsActive = 1 ORDER BY t.TransactionId;
      SELECT d.DeedCode, dt.DeedTypeName, d.ConsiderationAmount, o.OfficeName, d.RegistrationStatus, d.RegisteredDeedNo,
             (SELECT TOP 1 RegistrationDate FROM dbo.LegalRegisteredDeed r WHERE r.DeedId = d.DeedId AND r.IsActive = 1) AS RegistrationDate
        FROM dbo.LegalLandDeed d LEFT JOIN dbo.LegalDeedType dt ON dt.DeedTypeId = d.DeedTypeId LEFT JOIN dbo.LegalRegistrationOffice o ON o.OfficeId = d.RegistrationOfficeId
        WHERE d.LandId = @Id AND d.IsActive = 1;
      SELECT ApplicationNo, OfficeName, ApplicationStatus, OrderNo, OrderDate FROM dbo.LegalMutation WHERE LandId = @Id AND IsActive = 1;
      SELECT s.StepNo, s.StepCode, s.StepName, ISNULL(st.Status, N'Not Started') AS Status, st.UpdatedAt,
             (SELECT name FROM dbo.users WHERE id = st.UpdatedBy) AS UpdatedByName
        FROM dbo.LegalWorkflowStep s LEFT JOIN dbo.LegalWorkflowStepState st ON st.StepCode = s.StepCode AND st.LandId = @Id
        WHERE s.IsActive = 1 ORDER BY s.StepNo;`);
    const [land, owners, chain, records, documents, legal, transactions, deeds, mutations, steps] = r.recordsets;
    if (!land[0]) return res.status(404).json({ error: "Land property not found" });
    res.json({ land: land[0], owners, chain, records, documents, legal, transactions, deeds, mutations, steps });
  } catch (err) {
    console.error("[legal-land] dossier:", err.message);
    res.status(500).json({ error: "Could not load the land details" });
  }
});

router.post("/enquiries/:id/status", requirePageRight(ENQUIRY_PAGE, "edit"), async (req, res) => {
  const id = idParam(req.params.id);
  const status = req.body?.status;
  const reason = text(req.body?.reason, 500);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  if (!["Rejected", "On Hold", "Under Review"].includes(status)) return res.status(400).json({ error: "Status must be Rejected, On Hold or Under Review" });
  if (status !== "Under Review" && !reason) return res.status(400).json({ error: "Give the reason" });
  try {
    const pool = getPool();
    const r = await pool.request().input("Id", sql.Int, id).input("Status", sql.NVarChar(40), status).input("UserId", sql.Int, req.user?.userId || null)
      .input("Note", sql.NVarChar(600), `[${new Date().toISOString().slice(0, 10)}] ${status}${reason ? `: ${reason}` : ""}`)
      .query(`
        UPDATE dbo.LegalLandEnquiry
        SET EnquiryStatus = @Status,
            InitialNotes = LEFT(ISNULL(InitialNotes + CHAR(10), N'') + @Note, 2000),
            UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME()
        OUTPUT DELETED.EnquiryStatus AS prev, INSERTED.EnquiryNo AS no
        WHERE EnquiryId = @Id AND EnquiryStatus <> N'Converted to Land Record'`);
    if (!r.recordset.length) return res.status(409).json({ error: "This enquiry is already converted, or does not exist" });
    await writeAudit(pool, req, { action: "Enquiry status changed", entityType: "Land Enquiry", entityId: id, oldValue: { status: r.recordset[0].prev }, newValue: { status }, remarks: reason });
    res.json({ message: `${r.recordset[0].no}: ${status}` });
  } catch (err) {
    console.error("[legal-land] enquiry status:", err.message);
    res.status(500).json({ error: "Could not change the status" });
  }
});

router.post("/enquiries/:id/convert", requirePageRight(LAND_PAGE, "create"), requirePageRight(ENQUIRY_PAGE, "edit"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  const tx = new sql.Transaction(getPool());
  try {
    await tx.begin();
    const e = (await tx.request().input("Id", sql.Int, id).query(
      "SELECT * FROM dbo.LegalLandEnquiry WITH (UPDLOCK, ROWLOCK) WHERE EnquiryId = @Id",
    )).recordset[0];
    const refuse = async (status, msg) => { await tx.rollback(); return res.status(status).json({ error: msg }); };
    if (!e) return refuse(404, "Enquiry not found");
    if (e.LandId || e.EnquiryStatus === "Converted to Land Record") return refuse(409, "This enquiry is already converted");
    if (e.EnquiryStatus === "Rejected" || e.EnquiryStatus === "On Hold") return refuse(409, `This enquiry is ${e.EnquiryStatus.toLowerCase()}; resume it before converting.`);

    const ins = await tx.request()
      .input("Prefix", sql.NVarChar(20), codePrefix("LND"))
      .input("Name", sql.NVarChar(200), text(req.body?.landName, 200) || e.LandLocation.slice(0, 200))
      .input("DistrictId", sql.Int, e.DistrictId).input("MouzaId", sql.Int, e.MouzaId)
      .input("Area", sql.Decimal(18, 6), e.ApproxArea).input("AreaUnitId", sql.Int, e.AreaUnitId)
      .input("Address", sql.NVarChar(1000), e.LandLocation).input("EnquiryId", sql.Int, id)
      .input("Lat", sql.Decimal(10, 7), e.GpsLatitude ?? null).input("Lng", sql.Decimal(10, 7), e.GpsLongitude ?? null)
      .input("UserId", sql.Int, req.user?.userId || null)
      .query(`
        INSERT INTO dbo.LegalLand (LandCode, LandName, DistrictId, MouzaId, Area, AreaUnitId, LocationAddress, GpsLatitude, GpsLongitude, EnquiryId, LandStatus, IsOnHold, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.LandId AS id, INSERTED.LandCode AS code
        SELECT ${nextCodeSql("LegalLand", "LandCode", "@Prefix")}, @Name, @DistrictId, @MouzaId, @Area, @AreaUnitId, @Address, @Lat, @Lng, @EnquiryId, N'Identified', 0, 1, @UserId, SYSUTCDATETIME()`);
    const land = ins.recordset[0];
    await tx.request().input("Id", sql.Int, id).input("LandId", sql.Int, land.id).input("UserId", sql.Int, req.user?.userId || null)
      .query(`UPDATE dbo.LegalLandEnquiry SET EnquiryStatus = N'Converted to Land Record', LandId = @LandId, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME() WHERE EnquiryId = @Id`);
    await moveStep(tx, req, land.id, "ENQUIRY", null, "Completed", { remarks: `Converted from enquiry ${e.EnquiryNo}` });
    await syncWorkflowStatus(tx, land.id);
    await writeAudit(tx, req, { action: "Land created", entityType: "Land Property", entityId: land.id, landId: land.id, newValue: { landCode: land.code, fromEnquiry: e.EnquiryNo } });
    await writeAudit(tx, req, { action: "Enquiry converted", entityType: "Land Enquiry", entityId: id, landId: land.id, oldValue: { status: e.EnquiryStatus }, newValue: { status: "Converted to Land Record", landCode: land.code } });
    await tx.commit();
    res.status(201).json({ landId: land.id, landCode: land.code, message: `Land ${land.code} created from enquiry ${e.EnquiryNo}` });
  } catch (err) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    console.error("[legal-land] convert:", err.message);
    res.status(500).json({ error: "Could not convert the enquiry. Please try again." });
  }
});

// ── Land-Wise Verification & Two-Level Approval Endpoints ──────────────────────────────

router.post("/:id/verify", requirePageRight(LAND_PAGE, "edit"), async (req, res) => {
  const id = idParam(req.params.id);
  const remarks = text(req.body?.remarks, 1000);
  if (!id) return res.status(400).json({ error: "Invalid land id" });
  try {
    const pool = getPool();
    const r = await pool.request()
      .input("Id", sql.Int, id)
      .input("UserId", sql.Int, req.user?.userId || null)
      .input("Remarks", sql.NVarChar(1000), remarks)
      .query(`
        UPDATE dbo.LegalLand
        SET VerificationStatus = N'Verified',
            WorkflowStatus = N'Verified (Pending L1)',
            L1Status = N'Pending',
            UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME()
        OUTPUT INSERTED.LandCode, INSERTED.LandName
        WHERE LandId = @Id AND IsActive = 1
      `);
    if (!r.recordset.length) return res.status(404).json({ error: "Land not found" });
    await writeAudit(pool, req, {
      action: "Land Data Verified",
      entityType: "Land Property",
      entityId: id,
      landId: id,
      newValue: { VerificationStatus: "Verified", WorkflowStatus: "Verified (Pending L1)" },
      remarks
    });
    res.json({ message: `Land ${r.recordset[0].LandCode} verified. Forwarded for L1 Legal Review.` });
  } catch (err) {
    console.error("[legal-land] verify error:", err.message);
    res.status(500).json({ error: "Could not verify land record" });
  }
});

router.post("/:id/submit-l1", requirePageRight(LAND_PAGE, "edit"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid land id" });
  try {
    const pool = getPool();
    const r = await pool.request()
      .input("Id", sql.Int, id)
      .input("UserId", sql.Int, req.user?.userId || null)
      .query(`
        UPDATE dbo.LegalLand
        SET L1Status = N'Pending',
            WorkflowStatus = N'L1 Pending',
            UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME()
        OUTPUT INSERTED.LandCode
        WHERE LandId = @Id AND IsActive = 1
      `);
    if (!r.recordset.length) return res.status(404).json({ error: "Land not found" });
    await writeAudit(pool, req, { action: "Submitted for L1 Review", entityType: "Land Property", entityId: id, landId: id });
    res.json({ message: `Land ${r.recordset[0].LandCode} submitted for L1 Legal Review.` });
  } catch (err) {
    console.error("[legal-land] submit-l1 error:", err.message);
    res.status(500).json({ error: "Could not submit for L1 review" });
  }
});

router.post("/:id/action-l1", async (req, res) => {
  const id = idParam(req.params.id);
  const action = req.body?.action;
  const remarks = text(req.body?.remarks, 1000);
  if (!id) return res.status(400).json({ error: "Invalid land id" });
  if (!["Approve", "Return"].includes(action)) return res.status(400).json({ error: "Action must be Approve or Return" });
  if (action === "Return" && !remarks) return res.status(400).json({ error: "Remarks required when returning" });
  try {
    const pool = getPool();
    const isApprove = action === "Approve";
    const r = await pool.request()
      .input("Id", sql.Int, id)
      .input("UserId", sql.Int, req.user?.userId || null)
      .input("Remarks", sql.NVarChar(1000), remarks)
      .input("L1Status", sql.NVarChar(30), isApprove ? "Approved" : "Returned")
      .input("L2Status", sql.NVarChar(30), isApprove ? "Pending" : "Pending")
      .input("VerificationStatus", sql.NVarChar(30), isApprove ? "Verified" : "Draft")
      .input("WorkflowStatus", sql.NVarChar(60), isApprove ? "L2 Pending" : "L1 Returned (Draft)")
      .query(`
        UPDATE dbo.LegalLand
        SET L1Status = @L1Status,
            L1ReviewerId = @UserId,
            L1ReviewedAt = SYSUTCDATETIME(),
            L1Remarks = @Remarks,
            L2Status = @L2Status,
            VerificationStatus = @VerificationStatus,
            WorkflowStatus = @WorkflowStatus,
            UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME()
        OUTPUT INSERTED.LandCode
        WHERE LandId = @Id AND IsActive = 1
      `);
    if (!r.recordset.length) return res.status(404).json({ error: "Land not found" });
    await writeAudit(pool, req, {
      action: isApprove ? "Land L1 Approved" : "Land L1 Returned",
      entityType: "Land Property",
      entityId: id,
      landId: id,
      newValue: { L1Status: isApprove ? "Approved" : "Returned", remarks },
      remarks
    });
    res.json({ message: isApprove ? `Land ${r.recordset[0].LandCode} L1 approved; forwarded to L2 Executive Approval.` : `Land ${r.recordset[0].LandCode} returned for correction.` });
  } catch (err) {
    console.error("[legal-land] action-l1 error:", err.message);
    res.status(500).json({ error: "Could not record L1 action" });
  }
});

router.post("/:id/action-l2", async (req, res) => {
  const id = idParam(req.params.id);
  const action = req.body?.action;
  const remarks = text(req.body?.remarks, 1000);
  if (!id) return res.status(400).json({ error: "Invalid land id" });
  if (!["Approve", "Return", "Reject"].includes(action)) return res.status(400).json({ error: "Action must be Approve, Return or Reject" });
  if ((action === "Return" || action === "Reject") && !remarks) return res.status(400).json({ error: "Remarks required when returning or rejecting" });
  try {
    const pool = getPool();
    const isApprove = action === "Approve";
    const isReturn = action === "Return";
    const l2Status = isApprove ? "Approved" : isReturn ? "Returned" : "Rejected";
    const l1Status = isReturn ? "Pending" : undefined;
    const landStatus = isApprove ? "Owned" : action === "Reject" ? "In Dispute" : undefined;
    const workflowStatus = isApprove ? "Approved" : isReturn ? "L2 Returned to L1" : "Rejected";

    const request = pool.request()
      .input("Id", sql.Int, id)
      .input("UserId", sql.Int, req.user?.userId || null)
      .input("Remarks", sql.NVarChar(1000), remarks)
      .input("L2Status", sql.NVarChar(30), l2Status)
      .input("WorkflowStatus", sql.NVarChar(60), workflowStatus);

    let extraUpdates = "";
    if (l1Status) {
      request.input("L1Status", sql.NVarChar(30), l1Status);
      extraUpdates += ", L1Status = @L1Status";
    }
    if (landStatus) {
      request.input("LandStatus", sql.NVarChar(40), landStatus);
      extraUpdates += ", LandStatus = @LandStatus";
    }

    const r = await request.query(`
      UPDATE dbo.LegalLand
      SET L2Status = @L2Status,
          L2ApproverId = @UserId,
          L2ApprovedAt = SYSUTCDATETIME(),
          L2Remarks = @Remarks,
          WorkflowStatus = @WorkflowStatus
          ${extraUpdates},
          UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME()
      OUTPUT INSERTED.LandCode
      WHERE LandId = @Id AND IsActive = 1
    `);
    if (!r.recordset.length) return res.status(404).json({ error: "Land not found" });
    await writeAudit(pool, req, {
      action: isApprove ? "Land L2 Final Approved" : isReturn ? "Land L2 Returned" : "Land L2 Rejected",
      entityType: "Land Property",
      entityId: id,
      landId: id,
      newValue: { L2Status: l2Status, workflowStatus },
      remarks
    });
    res.json({
      message: isApprove
        ? `Land ${r.recordset[0].LandCode} formally approved at Level 2 (Final). Property status is Active / Owned.`
        : isReturn
        ? `Land ${r.recordset[0].LandCode} returned to L1 Legal Review.`
        : `Land ${r.recordset[0].LandCode} has been rejected.`
    });
  } catch (err) {
    console.error("[legal-land] action-l2 error:", err.message);
    res.status(500).json({ error: "Could not record L2 action" });
  }
});


module.exports = router;
