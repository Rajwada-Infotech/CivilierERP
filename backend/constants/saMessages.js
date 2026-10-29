// The texts Sales Automation sends through the Communicator providers (Admin → Integrations).
// One place for every automatic SA message, so wording changes here only.

const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "there";
const visitDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "the agreed date");
const visitWhen = (v) => `${visitDate(v.PreferredDate)}${v.PreferredTime ? ` at ${v.PreferredTime}` : ""}`;
const visitPlace = (v) => (v.ProjectName ? ` to ${v.ProjectName}` : "");

module.exports = {
  // To the customer, when their enquiry is recorded.
  leadWelcome: (lead) => ({
    subject: "Thank you for your enquiry",
    text: `Dear ${firstName(lead.CustomerName)}, thank you for your enquiry. Our sales team will contact you shortly.`,
  }),

  // To the customer, when a site visit is booked.
  siteVisitBooked: (lead, v) => ({
    subject: "Your site visit is booked",
    text: `Dear ${firstName(lead.CustomerName)}, your site visit${visitPlace(v)} is booked for ${visitWhen(v)}.${v.PickupRequired ? " We will arrange your pickup." : ""} We look forward to meeting you.`,
  }),

  // To the customer, the day before the visit.
  siteVisitReminder: (lead, v) => ({
    subject: "Reminder: your site visit is tomorrow",
    text: `Dear ${firstName(lead.CustomerName)}, a reminder that your site visit${visitPlace(v)} is tomorrow, ${visitWhen(v)}. See you there.`,
  }),

  // To the salesperson / team lead a lead was just given to.
  leadAssigned: (lead) => ({
    subject: `Lead assigned to you — ${lead.CustomerName || lead.LeadUid}`,
    text: `Lead ${lead.LeadUid} (${lead.CustomerName || "no name"}, ${lead.Mobile || "no mobile"}) has been assigned to you in CivilierERP. Please follow up.`,
  }),
};
