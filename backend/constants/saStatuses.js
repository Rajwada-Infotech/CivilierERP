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

// The statuses a lead must have reached before it's qualified enough for
// SA -> CRM handoff (used by saHandoff.js's convertLead).
const QUALIFIED_FOR_CONVERSION = ["Visited", "Booking"];

module.exports = { STATUS_TRANSITIONS, QUALIFIED_FOR_CONVERSION };
