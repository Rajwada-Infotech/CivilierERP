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
const { usersHaveWhatsApp } = require("../../services/usersWhatsApp");
const { getPool, sql } = require("../../db");
const { requirePageRight, hasAnyPageAction } = require("../../middleware/requirePageRight");
const { canAct, ownWork, isSuperAdmin } = require("./approvalAuthority");
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
  // The seven per-owner checks are no longer required: the verifier ticks the whole Ownership section once (Verified).

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
/** Legal dashboard counters along the whole flow (each part only once its migration has run). */
async function pipelineCounters(pool) {
  const has = (await pool.request().query(`SELECT OBJECT_ID('dbo.LegalDiligenceArea','U') AS dd, OBJECT_ID('dbo.LegalPropertyRestriction','U') AS pr,
    OBJECT_ID('dbo.LegalPostRegTask','U') AS pt, COL_LENGTH('dbo.LegalLand','DeedTargetDate') AS dt`)).recordset[0];
  const PRE = "l.IsActive = 1 AND ISNULL(l.IsCancelled, 0) = 0 AND ISNULL(l.WorkflowStatus, N'') NOT IN (N'Deed Process', N'Deed Completed', N'Deed Registration', N'Registered')";
  const area = (a) => `(SELECT COUNT(*) FROM dbo.LegalLand l WHERE ${PRE} AND NOT EXISTS (SELECT 1 FROM dbo.LegalDiligenceArea x WHERE x.LandId = l.LandId AND x.Area = N'${a}' AND x.Status IN (N'Verified', N'Not Applicable')))`;
  const parts = [
    "(SELECT COUNT(*) FROM dbo.LegalLandEnquiry WHERE IsActive = 1) AS enquiries",
    `(SELECT COUNT(*) FROM dbo.LegalLand l WHERE ${PRE}) AS pendingFinal`,
    "(SELECT COUNT(*) FROM dbo.LegalLand WHERE IsActive = 1 AND WorkflowStatus = N'Deed Process' AND ISNULL(L1Status, N'Pending') <> N'Approved') AS pendingL1",
    "(SELECT COUNT(*) FROM dbo.LegalLand WHERE IsActive = 1 AND WorkflowStatus = N'Deed Process' AND L1Status = N'Approved') AS pendingL2",
    "(SELECT COUNT(*) FROM dbo.LegalLand WHERE IsActive = 1 AND WorkflowStatus = N'Deed Registration') AS pendingRegistration",
    "(SELECT COUNT(*) FROM dbo.LegalLand WHERE IsActive = 1 AND WorkflowStatus = N'Registered') AS registered",
  ];
  if (has.dt) parts.push("(SELECT COUNT(*) FROM dbo.LegalLand WHERE IsActive = 1 AND WorkflowStatus = N'Deed Process' AND DeedTargetDate < CAST(GETDATE() AS DATE)) AS deedOverdue");
  // Deed Registration lands with an instalment past its due date and not covered by the payments made (migration 664).
  if ((await pool.request().query("SELECT OBJECT_ID('dbo.LegalPaymentSchedule','U') AS t")).recordset[0].t) parts.push(
    `(SELECT COUNT(DISTINCT s.LandId) FROM dbo.LegalPaymentSchedule s JOIN dbo.LegalLand l ON l.LandId = s.LandId AND l.IsActive = 1 AND l.WorkflowStatus = N'Deed Registration'
      WHERE s.DueDate < CAST(GETDATE() AS DATE)
        AND (SELECT SUM(s2.Amount) FROM dbo.LegalPaymentSchedule s2 WHERE s2.LandId = s.LandId AND s2.DueDate <= s.DueDate)
          > ISNULL((SELECT SUM(CASE WHEN tt.Name = N'Refund' THEN -p.Amount WHEN tt.Name IN (N'Sale Receipt', N'Expense') THEN 0 ELSE p.Amount END) FROM dbo.LegalPayment p
                    LEFT JOIN dbo.LegalLookupValue tt ON tt.LookupId = p.TxnTypeId WHERE p.LandId = s.LandId AND p.IsActive = 1), 0)) AS paymentOverdue`);
  if ((await pool.request().query("SELECT OBJECT_ID('dbo.LegalEnquiryOfficeSearch','U') AS t")).recordset[0].t) parts.push(
    "(SELECT COUNT(DISTINCT o.EnquiryId) FROM dbo.LegalEnquiryOfficeSearch o JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = o.EnquiryId WHERE e.IsActive = 1 AND e.LandId IS NULL AND e.EnquiryStatus <> N'Rejected' AND o.Status = N'Pending') AS pendingDeedSearch",
    "(SELECT COUNT(*) FROM dbo.LegalEnquiryOfficeSearch o JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = o.EnquiryId WHERE e.IsActive = 1 AND e.LandId IS NULL AND e.EnquiryStatus <> N'Rejected' AND o.Status = N'Pending' AND o.DueDate < CAST(GETDATE() AS DATE)) AS deedSearchOverdue");
  if (has.dd) parts.push(
    `${area("ownership")} AS pendingOwnership`,
    `(SELECT COUNT(*) FROM dbo.LegalLand l WHERE ${PRE} AND (SELECT COUNT(*) FROM dbo.LegalDiligenceArea x WHERE x.LandId = l.LandId AND x.Status IN (N'Verified', N'Not Applicable')) < 4) AS pendingDiligence`,
    `(SELECT COUNT(*) FROM dbo.LegalLand l WHERE ${PRE} AND EXISTS (SELECT 1 FROM dbo.LegalInheritance i WHERE i.LandId = l.LandId AND i.IsActive = 1)
        AND NOT EXISTS (SELECT 1 FROM dbo.LegalDiligenceArea x WHERE x.LandId = l.LandId AND x.Area = N'inheritance' AND x.Status IN (N'Verified', N'Not Applicable'))) AS pendingInheritance`,
    `(SELECT COUNT(*) FROM dbo.LegalLand l WHERE l.IsActive = 1 AND (SELECT TOP 1 v.Status FROM dbo.LegalReview v WHERE v.LandId = l.LandId ORDER BY v.CreatedAt DESC, v.ReviewId DESC)
        IN (N'Pending', N'Under Review', N'Additional Information Required')) AS pendingReview`,
    `(SELECT COUNT(*) FROM dbo.LegalLand l WHERE l.IsActive = 1 AND (SELECT TOP 1 r.RiskLevel FROM dbo.LegalRiskAssessment r WHERE r.LandId = l.LandId ORDER BY r.AssessedAt DESC, r.RiskId DESC) IN (N'High', N'Critical')) AS highRisk`);
  if (has.pr) parts.push(`(SELECT COUNT(DISTINCT p.LandId) FROM dbo.LegalPropertyRestriction p JOIN dbo.LegalLand l ON l.LandId = p.LandId AND l.IsActive = 1
        WHERE p.IsActive = 1 AND (p.Status = N'Transfer prohibited' OR (p.Status = N'Pending' AND p.PermissionRequired <> N'No'))) AS restricted`);
  if (has.pt) parts.push(`(SELECT COUNT(*) FROM dbo.LegalPostRegTask t JOIN dbo.LegalLand l ON l.LandId = t.LandId AND l.IsActive = 1
        WHERE t.Task = N'Mutation application' AND t.Status <> N'Completed') AS pendingMutation`);
  return (await pool.request().query(`SELECT ${parts.join(",\n")}`)).recordset[0];
}

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
        (SELECT COUNT(*) FROM dbo.LegalLand WHERE IsActive = 1 AND EntryType = N'Existing / Backlog') AS backlogLands,
        (SELECT COUNT(*) FROM dbo.LegalLandTransaction WHERE IsActive = 1 AND TxnType = N'Sale') AS sales,
        (SELECT COUNT(*) FROM dbo.LegalLand WHERE LandStatus IN (N'Disposed / Transferred', N'Inactive') OR IsActive = 0) AS disposed,
        (SELECT COUNT(*) FROM dbo.LegalLandRsRecord WHERE IsActive = 1) AS rsRecords,
        (SELECT COUNT(*) FROM dbo.LegalLandLrRecord WHERE IsActive = 1) AS lrRecords;
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
        UNION ALL SELECT N'Legal records' FROM dbo.LegalLandLegalRecord WHERE IsActive = 1 AND VerificationStatus = N'Pending'
        UNION ALL SELECT N'Land tax receipts' FROM dbo.LegalLandTax WHERE IsActive = 1 AND VerificationStatus = N'Pending'
      ) x GROUP BY x.Kind ORDER BY N DESC;
      -- Land waiting for its record approval (Data Verification → L1 → L2), oldest first.
      SELECT TOP 8 l.LandId, l.LandCode, l.LandName, l.WorkflowStatus,
             CASE WHEN l.L1Status = N'Approved' THEN N'L2 Executive Approval'
                  WHEN ISNULL(l.VerificationStatus, N'Draft') = N'Verified' THEN N'L1 Legal Review'
                  ELSE N'Data Verification' END AS Stage,
             ISNULL(l.UpdatedAt, l.CreatedAt) AS Since
      FROM dbo.LegalLand l
      WHERE l.IsActive = 1 AND ISNULL(l.L2Status, N'Pending') NOT IN (N'Approved', N'Rejected')
      ORDER BY ISNULL(l.UpdatedAt, l.CreatedAt);
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
    const [counts, recent, approvals, awaitingApproval, payments, cases, transfers, more, allLands] = r.recordsets;
    // Deed Process: lands whose timeline has passed (highlighted on the dashboard).
    let deedOverdue = [];
    if (await deedReady(getPool())) {
      deedOverdue = (await getPool().request().query(`
        SELECT LandId, LandCode, LandName, CONVERT(char(10), DeedTargetDate, 23) AS DeedTargetDate, DATEDIFF(day, DeedTargetDate, CAST(GETDATE() AS DATE)) AS DaysOver
        FROM dbo.LegalLand WHERE IsActive = 1 AND WorkflowStatus = N'Deed Process' AND DeedTargetDate < CAST(GETDATE() AS DATE)
        ORDER BY DeedTargetDate`)).recordset;
    }
    res.json({ ...counts[0], ...more[0], recent, approvals, awaitingApproval, payments, cases, transfers, allLands, deedOverdue, pipeline: await pipelineCounters(getPool()) });
  } catch (err) {
    console.error("[legal-land] stats:", err.message);
    res.status(500).json({ error: "Could not load land statistics" });
  }
});

