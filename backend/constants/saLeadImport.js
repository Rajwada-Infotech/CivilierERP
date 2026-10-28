// Bulk lead import (Sales Automation → Leads → Import): the lead fields a file's columns can fill,
// and the column headings each one is recognised by. Headings are compared lowercased with
// spaces, dashes, dots and underscores removed — "Phone Number", "phone_number" and
// "PHONE-NUMBER" are the same. Covers Meta Leads Center, Google Ads lead forms, LinkedIn,
// the property portals and hand-made sheets.

const IMPORT_FIELDS = [
  { key: "CustomerName", label: "Name", required: false, headings: ["full_name", "fullname", "name", "customer name", "customer", "lead name", "contact name", "first_name"] },
  { key: "Mobile", label: "Mobile", required: true, headings: ["phone_number", "phone", "mobile", "mobile number", "mobile no", "contact number", "contact no", "phone no", "cell", "whatsapp", "user_phone"] },
  { key: "AltMobile", label: "Other mobile", required: false, headings: ["alternate number", "alt mobile", "alternate mobile", "secondary phone", "other phone"] },
  { key: "Email", label: "Email", required: false, headings: ["email", "email address", "e-mail", "email id", "mail", "user_email"] },
  { key: "CustomerRemarks", label: "Remarks", required: false, headings: ["remarks", "comments", "comment", "message", "notes", "requirement", "query", "description"] },
  { key: "PreferredLocation", label: "Preferred location", required: false, headings: ["city", "location", "preferred location", "locality", "area"] },
  { key: "BhkPreference", label: "BHK", required: false, headings: ["bhk", "configuration", "unit type", "bedrooms"] },
  { key: "PropertyType", label: "Property type", required: false, headings: ["property type", "property", "project type"] },
  { key: "BudgetMin", label: "Budget from", required: false, headings: ["budget", "budget min", "min budget", "budget from"] },
  { key: "BudgetMax", label: "Budget to", required: false, headings: ["budget max", "max budget", "budget to"] },
  { key: "ExternalLeadId", label: "Lead ID (theirs)", required: false, headings: ["id", "lead id", "leadid", "lead_id", "enquiry id"] },
  { key: "CapturedAt", label: "Received on", required: false, headings: ["created_time", "created time", "date", "lead date", "enquiry date", "submitted on", "timestamp"] },
  { key: "LeadFormName", label: "Form name", required: false, headings: ["form_name", "form name", "form"] },
  { key: "SourceCampaignName", label: "Campaign name (theirs)", required: false, headings: ["campaign_name", "campaign name", "campaign"] },
  { key: "SourceAdName", label: "Ad name (theirs)", required: false, headings: ["ad_name", "ad name", "ad"] },
  { key: "SourcePlacement", label: "Placement / platform", required: false, headings: ["platform", "placement", "source"] },
];

// Rows per request — the page sends a big file in parts of this size.
const IMPORT_BATCH = 500;

const headingKey = (h) => String(h || "").toLowerCase().replace(/[\s\-_.]/g, "");

module.exports = { IMPORT_FIELDS, IMPORT_BATCH, headingKey };
