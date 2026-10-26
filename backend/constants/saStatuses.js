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
  Visited: ["Visited", "FollowUp", "Booking", "Lost"],
  Booking: ["Booking"],
  Lost: ["Lost"],
};

// The terminal "won" status. CRM writes this onto the SaLead when it creates
// the booking (crmApplications.js) — it must be SA's own value, not CRM's
// 'Booked', or the lead falls out of every SA view and transition rule.
const SA_LEAD_BOOKED = "Booking";

// The statuses a lead must have reached before it's qualified enough for
// SA -> CRM handoff (used by saHandoff.js's convertLead).
const QUALIFIED_FOR_CONVERSION = ["Visited", "Booking"];

module.exports = { STATUS_TRANSITIONS, QUALIFIED_FOR_CONVERSION, SA_LEAD_BOOKED };