// GET /api/legal/land/project-map: every company land with the project it serves. Complete = fully approved (L2);
// everything else is under process. Cancelled lands are left out; sold / transferred ones are marked.
router.get("/project-map", requirePageRight(LAND_PAGE, "view"), async (_req, res) => {
  try {
    const pool = getPool();
    const lands = (await pool.request().query(`
      SELECT l.LandId, l.LandCode, l.LandName, l.ProjectId, p.name AS ProjectName, m.MouzaName, d.DistrictName,
             (SELECT TOP 1 e.EnquiryNo FROM dbo.LegalLandEnquiry e WHERE e.LandId = l.LandId) AS EnquiryNo,
             CAST(l.Area AS DECIMAL(18,4)) AS Area, u.UnitName, l.EntryType, l.LandStatus, l.WorkflowStatus,
             l.VerificationStatus, l.L1Status, l.L2Status, l.IsOnHold,
             CAST(1 AS BIT) AS IsComplete,
             (SELECT COUNT(*) FROM dbo.LegalLandDocument x WHERE x.LandId = l.LandId AND x.IsActive = 1) AS Documents,
             (SELECT STRING_AGG(r.OwnerName, ', ') FROM dbo.LegalOwnershipRecord r WHERE r.LandId = l.LandId AND r.IsActive = 1 AND r.ValidTo IS NULL) AS CurrentOwners
      FROM dbo.LegalLand l
      LEFT JOIN dbo.enterprise p ON p.id = l.ProjectId
      LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = l.DistrictId
      LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = l.AreaUnitId
      -- Only land whose deed is registered (Deed Registration → Submit) shows in Land & Projects.
      WHERE l.IsActive = 1 AND ISNULL(l.IsCancelled, 0) = 0 AND l.WorkflowStatus = N'Registered'
      ORDER BY p.name, l.LandCode`)).recordset;
    const projects = (await pool.request().query("SELECT id, name FROM dbo.enterprise WHERE business_type = 'P' ORDER BY name")).recordset;
    res.json({ lands, projects });
  } catch (err) {
    console.error("[legal-land] project-map:", err.message);
    res.status(500).json({ error: "Could not load the land-project map" });
  }
});

