// Shared SA (Sales Automation) lead-status vocabulary. Single source of
// truth for saLeads.js's own transition enforcement and for anything else
// (e.g. saHandoff.js's convertLead) that needs to know which statuses a
// lead can move through or has qualified past — kept out of saLeads.js
// itself to avoid a circular require (saLeads.js requires saHandoff.js,
// which needs this too).

// Allowed forward transitions per status.
const STATUS_TRANSITIONS = {
  New: ["New", "Assigned", "Contacted", "Lost"],
  Assigned: ["Assigned", "Contacted", "Lost"],
  Contacted: ["Contacted", "FollowUp", "VisitScheduled", "Lost"],
  FollowUp: ["FollowUp", "VisitScheduled", "Lost"],
  VisitScheduled: ["VisitScheduled", "Visited", "Lost"],
  Visited: ["Visited", "FollowUp", "Lost"],
  Converted: ["Converted"],
  Booking: ["Booking"],
  Lost: ["Lost"],
};

// The terminal "won" status. CRM writes this onto the SaLead when it creates
// the booking (crmApplications.js) — it must be SA's own value, not CRM's
// 'Booked', or the lead falls out of every SA view and transition rule.
const SA_LEAD_BOOKED = "Booking";

// In the CRM Leads pool (CrmLeads.tsx lists ?status=Converted). Set by
// convertLead, and again when a lead's CRM booking is cancelled or deleted.
const SA_LEAD_CONVERTED = "Converted";

// The statuses a lead must have reached before it's qualified enough for
// SA -> CRM handoff (used by saHandoff.js's convertLead).
const QUALIFIED_FOR_CONVERSION = ["Visited"];

// Statuses that may move forward to `to` (excluding `to` itself). Used by
// side-effect status changes (e.g. site visits) so they follow the same
// rules as a manual edit — never pulling a lead back or reviving a Lost one.
const statusesThatCanMoveTo = (to) =>
  Object.keys(STATUS_TRANSITIONS).filter((from) => from !== to && STATUS_TRANSITIONS[from].includes(to));

// The only status a lead may have to be distributed at a level: level 1
// (to a team lead) takes New leads, level 2 (to a salesperson) takes
// Assigned ones. Shared by manual and auto distribution so neither can
// pull a lead that has moved on back to Assigned.
const distributableStatus = (level) => (level === 1 ? "New" : "Assigned");

// Leads that are finished with in SA — handed to CRM or dropped. Everything
// else is "open" and still needs someone working it.
const CLOSED_LEAD_STATUSES = [SA_LEAD_BOOKED, SA_LEAD_CONVERTED, "Lost"];
const CLOSED_LEAD_SQL = `(${CLOSED_LEAD_STATUSES.map((s) => `'${s}'`).join(", ")})`;

// Which marketing invoices count toward campaign/ad spend (and so CPL/ROI):
// everything except cancelled payments and rejected approvals. `a` is the
// table alias with its dot ("i.") or "" for an unaliased query.
const countedInvoiceSql = (a = "") =>
  `${a}PaymentStatus <> 'Cancelled' AND ${a}ApprovalStatus <> 'Rejected'`;

module.exports = { countedInvoiceSql, CLOSED_LEAD_STATUSES, CLOSED_LEAD_SQL, distributableStatus, STATUS_TRANSITIONS, QUALIFIED_FOR_CONVERSION, SA_LEAD_BOOKED, SA_LEAD_CONVERTED, statusesThatCanMoveTo };