// PUT /api/legal/land/:id/project { projectId | null }: put a land under a project, or take it off.
router.put("/:id/project", requirePageRight(LAND_PAGE, "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const projectId = req.body?.projectId ? parseInt(req.body.projectId, 10) : null;
  if (!id) return res.status(400).json({ error: "Invalid land" });
  try {
    const pool = getPool();
    if (projectId) {
      const ok = await pool.request().input("p", sql.Int, projectId).query("SELECT 1 AS x FROM dbo.enterprise WHERE id = @p AND business_type = 'P'");
      if (!ok.recordset.length) return res.status(400).json({ error: "Project not found" });
    }
    const old = (await pool.request().input("id", sql.Int, id).query(`SELECT ProjectId, L2Status, WorkflowStatus,
        (SELECT TOP 1 e.EnquiryNo FROM dbo.LegalLandEnquiry e WHERE e.LandId = l.LandId AND e.ProjectId IS NOT NULL) AS EnquiryNo
      FROM dbo.LegalLand l WHERE LandId = @id AND IsActive = 1`)).recordset[0];
    if (!old) return res.status(404).json({ error: "Land not found" });
    // Land from an enquiry takes the enquiry's project; change it on the enquiry's project, not here.
    if (old.EnquiryNo) return res.status(409).json({ error: `This land's project comes from enquiry ${old.EnquiryNo}` });
    // Only fully approved land (L2) goes under a project; taking a land off its project is always allowed.
    if (projectId && old.WorkflowStatus !== "Registered") return res.status(400).json({ error: "Only land with a registered deed can be mapped to a project" });
    await pool.request().input("id", sql.Int, id).input("p", sql.Int, projectId).input("u", sql.Int, req.user?.userId || null)
      .query("UPDATE dbo.LegalLand SET ProjectId = @p, UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @u WHERE LandId = @id");
    await writeAudit(pool, req, { action: projectId ? "Land mapped to project" : "Land removed from project", entityType: "Land Property", entityId: id, landId: id, oldValue: { projectId: old.ProjectId }, newValue: { projectId } });
    res.json({ ok: true });
  } catch (err) {
    console.error("[legal-land] set project:", err.message);
    res.status(500).json({ error: "Could not change the land's project" });
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
             N'Final Verification Pending' AS Stage,
             DATEDIFF(day, ISNULL(l.UpdatedAt, l.CreatedAt), SYSUTCDATETIME()) AS WaitingDays,
             l.CreatedAt, ISNULL(l.UpdatedAt, l.CreatedAt) AS LastUpdated,
             (SELECT name FROM dbo.users WHERE id = l.CreatedBy) AS CreatedByName
      FROM dbo.LegalLand l
      LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = l.DistrictId
      LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId
      LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = l.AreaUnitId
      WHERE l.IsActive = 1
        AND ISNULL(l.WorkflowStatus, N'') NOT IN (N'Deed Process', N'Deed Completed', N'Deed Registration', N'Registered') AND ISNULL(l.IsCancelled, 0) = 0
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
    const withWa = await usersHaveWhatsApp(getPool());
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
             (SELECT name FROM dbo.users WHERE id = l.CreatedBy) AS CreatedByName,
             enq.EnquiryNo, enq.CreatedBy AS EnquiryById, eu.name AS EnquiryByName${withWa ? ", eu.WhatsAppNo AS EnquiryByWhatsApp" : ""}
      FROM dbo.LegalLand l
      LEFT JOIN dbo.LegalLandEnquiry enq ON enq.EnquiryId = l.EnquiryId
      LEFT JOIN dbo.users eu ON eu.id = enq.CreatedBy
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
    const extra = !!(await getPool().request().query("SELECT COL_LENGTH('dbo.LegalRecordAudit', 'UserRole') AS c")).recordset[0].c;
    const r = await getPool().request().input("Id", sql.Int, id).query(`
      SELECT TOP 300 a.EventId, a.Action, a.EntityType, a.EntityId, a.OldValue, a.NewValue, a.Remarks, a.CreatedAt, ${extra ? "a.UserRole, a.DocumentRef," : ""}
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
             ISNULL((SELECT SUM(Amount) FROM dbo.LegalPayment p WHERE p.TransactionId = t.TransactionId AND p.IsActive = 1), 0) AS Verified,
             CAST(0 AS DECIMAL(18,2)) AS Unverified
      FROM dbo.LegalLandTransaction t WHERE t.LandId = @Id AND t.IsActive = 1 ORDER BY t.TransactionId;
      SELECT x.Name AS ExpenseType, SUM(e.Amount) AS Amount FROM dbo.LegalExpense e JOIN dbo.LegalLookupValue x ON x.LookupId = e.ExpenseTypeId
      WHERE e.LandId = @Id AND e.IsActive = 1 GROUP BY x.Name ORDER BY x.Name;
      SELECT ISNULL(SUM(Amount), 0) AS Fees FROM dbo.LegalRegPayment WHERE LandId = @Id AND IsActive = 1;`);
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
              VALUES (@Land, @Name, @G, @Person, @Death, @DC, @HC, @ST, @SF, @Mut, N'Verified', @UserId)`);
    inheritanceId = ins.recordset[0].id;
  }
  if (isPartition) {
    await tx.request().input("Land", sql.Int, landId).input("Date", sql.Date, c.date).input("UserId", sql.Int, userId)
      .input("Parties", sql.NVarChar(1000), `${fromNames || "Co-owners"} → ${c.to.map((x) => x.name).join(", ")}`.slice(0, 1000))
      .input("Shares", sql.NVarChar(1000), c.to.map((x) => `${x.name} ${x.share}%`).join(", ").slice(0, 1000))
      .input("Refs", sql.NVarChar(300), c.partitionNewReferences).input("File", sql.Int, c.doc.fileId)
      .query(`INSERT INTO dbo.LegalPartition (LandId, PartitionType, PartitionDate, PartiesInvolved, ShareDetails, NewReferences, DeedFileId, VerificationStatus, CreatedBy)
              VALUES (@Land, N'Mutual / Amicable', @Date, @Parties, @Shares, @Refs, @File, N'Verified', @UserId)`);
  }

  for (const n of c.to) {
    let eventId = null;
    // Every new owner is in the Owner list (matched by name, added when new), so the same person is offered next time.
    const personId = await ownerPersonId(tx, n.name, n.guardian, userId);
    {  // every owner, the first one too, gets a chain entry so it can be shown, edited and verified
      const ev = await tx.request()
        .input("Land", sql.Int, landId).input("Type", sql.Int, c.transferTypeId || (await tx.request().query("SELECT TOP 1 LookupId AS id FROM dbo.LegalLookupValue WHERE Category = N'transfer-type' AND Name = N'Sale'")).recordset[0]?.id)
        .input("Date", sql.Date, c.date).input("Prev", sql.NVarChar(200), fromNames).input("PrevG", sql.NVarChar(200), fromGuardian)
        .input("New", sql.NVarChar(200), n.name).input("NewG", sql.NVarChar(200), n.guardian)
        .input("DocType", sql.Int, c.doc.docTypeId).input("DocNo", sql.NVarChar(100), c.doc.documentNo).input("DeedNo", sql.NVarChar(60), c.doc.deedNo)
        .input("Office", sql.Int, c.doc.officeId).input("RegDate", sql.Date, c.doc.regDate).input("Share", sql.Decimal(7, 4), n.share)
        .input("Value", sql.Decimal(18, 2), c.doc.value).input("File", sql.Int, c.doc.fileId).input("Deed", sql.Int, registeredDeedId)
        .input("Remarks", sql.NVarChar(1000), c.first ? (c.remarks || "Earliest documented owner") : c.remarks).input("UserId", sql.Int, userId).input("Person", sql.Int, personId)
        .query(`
          INSERT INTO dbo.LegalOwnershipEvent (LandId, TransferTypeId, EventDate, PreviousOwnerName, PreviousOwnerGuardian, NewOwnerName, NewOwnerGuardian, DocTypeId, DocumentNo, DeedNo,
            RegistrationOfficeId, RegistrationDate, TransferSharePct, TransferValue, DocFileId, RegisteredDeedId, VerificationStatus, Remarks, CreatedBy, NewOwnerId)
          OUTPUT INSERTED.EventId AS id
          VALUES (@Land, @Type, @Date, @Prev, @PrevG, @New, @NewG, @DocType, @DocNo, @DeedNo, @Office, @RegDate, @Share, @Value, @File, @Deed, N'Verified', @Remarks, @UserId, @Person)`);
      eventId = ev.recordset[0].id;
    }
    await tx.request().input("Land", sql.Int, landId).input("Name", sql.NVarChar(200), n.name).input("G", sql.NVarChar(200), n.guardian)
      .input("Type", sql.Int, newOwnershipType).input("Rel", sql.Int, n.relationshipTypeId).input("Share", sql.Decimal(7, 4), n.share)
      .input("Date", sql.Date, c.date).input("Event", sql.Int, eventId).input("Prev", sql.NVarChar(200), fromNames)
      .input("File", sql.Int, c.doc.fileId).input("UserId", sql.Int, userId).input("Person", sql.Int, personId)
      .query(`INSERT INTO dbo.LegalOwnershipRecord (LandId, OwnerName, OwnerGuardian, OwnershipTypeId, RelationshipTypeId, SharePct, ValidFrom, EventId, PreviousOwnerName, TransferDocFileId, VerificationStatus, CreatedBy, PersonId)
              VALUES (@Land, @Name, @G, @Type, @Rel, @Share, @Date, @Event, @Prev, @File, N'Verified', @UserId, @Person)`);
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
                VALUES (@Land, @Name, @G, @Person, @Type, @Rel, @Share, @Date, N'Verified', @Note, @UserId)`);
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
/** The Owner-list person for a name (same name, and same father / husband when both are known), added when new. */
async function ownerPersonId(conn, name, guardian, userId) {
  const n = String(name || "").trim().replace(/\s+/g, " ").slice(0, 200);
  if (!n) return null;
  const g = String(guardian || "").trim().slice(0, 200) || null;
  const hit = (await conn.request().input("Name", sql.NVarChar(200), n).input("G", sql.NVarChar(200), g)
    .query(`SELECT TOP 1 PersonId FROM dbo.LegalPerson WHERE PersonRole = N'Owner' AND IsActive = 1 AND LTRIM(RTRIM(FullName)) = @Name
            AND (@G IS NULL OR GuardianName IS NULL OR GuardianName = @G) ORDER BY CASE WHEN GuardianName = @G THEN 0 ELSE 1 END`)).recordset[0];
  if (hit) return hit.PersonId;
  return (await conn.request().input("Name", sql.NVarChar(200), n).input("G", sql.NVarChar(200), g).input("UserId", sql.Int, userId || null)
    .query(`INSERT INTO dbo.LegalPerson (PersonRole, FullName, GuardianName, PartyType, IsActive, CreatedBy, CreatedAt)
            OUTPUT INSERTED.PersonId VALUES (N'Owner', @Name, @G, N'Individual', 1, @UserId, SYSUTCDATETIME())`)).recordset[0].PersonId;
}

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
      SELECT (SELECT COUNT(*) FROM dbo.LegalLand WHERE LandId = @Land AND WorkflowStatus IN (N'Deed Process', N'Deed Completed', N'Deed Registration', N'Registered')) AS verified,
             (SELECT COUNT(*) FROM dbo.LegalOwnershipEvent WHERE LandId = @Land AND IsActive = 1 AND EventDate = @D AND RegisteredDeedId IS NOT NULL) AS fromDeed`)).recordset[0];
    if (rows.verified) return refuse(409, "This land is verified and in Deed Process — its ownership can no longer be undone");
    if (rows.fromDeed) return refuse(409, "The latest change came from the registered deed (step 23) and cannot be undone here");
    const userId = req.user?.userId || null;
    await tx.request().input("Land", sql.Int, id).input("D", sql.Date, d).input("UserId", sql.Int, userId).query(`
      UPDATE dbo.LegalOwnershipRecord SET IsActive = 0, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @Land AND IsActive = 1 AND ValidFrom = @D;
      UPDATE dbo.LegalOwnershipEvent SET IsActive = 0, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @Land AND IsActive = 1 AND EventDate = @D;
      UPDATE h SET IsActive = 0, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME() FROM dbo.LegalInheritanceHeir h JOIN dbo.LegalInheritance i ON i.InheritanceId = h.InheritanceId
        WHERE i.LandId = @Land AND i.IsActive = 1 AND i.CreatedAt >= DATEADD(day, -1, CAST(@D AS DATETIME2))
          AND EXISTS (SELECT 1 FROM dbo.LegalOwnershipRecord r WHERE r.LandId = @Land AND r.ValidTo = DATEADD(day, -1, @D) AND r.OwnerName = i.DeceasedName);
      UPDATE i SET IsActive = 0, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME() FROM dbo.LegalInheritance i
        WHERE i.LandId = @Land AND i.IsActive = 1
          AND EXISTS (SELECT 1 FROM dbo.LegalOwnershipRecord r WHERE r.LandId = @Land AND r.ValidTo = DATEADD(day, -1, @D) AND r.OwnerName = i.DeceasedName);
      UPDATE dbo.LegalPartition SET IsActive = 0, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @Land AND IsActive = 1 AND PartitionDate = @D;
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
    const inDeed = (await tx.request().input("Land", sql.Int, id).query("SELECT WorkflowStatus FROM dbo.LegalLand WHERE LandId = @Land")).recordset[0];
    if (["Deed Process", "Deed Completed", "Deed Registration", "Registered"].includes(inDeed?.WorkflowStatus) && !(await canAct(req, "Verifier", LAND_PAGE))) return refuse(409, "This land is verified and in Deed Process — only a verifier can edit it");
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
             UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME()
      WHERE LandId = @Land AND IsActive = 1 AND EventDate = @D;
      UPDATE dbo.LegalOwnershipRecord SET ValidTo = DATEADD(day, -1, @N), UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME()
      WHERE LandId = @Land AND IsActive = 1 AND ValidTo = DATEADD(day, -1, @D);
      UPDATE dbo.LegalOwnershipRecord SET ValidFrom = @N, TransferDocFileId = ISNULL(@File, TransferDocFileId),
             UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME()
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
             l.NorthBoundary, l.SouthBoundary, l.EastBoundary, l.WestBoundary, l.GpsLatitude, l.GpsLongitude, e.EnquiryNo, l.CreatedAt,
             l.EntryType, l.PossessionStatus, l.AcquisitionDate, l.AcquisitionDateApprox, l.RsDagNo, l.LrDagNo, l.RsKhatianNo, l.LrKhatianNo
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
             ISNULL((SELECT SUM(Amount) FROM dbo.LegalPayment p WHERE p.TransactionId = t.TransactionId AND p.IsActive = 1), 0) AS Paid
        FROM dbo.LegalLandTransaction t LEFT JOIN dbo.LegalAreaUnit au ON au.AreaUnitId = t.AreaUnitId WHERE t.LandId = @Id AND t.IsActive = 1 ORDER BY t.TransactionId;
      SELECT d.DeedCode, dt.DeedTypeName, d.ConsiderationAmount, o.OfficeName, d.RegistrationStatus, d.RegisteredDeedNo,
             (SELECT TOP 1 RegistrationDate FROM dbo.LegalRegisteredDeed r WHERE r.DeedId = d.DeedId AND r.IsActive = 1) AS RegistrationDate
        FROM dbo.LegalLandDeed d LEFT JOIN dbo.LegalDeedType dt ON dt.DeedTypeId = d.DeedTypeId LEFT JOIN dbo.LegalRegistrationOffice o ON o.OfficeId = d.RegistrationOfficeId
        WHERE d.LandId = @Id AND d.IsActive = 1;
      SELECT ApplicationNo, OfficeName, ApplicationStatus, OrderNo, OrderDate FROM dbo.LegalMutation WHERE LandId = @Id AND IsActive = 1;
      SELECT s.StepNo, s.StepCode, s.StepName, ISNULL(st.Status, N'Not Started') AS Status, st.UpdatedAt,
             (SELECT name FROM dbo.users WHERE id = st.UpdatedBy) AS UpdatedByName
        FROM dbo.LegalWorkflowStep s LEFT JOIN dbo.LegalWorkflowStepState st ON st.StepCode = s.StepCode AND st.LandId = @Id
        WHERE s.IsActive = 1 ORDER BY s.StepNo;
      SELECT RecordType, CaseNumber, CourtAuthority, FilingDate, OrderDate, RecordStatus, DocFileId, VerificationStatus,
             (SELECT FileName FROM dbo.LegalMasterFile WHERE FileId = DocFileId) AS DocFileName FROM dbo.LegalLandLegalRecord WHERE LandId = @Id AND IsActive = 1 ORDER BY FilingDate, LegalRecordId;
      SELECT LenderName, ISNULL(LoanType, (SELECT Name FROM dbo.LegalLookupValue WHERE LookupId = MortgageTypeId)) AS LoanType, LoanAmount, OutstandingAmount, LoanStartDate,
             LoanClosureDate, ISNULL(LoanStatus, MortgageStatus) AS LoanStatus, MortgageDeedNo, VerificationStatus FROM dbo.LegalMortgage WHERE LandId = @Id AND IsActive = 1 ORDER BY LoanStartDate, MortgageId;
      SELECT p.PaymentDate, (SELECT Name FROM dbo.LegalLookupValue WHERE LookupId = p.TxnTypeId) AS TxnType, p.Amount, p.Payer, p.Payee,
             (SELECT Name FROM dbo.LegalLookupValue WHERE LookupId = p.PaymentModeId) AS PaymentMode, ISNULL(p.TransactionRef, p.BankRef) AS Ref, p.ReceiptNo, p.ReceiptFileId AS DocFileId,
             (SELECT FileName FROM dbo.LegalMasterFile WHERE FileId = p.ReceiptFileId) AS DocFileName, p.VerificationStatus
        FROM dbo.LegalPayment p WHERE p.LandId = @Id AND p.IsActive = 1 ORDER BY p.PaymentDate, p.PaymentId;
      SELECT TaxYear, PaymentDate, Amount, ReceiptNo, RelatedOwner, ReceiptFileId AS DocFileId,
             (SELECT FileName FROM dbo.LegalMasterFile WHERE FileId = ReceiptFileId) AS DocFileName, VerificationStatus FROM dbo.LegalLandTax WHERE LandId = @Id AND IsActive = 1 ORDER BY TaxYear;
      SELECT ValuationDate, EstimatedMarketValue, GovernmentValuation, ValuationSource, Surveyor, SurveyDate, ValuationFileId AS DocFileId,
             (SELECT FileName FROM dbo.LegalMasterFile WHERE FileId = ValuationFileId) AS DocFileName, VerificationStatus FROM dbo.LegalValuation WHERE LandId = @Id AND IsActive = 1 ORDER BY ValuationDate;`);
    const [land, owners, chain, records, documents, legal, transactions, deeds, mutations, steps, legalRecords, loans, payments, taxes, valuations] = r.recordsets;
    if (!land[0]) return res.status(404).json({ error: "Land property not found" });
    res.json({ land: land[0], owners, chain, records, documents, legal, transactions, deeds, mutations, steps, legalRecords, loans, payments, taxes, valuations });
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
    // Deed Registry Search comes first: every registration office's search must be complete.
    if ((await tx.request().query("SELECT OBJECT_ID('dbo.LegalEnquiryOfficeSearch','U') AS t")).recordset[0].t) {
      const open = (await tx.request().input("Id", sql.Int, id).query(
        "SELECT STRING_AGG(OfficeType, ', ') AS t FROM dbo.LegalEnquiryOfficeSearch WHERE EnquiryId = @Id AND Status = N'Pending'")).recordset[0].t;
      if (open) return refuse(409, `Finish the Deed Registry Search first — still open: ${open}.`);
      // No timeline at all = no office type set up for the enquiry's state: the search cannot be skipped that way.
      const n = (await tx.request().input("Id", sql.Int, id).query("SELECT COUNT(*) AS n FROM dbo.LegalEnquiryOfficeSearch WHERE EnquiryId = @Id")).recordset[0].n;
      if (!n) return refuse(409, "No registration office type is set up for this enquiry's state (Setup → Registration Office Types), so its Deed Registry Search cannot be done yet.");
    }

    // Land ID = <address prefix>/<running no>/<financial year>, e.g. KOL/00001/2026-27. The prefix is the land's
    // district code (Setup → District), else the first letters of the district name; the number runs per prefix and year.
    // The year is the enquiry's (set when it was saved); older enquiries without one use the current year.
    const pre = (await tx.request().input("D", sql.Int, e.DistrictId).query(
      "SELECT COALESCE(NULLIF(LTRIM(RTRIM(DistrictCode)), N''), LEFT(DistrictName, 3)) AS prefix FROM dbo.LegalDistrict WHERE DistrictId = @D")).recordset[0];
    const clean = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9-]/g, "");
    const addrPrefix = clean(pre?.prefix).slice(0, 10) || "LND";
    const now = new Date(); const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fy = clean(e.FinYear).slice(0, 12) || `${fyStart}-${String(fyStart + 1).slice(2)}`;

    const ins = await tx.request()
      .input("Prefix", sql.NVarChar(20), `${addrPrefix}/`).input("Fy", sql.NVarChar(20), `/${fy}`)
      .input("Name", sql.NVarChar(200), text(req.body?.landName, 200) || e.LandLocation.slice(0, 200))
      .input("DistrictId", sql.Int, e.DistrictId).input("MouzaId", sql.Int, e.MouzaId)
      .input("Area", sql.Decimal(18, 6), e.ApproxArea).input("AreaUnitId", sql.Int, e.AreaUnitId)
      .input("Address", sql.NVarChar(1000), e.LandLocation).input("EnquiryId", sql.Int, id)
      .input("Lat", sql.Decimal(10, 7), e.GpsLatitude ?? null).input("Lng", sql.Decimal(10, 7), e.GpsLongitude ?? null)
      .input("UserId", sql.Int, req.user?.userId || null)
      // The project comes from the enquiry (enquiries are raised under a project).
      .input("ProjectId", sql.Int, e.ProjectId ?? null)
      .query(`
        INSERT INTO dbo.LegalLand (LandCode, LandName, DistrictId, MouzaId, Area, AreaUnitId, LocationAddress, GpsLatitude, GpsLongitude, EnquiryId, LandStatus, IsOnHold, IsActive, CreatedBy, CreatedAt,
                                     EntryType, VerificationStatus, L1Status, L2Status, WorkflowStatus, ProjectId)
        OUTPUT INSERTED.LandId AS id, INSERTED.LandCode AS code
        SELECT @Prefix + RIGHT('00000' + CAST(ISNULL((
                 SELECT MAX(TRY_CAST(SUBSTRING(LandCode, LEN(@Prefix) + 1, LEN(LandCode) - LEN(@Prefix) - LEN(@Fy)) AS INT))
                 FROM dbo.LegalLand WITH (UPDLOCK, HOLDLOCK) WHERE LandCode LIKE @Prefix + '%' AND RIGHT(LandCode, LEN(@Fy)) = @Fy), 0) + 1 AS VARCHAR(10)), 5) + @Fy, @Name, @DistrictId, @MouzaId, @Area, @AreaUnitId, @Address, @Lat, @Lng, @EnquiryId, N'Identified', 0, 1, @UserId, SYSUTCDATETIME(),
               N'New Acquisition', N'Draft', N'Pending', N'Pending', N'Draft (Verification Pending)', @ProjectId`);
    const land = ins.recordset[0];
    // The enquiry's RS / LR records become the land's (migration 661).
    if ((await tx.request().query("SELECT OBJECT_ID('dbo.LegalEnquiryRsRecord','U') AS t")).recordset[0].t) {
      await tx.request().input("Id", sql.Int, id).input("LandId", sql.Int, land.id).input("MouzaId", sql.Int, e.MouzaId).input("UserId", sql.Int, req.user?.userId || null).query(`
        INSERT INTO dbo.LegalLandRsRecord (LandId, MouzaId, RsKhatianNo, RsDagNo, RecordedHolder, Area, AreaUnitId, Share, Remarks, IsActive, CreatedBy)
        SELECT @LandId, ISNULL(r.MouzaId, @MouzaId), r.RsKhatianNo, r.RsDagNo, r.RecordedHolder, r.Area, r.AreaUnitId, r.Share, r.Remarks, 1, @UserId
        FROM dbo.LegalEnquiryRsRecord r WHERE r.EnquiryId = @Id AND r.IsActive = 1;
        INSERT INTO dbo.LegalLandLrRecord (LandId, MouzaId, LrKhatianNo, LrDagNo, RecordedHolder, Area, AreaUnitId, Share, Remarks, IsActive, CreatedBy)
        SELECT @LandId, ISNULL(r.MouzaId, @MouzaId), r.LrKhatianNo, r.LrDagNo, r.RecordedHolder, r.Area, r.AreaUnitId, r.Share, r.Remarks, 1, @UserId
        FROM dbo.LegalEnquiryLrRecord r WHERE r.EnquiryId = @Id AND r.IsActive = 1;
        UPDATE dbo.LegalLand SET RsDagNo = LEFT((SELECT TOP 1 RsDagNo FROM dbo.LegalEnquiryRsRecord WHERE EnquiryId = @Id AND IsActive = 1 ORDER BY RsRecordId), 30),
          RsKhatianNo = LEFT((SELECT TOP 1 RsKhatianNo FROM dbo.LegalEnquiryRsRecord WHERE EnquiryId = @Id AND IsActive = 1 ORDER BY RsRecordId), 30),
          LrDagNo = LEFT((SELECT TOP 1 LrDagNo FROM dbo.LegalEnquiryLrRecord WHERE EnquiryId = @Id AND IsActive = 1 ORDER BY LrRecordId), 30),
          LrKhatianNo = LEFT((SELECT TOP 1 LrKhatianNo FROM dbo.LegalEnquiryLrRecord WHERE EnquiryId = @Id AND IsActive = 1 ORDER BY LrRecordId), 30)
        WHERE LandId = @LandId;`);
    }
    await tx.request().input("Id", sql.Int, id).input("LandId", sql.Int, land.id).input("UserId", sql.Int, req.user?.userId || null)
      .query(`UPDATE dbo.LegalLandEnquiry SET EnquiryStatus = N'Converted to Land Record', LandId = @LandId, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME() WHERE EnquiryId = @Id`);
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

// ── Final verification → Deed Process ───────────────────────────────────────────────────────────────────────────
// No per-section ticks and no L1/L2 approval. When the land's data entry is complete, a verifier (Setup → Approval
// Control; never the user who entered the land) opens one page with every detail and document, sets the timeline
// (deed to be done by) and clicks "Deed Process". The land then shows on the Deed Process page for the deed department.

const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);

/** What is still missing before final verification (empty list = data entry complete). */
async function missingForFinal(pool, id) {
  const { diligenceGate } = require("./dueDiligence");
  const r = (await pool.request().input("Id", sql.Int, id).query(`
    SELECT l.DistrictId, l.MouzaId, l.Area,
      (SELECT COUNT(*) FROM dbo.LegalOwnershipRecord WHERE LandId = @Id AND IsActive = 1 AND ValidTo IS NULL) AS owners,
      (SELECT COUNT(*) FROM dbo.LegalLandRsRecord WHERE LandId = @Id AND IsActive = 1)
        + (SELECT COUNT(*) FROM dbo.LegalLandLrRecord WHERE LandId = @Id AND IsActive = 1) AS records,
      (SELECT COUNT(*) FROM dbo.LegalLandDocument WHERE LandId = @Id AND IsActive = 1) AS documents
    FROM dbo.LegalLand l WHERE l.LandId = @Id AND l.IsActive = 1`)).recordset[0];
  if (!r) return null;
  const miss = [];
  if (!r.DistrictId || !r.MouzaId || !r.Area) miss.push("Basic Information (district, mouza and area)");
  if (!r.owners) miss.push("Ownership History (current owners)");
  if (!r.records) miss.push("Land Records (an RS or LR record)");
  if (!r.documents) miss.push("Documents (at least one)");
  // Legal due diligence (Due Diligence tab): every area checked, risk assessed, legal clearance where needed.
  (await diligenceGate(pool, id)).forEach((b) => miss.push(`Due diligence — ${b}`));
  return miss;
}

const deedReady = async (pool) => !!(await pool.request().query("SELECT COL_LENGTH('dbo.LegalLand', 'DeedTargetDate') AS c")).recordset[0].c;
const IN_DEED = (w) => ["Deed Process", "Deed Completed", "Deed Registration", "Registered"].includes(w);

// GET /:id/final-status — readiness, and the deed process if already sent.
router.get("/:id/final-status", requirePageRight(LAND_PAGE, "view"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid land id" });
  try {
    const pool = getPool();
    const missing = await missingForFinal(pool, id);
    if (!missing) return res.status(404).json({ error: "Land not found" });
    const ready = await deedReady(pool);
    const l = (await pool.request().input("Id", sql.Int, id).query(`
      SELECT LandCode, CreatedBy, IsOnHold, IsCancelled, WorkflowStatus
             ${ready ? ", FinalVerifiedAt, CONVERT(char(10), DeedTargetDate, 23) AS DeedTargetDate, (SELECT name FROM dbo.users WHERE id = l.FinalVerifiedBy) AS FinalVerifiedByName" : ""}
      FROM dbo.LegalLand l WHERE LandId = @Id`)).recordset[0];
    const canVerify = await canAct(req, "Verifier", LAND_PAGE);
    const own = ownWork(req, l.CreatedBy, "this land");
    // Changes made after verification (shown to the verifier for re-verification).
    let changed = null;
    if ((await pool.request().query("SELECT COL_LENGTH('dbo.LegalLand', 'DeedChangedAt') AS c")).recordset[0].c) {
      const c = (await pool.request().input("Id", sql.Int, id).query(`
        SELECT DeedChangedAt, DeedChangedBy, (SELECT name FROM dbo.users WHERE id = l.DeedChangedBy) AS ByName FROM dbo.LegalLand l WHERE LandId = @Id;
        SELECT TOP 50 a.CreatedAt, a.Action, a.EntityType, u.name AS UserName
        FROM dbo.LegalRecordAudit a LEFT JOIN dbo.users u ON u.id = a.UserId
        WHERE a.LandId = @Id AND a.CreatedAt > ISNULL((SELECT ISNULL(DeedReverifiedAt, FinalVerifiedAt) FROM dbo.LegalLand WHERE LandId = @Id), '1900-01-01')
          AND a.Action NOT IN (N'Land verified — sent to Deed Process', N'Deed timeline changed', N'Deed completed', N'Deed reopened', N'Deed copy uploaded', N'Deed copy removed', N'Deed changes re-verified')
        ORDER BY a.CreatedAt DESC`)).recordsets;
      if (c[0][0]?.DeedChangedAt) changed = { at: c[0][0].DeedChangedAt, by: c[0][0].ByName, items: c[1] };
    }
    res.json({ changed,
      missing, ready: missing.length === 0, inDeedProcess: IN_DEED(l.WorkflowStatus), workflowStatus: l.WorkflowStatus,
      verifiedAt: l.FinalVerifiedAt ?? null, verifiedBy: l.FinalVerifiedByName ?? null, targetDate: l.DeedTargetDate ?? null,
      canVerify: canVerify && !own,
      blockedReason: !canVerify ? "Only a Verifier (Setup → Approval Control) can do the final verification" : own || (l.IsCancelled ? "This land is cancelled" : l.IsOnHold ? "This land is on hold" : null),
    });
  } catch (err) {
    console.error("[legal-land] final-status:", err.message);
    res.status(500).json({ error: "Could not load the verification status" });
  }
});

// POST /:id/final-verify { targetDate } — verified, sent to the deed department with its timeline.
router.post("/:id/final-verify", requirePageRight(LAND_PAGE, "view"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid land id" });
  const target = isoDate(req.body?.targetDate);
  if (!target) return res.status(400).json({ error: "Set the timeline (deed to be done by)" });
  const pool = getPool();
  try {
    if (!(await deedReady(pool))) return res.status(503).json({ error: "Deed Process is not set up yet (migration 641)" });
    const l = (await pool.request().input("Id", sql.Int, id).query(
      "SELECT LandCode, CreatedBy, IsOnHold, IsCancelled, WorkflowStatus FROM dbo.LegalLand WHERE LandId = @Id AND IsActive = 1")).recordset[0];
    if (!l) return res.status(404).json({ error: "Land not found" });
    if (!(await canAct(req, "Verifier", LAND_PAGE))) return res.status(403).json({ error: "Only a Verifier (Setup → Approval Control) can do the final verification" });
    const own = ownWork(req, l.CreatedBy, "this land");
    if (own) return res.status(409).json({ error: own });
    if (l.IsCancelled) return res.status(409).json({ error: `${l.LandCode} is cancelled` });
    if (l.IsOnHold) return res.status(409).json({ error: `${l.LandCode} is on hold — resume it first` });
    if (IN_DEED(l.WorkflowStatus)) return res.status(409).json({ error: `${l.LandCode} is already in Deed Process` });
    const missing = await missingForFinal(pool, id);
    if (missing.length) return res.status(409).json({ error: `Complete the data entry first: ${missing.join(", ")}` });
    await pool.request().input("Id", sql.Int, id).input("U", sql.Int, req.user?.userId || null).input("T", sql.Date, target).query(`
      UPDATE dbo.LegalLand SET VerificationStatus = N'Verified', WorkflowStatus = N'Deed Process', DeedTargetDate = @T,
             L1Status = N'Pending', L1ReviewerId = NULL, L1ReviewedAt = NULL, L1Remarks = NULL,
             L2Status = N'Pending', L2ApproverId = NULL, L2ApprovedAt = NULL, L2Remarks = NULL,
             FinalVerifiedBy = @U, FinalVerifiedAt = SYSUTCDATETIME(), UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME()
      WHERE LandId = @Id`);
    await writeAudit(pool, req, { action: "Land verified — sent to Deed Process", entityType: "Land Property", entityId: id, landId: id, newValue: { targetDate: target } });
    res.json({ message: `${l.LandCode} verified and sent to Deed Process` });
  } catch (err) {
    console.error("[legal-land] final-verify:", err.message);
    res.status(500).json({ error: "Could not verify the land" });
  }
});

// GET /deed-process/list — lands sent to the deed department.
router.get("/deed-process/list", requirePageRight(LAND_PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await deedReady(pool))) return res.json({ lands: [], canEditTimeline: false });
    const copy = !!(await pool.request().query("SELECT COL_LENGTH('dbo.LegalLand', 'DeedFileId') AS c")).recordset[0].c;
    const chg = !!(await pool.request().query("SELECT COL_LENGTH('dbo.LegalLand', 'DeedChangedAt') AS c")).recordset[0].c;
    const appr = !!(await pool.request().query("SELECT COL_LENGTH('dbo.LegalLand', 'DeedApprovalStatus') AS c")).recordset[0].c;
    const r = await pool.request().query(`
      SELECT l.LandId, l.LandCode, l.LandName, l.WorkflowStatus, d.DistrictName, m.MouzaName, l.FinalVerifiedAt,
             CONVERT(char(10), l.DeedTargetDate, 23) AS DeedTargetDate, l.DeedCompletedAt,
             ISNULL(l.L1Status, N'Pending') AS L1Status, (SELECT name FROM dbo.users WHERE id = l.L1ReviewerId) AS L1By,
             ISNULL(l.L2Status, N'Pending') AS L2Status,
             ${appr ? "l.DeedApprovalNote," : ""}
             ${chg ? "l.DeedChangedAt, (SELECT name FROM dbo.users WHERE id = l.DeedChangedBy) AS DeedChangedByName," : ""}
             ${copy ? "l.DeedFileId, (SELECT FileName FROM dbo.LegalMasterFile f WHERE f.FileId = l.DeedFileId) AS DeedFileName," : ""}
             (SELECT name FROM dbo.users WHERE id = l.FinalVerifiedBy) AS VerifiedBy
      FROM dbo.LegalLand l
      LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = l.DistrictId
      LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId
      WHERE l.IsActive = 1 AND l.WorkflowStatus IN (N'Deed Process', N'Deed Completed')
      ORDER BY CASE WHEN l.WorkflowStatus = N'Deed Process' THEN 0 ELSE 1 END, l.DeedTargetDate`);
    res.json({ lands: r.recordset, canEditTimeline: await canAct(req, "Verifier", LAND_PAGE),
      canL1: await canAct(req, "L1 Approver", LAND_PAGE), canL2: await canAct(req, "L2 Approver", LAND_PAGE) });
  } catch (err) {
    console.error("[legal-land] deed-process list:", err.message);
    res.status(500).json({ error: "Could not load the Deed Process list" });
  }
});

// PUT /:id/deed-process { targetDate?, completed? } — the verifier changes the timeline; the deed department
// (land edit right) marks the deed done.
router.put("/:id/deed-process", requirePageRight(LAND_PAGE, "view"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid land id" });
  const pool = getPool();
  try {
    const l = (await pool.request().input("Id", sql.Int, id).query("SELECT LandCode, WorkflowStatus FROM dbo.LegalLand WHERE LandId = @Id AND IsActive = 1")).recordset[0];
    if (!l) return res.status(404).json({ error: "Land not found" });
    if (!IN_DEED(l.WorkflowStatus)) return res.status(409).json({ error: `${l.LandCode} is not in Deed Process` });
    if (req.body?.targetDate !== undefined) {
      const target = isoDate(req.body.targetDate);
      if (!target) return res.status(400).json({ error: "Give a valid timeline date" });
      if (!(await canAct(req, "Verifier", LAND_PAGE))) return res.status(403).json({ error: "Only a Verifier can change the timeline" });
      await pool.request().input("Id", sql.Int, id).input("T", sql.Date, target).input("U", sql.Int, req.user?.userId || null)
        .query("UPDATE dbo.LegalLand SET DeedTargetDate = @T, UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @Id");
      await writeAudit(pool, req, { action: "Deed timeline changed", entityType: "Land Property", entityId: id, landId: id, newValue: { targetDate: target } });
      return res.json({ message: "Timeline saved" });
    }
    if (req.body?.deedFileId !== undefined) {
      if (!(await hasAnyPageAction(req, LAND_PAGE, ["edit"]))) return res.status(403).json({ error: "You cannot upload the deed copy" });
      if (!(await pool.request().query("SELECT COL_LENGTH('dbo.LegalLand', 'DeedFileId') AS c")).recordset[0].c) return res.status(503).json({ error: "Deed copy is not set up yet (migration 644)" });
      const fileId = req.body.deedFileId === null ? null : idParam(req.body.deedFileId);
      if (req.body.deedFileId !== null && !fileId) return res.status(400).json({ error: "Invalid file" });
      if (fileId && !(await pool.request().input("F", sql.Int, fileId).query("SELECT 1 AS x FROM dbo.LegalMasterFile WHERE FileId = @F")).recordset[0]) return res.status(400).json({ error: "File not found" });
      await pool.request().input("Id", sql.Int, id).input("F", sql.Int, fileId).input("U", sql.Int, req.user?.userId || null)
        .query("UPDATE dbo.LegalLand SET DeedFileId = @F, UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @Id");
      await writeAudit(pool, req, { action: fileId ? "Deed copy uploaded" : "Deed copy removed", entityType: "Land Property", entityId: id, landId: id, newValue: { fileId } });
      return res.json({ message: fileId ? `${l.LandCode}: deed copy saved` : `${l.LandCode}: deed copy removed` });
    }
    if (typeof req.body?.completed === "boolean") {
      if (!(await hasAnyPageAction(req, LAND_PAGE, ["edit"]))) return res.status(403).json({ error: "You cannot update the deed status" });
      const done = req.body.completed;
      if (done) {
        const c = (await pool.request().input("Id", sql.Int, id).query(
          "IF COL_LENGTH('dbo.LegalLand', 'DeedChangedAt') IS NOT NULL EXEC sp_executesql N'SELECT DeedChangedAt AS c FROM dbo.LegalLand WHERE LandId = @I', N'@I INT', @I = @Id; ELSE SELECT NULL AS c")).recordset[0];
        if (c?.c) return res.status(409).json({ error: `${l.LandCode} was changed after verification — a verifier must re-verify it first` });
      }
      await pool.request().input("Id", sql.Int, id).input("W", sql.NVarChar(60), done ? "Deed Completed" : "Deed Process").input("U", sql.Int, req.user?.userId || null)
        .query(`UPDATE dbo.LegalLand SET WorkflowStatus = @W, DeedCompletedAt = ${done ? "SYSUTCDATETIME()" : "NULL"}, UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @Id`);
      await writeAudit(pool, req, { action: done ? "Deed completed" : "Deed reopened", entityType: "Land Property", entityId: id, landId: id });
      return res.json({ message: done ? `${l.LandCode}: deed completed` : `${l.LandCode}: back in Deed Process` });
    }
    res.status(400).json({ error: "Nothing to change" });
  } catch (err) {
    console.error("[legal-land] deed-process save:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

// POST /:id/deed-process/reverify — the verifier has checked the changes made after verification; clears the flag.
router.post("/:id/deed-process/reverify", requirePageRight(LAND_PAGE, "view"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid land id" });
  const pool = getPool();
  try {
    if (!(await pool.request().query("SELECT COL_LENGTH('dbo.LegalLand', 'DeedChangedAt') AS c")).recordset[0].c) return res.status(503).json({ error: "Re-verification is not set up yet (migration 645)" });
    if (!(await canAct(req, "Verifier", LAND_PAGE))) return res.status(403).json({ error: "Only a Verifier (Setup → Approval Control) can re-verify" });
    const l = (await pool.request().input("Id", sql.Int, id).query("SELECT LandCode, DeedChangedAt, DeedChangedBy FROM dbo.LegalLand WHERE LandId = @Id AND IsActive = 1")).recordset[0];
    if (!l) return res.status(404).json({ error: "Land not found" });
    if (!l.DeedChangedAt) return res.status(409).json({ error: "Nothing changed since verification" });
    const own = ownWork(req, l.DeedChangedBy, "these changes");
    if (own) return res.status(409).json({ error: own });
    await pool.request().input("Id", sql.Int, id).input("U", sql.Int, req.user?.userId || null).query(
      "UPDATE dbo.LegalLand SET DeedChangedAt = NULL, DeedChangedBy = NULL, DeedReverifiedAt = SYSUTCDATETIME(), DeedReverifiedBy = @U WHERE LandId = @Id");
    await writeAudit(pool, req, { action: "Deed changes re-verified", entityType: "Land Property", entityId: id, landId: id });
    res.json({ message: `${l.LandCode}: changes verified` });
  } catch (err) {
    console.error("[legal-land] reverify:", err.message);
    res.status(500).json({ error: "Could not re-verify" });
  }
});

// POST /:id/deed-process/approve { level: 1|2, action: "Approve"|"Reject"|"Hold", remarks }
// Two-level approval on the Deed Process page. L1 (L1 Approver) needs the deed copy and no unverified change;
// L2 (L2 Approver, not the L1 approver) moves the land to Deed Registration. Reject sends it back to L1;
// Hold parks it at that level (it can be approved later). Reject and Hold need a reason.
router.post("/:id/deed-process/approve", requirePageRight(LAND_PAGE, "view"), async (req, res) => {
  const id = idParam(req.params.id);
  const level = Number(req.body?.level);
  const action = req.body?.action;
  const remarks = text(req.body?.remarks, 1000);
  if (!id || ![1, 2].includes(level) || !["Approve", "Reject", "Hold"].includes(action)) return res.status(400).json({ error: "Invalid request" });
  if (!remarks) return res.status(400).json({ error: action === "Approve" ? "Write the approval remarks" : "Give the reason" });
  const pool = getPool();
  try {
    const role = level === 1 ? "L1 Approver" : "L2 Approver";
    if (!(await canAct(req, role, LAND_PAGE))) return res.status(403).json({ error: `Only an ${role} (Setup → Approval Control) can do this` });
    const cols = (await pool.request().query("SELECT COL_LENGTH('dbo.LegalLand', 'DeedFileId') AS a, COL_LENGTH('dbo.LegalLand', 'DeedChangedAt') AS b, COL_LENGTH('dbo.LegalLand', 'DeedApprovalNote') AS c")).recordset[0];
    const l = (await pool.request().input("Id", sql.Int, id).query(`
      SELECT LandCode, CreatedBy, WorkflowStatus, ISNULL(L1Status, N'Pending') AS L1Status, L1ReviewerId
             ${cols.a ? ", DeedFileId" : ""} ${cols.b ? ", DeedChangedAt" : ""}
      FROM dbo.LegalLand WHERE LandId = @Id AND IsActive = 1`)).recordset[0];
    if (!l) return res.status(404).json({ error: "Land not found" });
    if (l.WorkflowStatus !== "Deed Process") return res.status(409).json({ error: `${l.LandCode} is not in Deed Process` });
    const own = ownWork(req, l.CreatedBy, "this land");
    if (own) return res.status(409).json({ error: own });
    if (action === "Approve" && l.DeedChangedAt) return res.status(409).json({ error: `${l.LandCode} was changed after verification — a verifier must re-verify it first` });
    if (action === "Approve") {
      const stops = await require("./dueDiligence").processingBlockers(pool, id);
      if (stops.length) return res.status(409).json({ error: `Cannot approve: ${stops.join("; ")}` });
    }
    const userId = req.user?.userId || null;
    const note = cols.c ? ", DeedApprovalNote = @R" : "";
    const q = pool.request().input("Id", sql.Int, id).input("U", sql.Int, userId).input("R", sql.NVarChar(1000), remarks);
    let message;
    if (level === 1) {
      if (l.L1Status === "Approved") return res.status(409).json({ error: "L1 is already approved — waiting for L2" });
      if (action === "Approve" && cols.a && !l.DeedFileId) return res.status(409).json({ error: "Upload the deed copy before approval" });
      const st = { Approve: "Approved", Reject: "Rejected", Hold: "On Hold" }[action];
      await q.input("S", sql.NVarChar(30), st).query(
        `UPDATE dbo.LegalLand SET L1Status = @S, L1ReviewerId = @U, L1ReviewedAt = SYSUTCDATETIME(), L1Remarks = @R, L2Status = N'Pending'${note}, UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @Id`);
      message = { Approve: `${l.LandCode}: L1 approved — waiting for L2`, Reject: `${l.LandCode}: rejected at L1`, Hold: `${l.LandCode}: on hold at L1` }[action];
    } else {
      if (l.L1Status !== "Approved") return res.status(409).json({ error: "L1 approval comes before L2" });
      if (!isSuperAdmin(req) && l.L1ReviewerId != null && Number(l.L1ReviewerId) === Number(userId)) return res.status(409).json({ error: "You gave the L1 approval — another user must give L2" });
      if (action === "Approve") {
        await q.query(`UPDATE dbo.LegalLand SET L2Status = N'Approved', L2ApproverId = @U, L2ApprovedAt = SYSUTCDATETIME(), L2Remarks = @R,
                       WorkflowStatus = N'Deed Registration', UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @Id`);
        message = `${l.LandCode}: L2 approved — moved to Deed Registration`;
      } else if (action === "Hold") {
        await q.query(`UPDATE dbo.LegalLand SET L2Status = N'On Hold', L2ApproverId = @U, L2ApprovedAt = SYSUTCDATETIME(), L2Remarks = @R${note}, UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @Id`);
        message = `${l.LandCode}: on hold at L2`;
      } else {
        await q.query(`UPDATE dbo.LegalLand SET L2Status = N'Rejected', L2ApproverId = @U, L2ApprovedAt = SYSUTCDATETIME(), L2Remarks = @R,
                       L1Status = N'Pending'${note}, UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @Id`);
        message = `${l.LandCode}: rejected at L2 — back to L1`;
      }
    }
    await writeAudit(pool, req, { action: `Deed L${level} ${action === "Approve" ? "approved" : action === "Reject" ? "rejected" : "on hold"}`, entityType: "Land Property", entityId: id, landId: id, remarks });
    res.json({ message });
  } catch (err) {
    console.error("[legal-land] deed approve:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

// ── Registry search (Deed Registration page) ──────────────────────────────────────────────────────────────────────
const SEARCH_RESULTS = ["Clear — no other deed", "Deed found", "Encumbrance / charge found", "Record not found", "Mismatch in records", "Other"];
const searchReady = async (pool) => !!(await pool.request().query("SELECT OBJECT_ID('dbo.LegalRegistrySearch', 'U') AS t")).recordset[0].t;

// GET /registry-search/lookup?q= — a land by Land ID or enquiry number, with what the search needs.
router.get("/registry-search/lookup", requirePageRight(LAND_PAGE, "view"), async (req, res) => {
  const q = text(req.query.q, 60);
  if (!q) return res.status(400).json({ error: "Enter a Land ID or enquiry number" });
  try {
    const pool = getPool();
    const l = (await pool.request().input("Q", sql.NVarChar(60), q).query(`
      SELECT TOP 1 l.LandId, l.LandCode, l.LandName, e.EnquiryNo, l.DistrictId, d.DistrictName, m.MouzaName, m.JLNo, l.WorkflowStatus,
             l.RsDagNo, l.RsKhatianNo, l.LrDagNo, l.LrKhatianNo, CAST(l.Area AS FLOAT) AS Area, u.UnitName, l.LocationAddress,
             (SELECT STRING_AGG(o.OwnerName, N', ') FROM dbo.LegalOwnershipRecord o WHERE o.LandId = l.LandId AND o.IsActive = 1 AND o.ValidTo IS NULL) AS Owners
      FROM dbo.LegalLand l
      LEFT JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = l.EnquiryId
      LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = l.DistrictId
      LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId
      LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = l.AreaUnitId
      WHERE l.IsActive = 1 AND (l.LandCode = @Q OR e.EnquiryNo = @Q)`)).recordset[0];
    if (!l) return res.status(404).json({ error: `No land found for "${q}". An enquiry must be converted to a land first.` });
    // Every RS / LR record of the land (a land can have several plots).
    const recs = (await pool.request().input("Id", sql.Int, l.LandId).query(`
      SELECT N'RS' AS Kind, RsDagNo AS Dag, RsKhatianNo AS Khatian FROM dbo.LegalLandRsRecord WHERE LandId = @Id AND IsActive = 1
      UNION ALL SELECT N'LR', LrDagNo, LrKhatianNo FROM dbo.LegalLandLrRecord WHERE LandId = @Id AND IsActive = 1`)).recordset;
    res.json({ land: l, records: recs, results: SEARCH_RESULTS });
  } catch (err) {
    console.error("[legal-land] registry lookup:", err.message);
    res.status(500).json({ error: "Could not find the land" });
  }
});

// GET /:id/registry-search — saved searches of a land.
router.get("/:id/registry-search", requirePageRight(LAND_PAGE, "view"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid land id" });
  try {
    const pool = getPool();
    if (!(await searchReady(pool))) return res.json([]);
    const evid = !!(await pool.request().query("SELECT COL_LENGTH('dbo.LegalRegistrySearch', 'SourceUrl') AS c")).recordset[0].c;
    const r = await pool.request().input("Id", sql.Int, id).query(`
      SELECT s.SearchId, s.FinYear, o.OfficeName, ${evid ? "s.SourceUrl, s.CheckedAt, s.MatchResult," : ""} s.RsDagNo, s.RsKhatianNo, s.LrDagNo, s.LrKhatianNo, s.SiteName, s.Result, s.DeedNoFound, s.Details,
             s.FileId, (SELECT FileName FROM dbo.LegalMasterFile f WHERE f.FileId = s.FileId) AS FileName, s.CreatedAt,
             (SELECT name FROM dbo.users WHERE id = s.CreatedBy) AS CreatedByName
      FROM dbo.LegalRegistrySearch s LEFT JOIN dbo.LegalRegistrationOffice o ON o.OfficeId = s.OfficeId
      WHERE s.LandId = @Id ORDER BY s.CreatedAt DESC`);
    res.json(r.recordset);
  } catch (err) {
    console.error("[legal-land] registry list:", err.message);
    res.status(500).json({ error: "Could not load the searches" });
  }
});

// POST /:id/registry-search — store what was found on the government site.
router.post("/:id/registry-search", requirePageRight(LAND_PAGE, "edit"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid land id" });
  const b = req.body || {};
  const result = SEARCH_RESULTS.includes(b.result) ? b.result : null;
  if (!result) return res.status(400).json({ error: "Choose what was found" });
  const officeId = b.officeId ? idParam(b.officeId) : null;
  if (!officeId) return res.status(400).json({ error: "Choose the registration office" });
  const fy = text(b.finYear, 20);
  if (!fy || !/^\d{4}-\d{2}$/.test(fy)) return res.status(400).json({ error: "Choose the financial year" });
  if (result !== "Clear — no other deed" && result !== "Record not found" && !text(b.details, 2000)) return res.status(400).json({ error: "Write the details found" });
  const pool = getPool();
  try {
    if (!(await searchReady(pool))) return res.status(503).json({ error: "Registry search is not set up yet (migration 647)" });
    const evid = !!(await pool.request().query("SELECT COL_LENGTH('dbo.LegalRegistrySearch', 'SourceUrl') AS c")).recordset[0].c;
    if (!(await pool.request().input("O", sql.Int, officeId).query("SELECT 1 AS x FROM dbo.LegalRegistrationOffice WHERE OfficeId = @O")).recordset[0]) return res.status(400).json({ error: "Registration office not found" });
    // The same search (office, year, RS / LR numbers) with the same result is not saved twice — edit the saved one instead.
    const dup = (await pool.request().input("Id", sql.Int, id).input("O", sql.Int, officeId).input("Fy", sql.NVarChar(20), fy).input("Res", sql.NVarChar(40), result)
      .input("RsD", sql.NVarChar(30), text(b.rsDagNo, 30)).input("RsK", sql.NVarChar(30), text(b.rsKhatianNo, 30))
      .input("LrD", sql.NVarChar(30), text(b.lrDagNo, 30)).input("LrK", sql.NVarChar(30), text(b.lrKhatianNo, 30)).query(`
        SELECT TOP 1 SearchId FROM dbo.LegalRegistrySearch WHERE LandId = @Id AND OfficeId = @O AND FinYear = @Fy AND Result = @Res
          AND ISNULL(RsDagNo, '') = ISNULL(@RsD, '') AND ISNULL(RsKhatianNo, '') = ISNULL(@RsK, '')
          AND ISNULL(LrDagNo, '') = ISNULL(@LrD, '') AND ISNULL(LrKhatianNo, '') = ISNULL(@LrK, '')`)).recordset[0];
    if (dup) return res.status(409).json({ error: "This search is already saved with the same result — edit the saved one instead" });
    const r = await pool.request().input("Id", sql.Int, id).input("O", sql.Int, officeId).input("Fy", sql.NVarChar(20), fy)
      .input("RsD", sql.NVarChar(30), text(b.rsDagNo, 30)).input("RsK", sql.NVarChar(30), text(b.rsKhatianNo, 30))
      .input("LrD", sql.NVarChar(30), text(b.lrDagNo, 30)).input("LrK", sql.NVarChar(30), text(b.lrKhatianNo, 30))
      .input("Site", sql.NVarChar(200), text(b.siteName, 200)).input("Res", sql.NVarChar(40), result)
      .input("Deed", sql.NVarChar(100), text(b.deedNoFound, 100)).input("Det", sql.NVarChar(2000), text(b.details, 2000))
      .input("File", sql.Int, b.fileId ? idParam(b.fileId) : null).input("U", sql.Int, req.user?.userId || null)
      .input("Url", sql.NVarChar(500), /^https?:\/\//i.test(String(b.sourceUrl || "")) ? text(b.sourceUrl, 500) : null)
      .input("Match", sql.NVarChar(40), ["Matches our records", "Partly matches", "Does not match"].includes(b.matchResult) ? b.matchResult : null).query(`
        INSERT INTO dbo.LegalRegistrySearch (LandId, OfficeId, FinYear, RsDagNo, RsKhatianNo, LrDagNo, LrKhatianNo, SiteName, Result, DeedNoFound, Details, FileId, CreatedBy
          ${evid ? ", SourceUrl, CheckedAt, MatchResult" : ""})
        OUTPUT INSERTED.SearchId
        SELECT @Id, @O, @Fy, @RsD, @RsK, @LrD, @LrK, @Site, @Res, @Deed, @Det, @File, @U ${evid ? ", @Url, SYSUTCDATETIME(), @Match" : ""} WHERE EXISTS (SELECT 1 FROM dbo.LegalLand WHERE LandId = @Id AND IsActive = 1)`);
    if (!r.recordset.length) return res.status(404).json({ error: "Land not found" });
    await writeAudit(pool, req, { action: "Registry search recorded", entityType: "Land Property", entityId: id, landId: id, newValue: { result, finYear: fy } });
    res.status(201).json({ message: "Search result saved" });
  } catch (err) {
    console.error("[legal-land] registry save:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

// POST /:id/deed-registration { action: "apply" } — an approver (L1 / L2 Approver) applies for registration; who and
// when are kept and the days open are counted from then. { action: "submit", fileId } — after registration, the
// registered deed copy is uploaded and submitted: the land becomes "Registered" and shows in Land & Projects.
router.post("/:id/deed-registration", requirePageRight(LAND_PAGE, "view"), async (req, res) => {
  const id = idParam(req.params.id);
  const action = req.body?.action;
  if (!id || !["apply", "submit"].includes(action)) return res.status(400).json({ error: "Invalid request" });
  const pool = getPool();
  try {
    if (!(await pool.request().query("SELECT COL_LENGTH('dbo.LegalLand', 'RegAppliedAt') AS c")).recordset[0].c) return res.status(503).json({ error: "Deed registration is not set up yet (migration 648)" });
    if (!(await canAct(req, "L1 Approver", LAND_PAGE)) && !(await canAct(req, "L2 Approver", LAND_PAGE))) return res.status(403).json({ error: "Only an approver (Setup → Approval Control) can do this" });
    const l = (await pool.request().input("Id", sql.Int, id).query("SELECT LandCode, WorkflowStatus, RegAppliedAt FROM dbo.LegalLand WHERE LandId = @Id AND IsActive = 1")).recordset[0];
    if (!l) return res.status(404).json({ error: "Land not found" });
    if (l.WorkflowStatus !== "Deed Registration") return res.status(409).json({ error: `${l.LandCode} is not waiting for deed registration` });
    const userId = req.user?.userId || null;
    if (action === "apply") {
      if (l.RegAppliedAt) return res.status(409).json({ error: `${l.LandCode} is already applied for registration` });
      await pool.request().input("Id", sql.Int, id).input("U", sql.Int, userId).query(
        "UPDATE dbo.LegalLand SET RegAppliedBy = @U, RegAppliedAt = SYSUTCDATETIME(), UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @Id");
      await writeAudit(pool, req, { action: "Applied for deed registration", entityType: "Land Property", entityId: id, landId: id });
      return res.json({ message: `${l.LandCode}: applied for deed registration` });
    }
    if (!l.RegAppliedAt) return res.status(409).json({ error: "Apply for registration first" });
    // Final Registration (date, office, mode) comes before the registered deed is uploaded (migration 659).
    if ((await pool.request().query("SELECT COL_LENGTH('dbo.LegalLand', 'RegFinalDate') AS c")).recordset[0].c) {
      const f = (await pool.request().input("Id", sql.Int, id).query("SELECT RegFinalDate, RegOfficeId, RegModeId FROM dbo.LegalLand WHERE LandId = @Id")).recordset[0];
      if (!f.RegFinalDate || !f.RegOfficeId || !f.RegModeId) return res.status(409).json({ error: "Fill Final Registration (date, office, mode) before submitting the registered deed" });
      // The consideration must be fully paid (migration 664: payments are the land's Payment History).
      if ((await pool.request().query("SELECT OBJECT_ID('dbo.LegalPaymentSchedule','U') AS t")).recordset[0].t) {
        const pay = (await pool.request().input("Id", sql.Int, id).query(`SELECT l.ConsTotalAmount AS Total,
            ISNULL((SELECT SUM(CASE WHEN tt.Name = N'Refund' THEN -p.Amount WHEN tt.Name IN (N'Sale Receipt', N'Expense') THEN 0 ELSE p.Amount END) FROM dbo.LegalPayment p
              LEFT JOIN dbo.LegalLookupValue tt ON tt.LookupId = p.TxnTypeId WHERE p.LandId = l.LandId AND p.IsActive = 1), 0) AS Paid
          FROM dbo.LegalLand l WHERE l.LandId = @Id`)).recordset[0];
        if (pay.Total == null || Number(pay.Paid) + 0.001 < Number(pay.Total)) return res.status(409).json({ error: "The consideration is not fully paid yet" });
      }
    }
    const fileId = idParam(req.body?.fileId);
    if (!fileId) return res.status(400).json({ error: "Upload the registered deed copy" });
    if (!(await pool.request().input("F", sql.Int, fileId).query("SELECT 1 AS x FROM dbo.LegalMasterFile WHERE FileId = @F")).recordset[0]) return res.status(400).json({ error: "File not found" });
    await pool.request().input("Id", sql.Int, id).input("U", sql.Int, userId).input("F", sql.Int, fileId).query(`
      UPDATE dbo.LegalLand SET RegDeedFileId = @F, RegCompletedBy = @U, RegCompletedAt = SYSUTCDATETIME(), WorkflowStatus = N'Registered',
             UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @Id`);
    await writeAudit(pool, req, { action: "Deed registered", entityType: "Land Property", entityId: id, landId: id, newValue: { fileId }, documentRef: `File ${fileId}` });
    await recordCompanyTransfer(pool, req, id, fileId);
    await createPostRegTasks(pool, req, id);
    res.json({ message: `${l.LandCode}: deed registered — now in Land & Projects` });
  } catch (err) {
    console.error("[legal-land] deed registration:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

// PUT /registry-search/:searchId { result, deedNoFound, details, siteName } — correct a saved search.
// DELETE /registry-search/:searchId — remove a wrong entry. Both need the land edit right.
router.put("/registry-search/:searchId", requirePageRight(LAND_PAGE, "edit"), async (req, res) => {
  const sid = idParam(req.params.searchId);
  const b = req.body || {};
  const result = SEARCH_RESULTS.includes(b.result) ? b.result : null;
  if (!sid || !result) return res.status(400).json({ error: "Choose what was found" });
  if (result !== "Clear — no other deed" && result !== "Record not found" && !text(b.details, 2000)) return res.status(400).json({ error: "Write the details found" });
  try {
    const pool = getPool();
    const r = await pool.request().input("S", sql.Int, sid).input("Res", sql.NVarChar(40), result).input("Deed", sql.NVarChar(100), text(b.deedNoFound, 100))
      .input("Det", sql.NVarChar(2000), text(b.details, 2000)).input("Site", sql.NVarChar(200), text(b.siteName, 200)).query(`
        UPDATE dbo.LegalRegistrySearch SET Result = @Res, DeedNoFound = @Deed, Details = @Det, SiteName = @Site
        OUTPUT DELETED.Result AS oldResult, INSERTED.LandId WHERE SearchId = @S`);
    if (!r.recordset.length) return res.status(404).json({ error: "Search not found" });
    await writeAudit(pool, req, { action: "Registry search edited", entityType: "Land Property", entityId: r.recordset[0].LandId, landId: r.recordset[0].LandId, oldValue: { result: r.recordset[0].oldResult }, newValue: { result } });
    res.json({ message: "Search updated" });
  } catch (err) {
    console.error("[legal-land] registry edit:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

router.delete("/registry-search/:searchId", requirePageRight(LAND_PAGE, "edit"), async (req, res) => {
  const sid = idParam(req.params.searchId);
  if (!sid) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const r = await pool.request().input("S", sql.Int, sid).query("DELETE FROM dbo.LegalRegistrySearch OUTPUT DELETED.LandId, DELETED.Result, DELETED.FinYear WHERE SearchId = @S");
    if (!r.recordset.length) return res.status(404).json({ error: "Search not found" });
    const d = r.recordset[0];
    await writeAudit(pool, req, { action: "Registry search deleted", entityType: "Land Property", entityId: d.LandId, landId: d.LandId, oldValue: { result: d.Result, finYear: d.FinYear } });
    res.json({ message: "Search deleted" });
  } catch (err) {
    console.error("[legal-land] registry delete:", err.message);
    res.status(500).json({ error: "Could not delete" });
  }
});

// ── Post-registration compliance (after Deed Registration → Submit) ───────────────────────────────────────────────
const POST_REG_TASKS = ["Registered deed verification", "Mutation application", "Updated Khatian / RoR", "Updated land records",
  "Land tax / revenue update", "Ownership record update", "Project mapping eligibility"];
const POST_REG_STATUS = ["Not Started", "Application Submitted", "Under Processing", "Additional Documents Required", "Completed", "Rejected"];
const postRegReady = async (pool) => !!(await pool.request().query("SELECT OBJECT_ID('dbo.LegalPostRegTask', 'U') AS t")).recordset[0].t;

/**
 * The company's own acquisition, written into the land's ownership chain when the registered deed is submitted (New
 * Acquisition land only): a Sale transfer from the current owners to the company (deed no., office, date, value from
 * Deed Registration), the current owners' records closed on that date, and the company recorded as owner (100%).
 * Nothing is typed again; Post-Registration's "Ownership record update" task is where it is checked.
 */
async function recordCompanyTransfer(pool, req, landId, fileId) {
  const l = (await pool.request().input("Id", sql.Int, landId).query(`
    SELECT l.EntryType, l.Area, l.AreaUnitId, l.ConsTotalAmount, l.RegDeedNo, l.RegOfficeId,
           CONVERT(char(10), ISNULL(l.RegFinalDate, CAST(GETDATE() AS DATE)), 23) AS RegDate,
           COALESCE((SELECT c.name FROM dbo.enterprise c WHERE c.id = p.company_id), (SELECT c.name FROM dbo.enterprise c WHERE c.id = p.belongs_to), N'Company') AS Company,
           (SELECT STRING_AGG(o.OwnerName, N', ') FROM dbo.LegalOwnershipRecord o WHERE o.LandId = l.LandId AND o.IsActive = 1 AND o.ValidTo IS NULL) AS Sellers
    FROM dbo.LegalLand l LEFT JOIN dbo.enterprise p ON p.id = l.ProjectId WHERE l.LandId = @Id`)).recordset[0];
  if (!l || l.EntryType !== "New Acquisition") return;
  const has = (await pool.request().input("Id", sql.Int, landId).input("N", sql.NVarChar(200), l.Company)
    .query("SELECT 1 AS x FROM dbo.LegalOwnershipRecord WHERE LandId = @Id AND OwnerName = @N AND IsActive = 1 AND ValidTo IS NULL")).recordset[0];
  if (has) return;
  const userId = req.user?.userId || null;
  const ev = (await pool.request().input("Id", sql.Int, landId).input("D", sql.Date, l.RegDate).input("From", sql.NVarChar(200), (l.Sellers || "").slice(0, 200) || null)
    .input("To", sql.NVarChar(200), l.Company).input("Deed", sql.NVarChar(60), l.RegDeedNo).input("Off", sql.Int, l.RegOfficeId)
    .input("Area", sql.Decimal(18, 6), l.Area).input("Unit", sql.Int, l.AreaUnitId).input("Val", sql.Decimal(18, 2), l.ConsTotalAmount).input("F", sql.Int, fileId).input("U", sql.Int, userId)
    .query(`INSERT INTO dbo.LegalOwnershipEvent (LandId, TransferTypeId, EventDate, PreviousOwnerName, NewOwnerName, DeedNo, RegistrationOfficeId, RegistrationDate,
        TransferArea, AreaUnitId, TransferSharePct, TransferValue, DocFileId, Remarks, IsActive, CreatedBy)
      OUTPUT INSERTED.EventId
      VALUES (@Id, (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'transfer-type' AND Name = N'Sale'), @D, @From, @To, @Deed, @Off, @D,
        @Area, @Unit, 100, @Val, @F, N'Company purchase — added at deed registration', 1, @U)`)).recordset[0];
  await pool.request().input("Id", sql.Int, landId).input("D", sql.Date, l.RegDate).input("N", sql.NVarChar(200), l.Company).input("E", sql.Int, ev.EventId).input("U", sql.Int, userId)
    .query(`UPDATE dbo.LegalOwnershipRecord SET ValidTo = @D, UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @Id AND IsActive = 1 AND ValidTo IS NULL;
      INSERT INTO dbo.LegalOwnershipRecord (LandId, OwnerName, OwnershipTypeId, SharePct, ValidFrom, EventId, IsActive, CreatedBy)
      VALUES (@Id, @N, (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'ownership-type' AND Name = N'Company'), 100, @D, @E, 1, @U);`);
  await writeAudit(pool, req, { action: "Company acquisition recorded in ownership chain", entityType: "Land Property", entityId: landId, landId, newValue: { company: l.Company, from: l.Sellers, date: l.RegDate } });
}

async function createPostRegTasks(pool, req, landId) {
  if (!(await postRegReady(pool))) return;
  for (const [i, t] of POST_REG_TASKS.entries()) {
    await pool.request().input("Id", sql.Int, landId).input("No", sql.Int, i + 1).input("T", sql.NVarChar(100), t).query(
      "IF NOT EXISTS (SELECT 1 FROM dbo.LegalPostRegTask WHERE LandId = @Id AND Task = @T) INSERT INTO dbo.LegalPostRegTask (LandId, TaskNo, Task) VALUES (@Id, @No, @T)");
  }
  await writeAudit(pool, req, { action: "Post-registration tasks created", entityType: "Land Property", entityId: landId, landId });
}

// GET /post-registration/list — registered lands with their compliance tasks.
router.get("/post-registration/list", requirePageRight(LAND_PAGE, "view"), async (_req, res) => {
  try {
    const pool = getPool();
    if (!(await postRegReady(pool))) return res.json({ lands: [], statuses: POST_REG_STATUS });
    // Lands registered before this feature get their tasks the first time the list is opened.
    const missing = (await pool.request().query(
      "SELECT l.LandId FROM dbo.LegalLand l WHERE l.IsActive = 1 AND l.WorkflowStatus = N'Registered' AND NOT EXISTS (SELECT 1 FROM dbo.LegalPostRegTask t WHERE t.LandId = l.LandId)")).recordset;
    for (const m of missing) await createPostRegTasks(pool, { user: { userId: null }, ip: "" }, m.LandId);
    const lands = (await pool.request().query(`
      SELECT l.LandId, l.LandCode, l.LandName, d.DistrictName, m.MouzaName, l.RegCompletedAt, l.RegDeedFileId,
             (SELECT FileName FROM dbo.LegalMasterFile f WHERE f.FileId = l.RegDeedFileId) AS RegDeedFileName
      FROM dbo.LegalLand l LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = l.DistrictId LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId
      WHERE l.IsActive = 1 AND l.WorkflowStatus = N'Registered' ORDER BY l.RegCompletedAt DESC`)).recordset;
    const tasks = (await pool.request().query(`
      SELECT t.TaskId, t.LandId, t.TaskNo, t.Task, t.Status, t.RefNo, CONVERT(char(10), t.DueDate, 23) AS DueDate, t.Remarks, t.FileId,
             (SELECT FileName FROM dbo.LegalMasterFile f WHERE f.FileId = t.FileId) AS FileName, t.UpdatedAt, (SELECT name FROM dbo.users WHERE id = t.UpdatedBy) AS UpdatedByName
      FROM dbo.LegalPostRegTask t JOIN dbo.LegalLand l ON l.LandId = t.LandId AND l.WorkflowStatus = N'Registered' ORDER BY t.LandId, t.TaskNo`)).recordset;
    res.json({ lands: lands.map((l) => ({ ...l, tasks: tasks.filter((t) => t.LandId === l.LandId) })), statuses: POST_REG_STATUS });
  } catch (err) {
    console.error("[legal-land] post-reg list:", err.message);
    res.status(500).json({ error: "Could not load post-registration tasks" });
  }
});

// PUT /post-registration/task/:taskId { status, refNo, dueDate, remarks, fileId }
router.put("/post-registration/task/:taskId", requirePageRight(LAND_PAGE, "edit"), async (req, res) => {
  const tid = idParam(req.params.taskId);
  const b = req.body || {};
  if (!tid || !POST_REG_STATUS.includes(b.status)) return res.status(400).json({ error: "Choose the status" });
  if (["Additional Documents Required", "Rejected"].includes(b.status) && !text(b.remarks, 1000)) return res.status(400).json({ error: "Write the remarks" });
  try {
    const pool = getPool();
    const r = await pool.request().input("T", sql.Int, tid).input("S", sql.NVarChar(40), b.status).input("Ref", sql.NVarChar(100), text(b.refNo, 100))
      .input("Due", sql.Date, /^\d{4}-\d{2}-\d{2}$/.test(String(b.dueDate || "")) ? b.dueDate : null).input("R", sql.NVarChar(1000), text(b.remarks, 1000))
      .input("F", sql.Int, b.fileId ? idParam(b.fileId) : null).input("U", sql.Int, req.user?.userId || null).query(`
        UPDATE dbo.LegalPostRegTask SET Status = @S, RefNo = @Ref, DueDate = @Due, Remarks = @R, FileId = ISNULL(@F, FileId), UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME()
        OUTPUT DELETED.Status AS prev, INSERTED.LandId, INSERTED.Task WHERE TaskId = @T`);
    if (!r.recordset.length) return res.status(404).json({ error: "Task not found" });
    const t = r.recordset[0];
    await writeAudit(pool, req, { action: "Post-registration task updated", entityType: "Land Property", entityId: t.LandId, landId: t.LandId,
      oldValue: { task: t.Task, status: t.prev }, newValue: { task: t.Task, status: b.status }, remarks: text(b.remarks, 1000), documentRef: b.fileId ? `File ${b.fileId}` : null });
    res.json({ message: `${t.Task}: ${b.status}` });
  } catch (err) {
    console.error("[legal-land] post-reg task:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

module.exports = router;
module.exports.recordCompanyTransfer = recordCompanyTransfer;
