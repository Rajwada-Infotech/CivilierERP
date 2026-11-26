"use strict";
/**
 * Legal V2 phase 2: the detail entries of each verification activity (searches, applications, Dag mapping, owner
 * matching, deed chain, map sheets, Khajna receipts, surveys…). Every entry is one row of LegalActivityEntry whose
 * DataJson holds the fields below; the server checks each entry against this config, so the screens and the rules
 * live in one place.
 *
 * Field types: text, textarea, int, decimal, date, select (options), file (an uploaded LegalMasterFile id),
 * entry (another entry of the same activity, e.g. a deed's previous deed).
 * requireWhen: { field, values } → required when that field holds one of those values.
 */
// A negative search result means "not found in the sources searched" — never proof that no deed / case exists.
const RESULT_SEARCH = ["Found", "Not Found in Sources Searched", "Incomplete", "Records Not Available", "Pending", "Unable to Verify"];
const LEGACY = { "Not Found": "Not Found in Sources Searched", "Unable to Search": "Unable to Verify", "Pending Information": "Pending", Sale: "Purchase/Sale", Other: "Other ownership change",
  "No Record Found": "No Record Found in Sources Searched" };
const APP_STATUS = ["Not Started", "Applied", "Processing", "Report Received", "Verified"];

const ENTRY_CONFIG = {
  "ONLINE-SEARCH": {
    entry: "Search entry", plural: "Search entries",
    note: "One entry per owner, year range and registry office. Upload the handwritten search report as a scan or photo. Record only what was actually searched.",
    fields: [
      { key: "searchBy", label: "Search by", type: "select", options: ["Owner / party name", "Deed no. and year", "Registry office", "Property details", "Mouza / Dag / Khatian", "Date"], required: true },
      { key: "ownerName", label: "Owner / party searched", type: "text", max: 200, requireWhen: { field: "searchBy", values: ["Owner / party name"] } },
      { key: "fromYear", label: "From year", type: "int", min: 1900, max: 2100 },
      { key: "toYear", label: "To year", type: "int", min: 1900, max: 2100 },
      { key: "office", label: "Registry office", type: "text", max: 200 },
      { key: "searchDate", label: "Search date", type: "date", required: true },
      { key: "result", label: "Result", type: "select", options: RESULT_SEARCH, required: true },
      { key: "deedNo", label: "Deed no.", type: "text", max: 60, requireWhen: { field: "result", values: ["Found"] } },
      { key: "deedYear", label: "Deed year", type: "int", min: 1900, max: 2100 },
      { key: "mouza", label: "Mouza", type: "text", max: 100 },
      { key: "dag", label: "Dag", type: "text", max: 100 },
      { key: "khatian", label: "Khatian", type: "text", max: 100 },
      { key: "executant", label: "Executant", type: "text", max: 200 },
      { key: "claimant", label: "Claimant", type: "text", max: 200 },
      { key: "property", label: "Property details", type: "textarea", max: 1000 },
      { key: "remarks", label: "Employee remarks", type: "textarea", max: 1000, requireWhen: { field: "result", values: ["Incomplete", "Records Not Available", "Unable to Verify"] } },
      { key: "verifierRemarks", label: "Verification remarks", type: "textarea", max: 1000 },
      { key: "reportFileId", label: "Search result / report", type: "file" },
    ],
    columns: ["searchBy", "ownerName", "fromYear", "toYear", "office", "searchDate", "result", "deedNo"],
    period: true,
  },
  "COURT-SEARCH": {
    entry: "Court search", plural: "Court searches",
    note: "One entry per court searched, and one per case found. \"No Record Found in Sources Searched\" means none in the courts and records searched — it is never proof that no litigation exists.",
    fields: [
      { key: "court", label: "Court", type: "text", required: true, max: 200 },
      { key: "courtLocation", label: "Court location", type: "text", max: 200 },
      { key: "fromYear", label: "Period from (year)", type: "int", min: 1900, max: 2100 },
      { key: "toYear", label: "Period to (year)", type: "int", min: 1900, max: 2100 },
      { key: "searchDate", label: "Search date", type: "date", required: true },
      { key: "searchBy", label: "Searched by", type: "text", max: 150 },
      { key: "ownerName", label: "Owner / party searched", type: "text", max: 200 },
      { key: "result", label: "Result", type: "select", required: true, options: ["Case Found", "No Record Found in Sources Searched", "Search Incomplete", "Records Not Available", "Pending", "Unable to Verify", "Further Investigation Required"] },
      { key: "caseNo", label: "Case no.", type: "text", max: 100, requireWhen: { field: "result", values: ["Case Found"] } },
      { key: "caseYear", label: "Case year", type: "int", min: 1900, max: 2100 },
      { key: "caseType", label: "Case category", type: "text", max: 100 },
      { key: "plaintiff", label: "Plaintiff", type: "text", max: 300 },
      { key: "defendant", label: "Defendant", type: "text", max: 300 },
      { key: "propertyRef", label: "Property reference", type: "text", max: 200 },
      { key: "dag", label: "Dag", type: "text", max: 60 },
      { key: "caseStatus", label: "Case status", type: "select", options: ["Pending", "Disposed", "Dismissed", "Decreed", "Settled", "Appealed", "Unknown"], requireWhen: { field: "result", values: ["Case Found"] } },
      { key: "judgment", label: "Judgment / order details", type: "textarea", max: 2000 },
      { key: "remarks", label: "Findings / remarks", type: "textarea", max: 1000, requireWhen: { field: "result", values: ["Further Investigation Required", "Search Incomplete", "Records Not Available", "Unable to Verify"] } },
      { key: "verifierRemarks", label: "Verification remarks", type: "textarea", max: 1000 },
      { key: "reportFileId", label: "Search report", type: "file" },
      { key: "orderFileId", label: "Judgment / order", type: "file" },
    ],
    columns: ["court", "fromYear", "toYear", "searchDate", "result", "caseNo", "caseYear", "caseStatus"],
    period: true,
  },
  "OWNERSHIP-FLOW": {
    entry: "Ownership event", plural: "Ownership events",
    note: "One row per ownership event, 1956 to 2006, each with its document. Record shares and areas: on a partial sale the seller keeps the rest (area before − area transferred = area retained). An event is Verified only with a deed no. or a supporting document.",
    fields: [
      { key: "fromOwner", label: "Previous owner", type: "text", required: true, max: 200 },
      { key: "toOwner", label: "New owner", type: "text", required: true, max: 200 },
      { key: "transferType", label: "Event type", type: "select", required: true, options: ["Purchase/Sale", "Inheritance", "Succession", "Partition", "Gift", "Exchange", "Court Order", "Settlement", "Other ownership change"] },
      { key: "transferDate", label: "Event date", type: "date" },
      { key: "transferYear", label: "Year (if date unknown)", type: "int", min: 1800, max: 2100 },
      { key: "shareBefore", label: "Previous owner's share before", type: "text", max: 30 },
      { key: "shareAfter", label: "Previous owner's share after", type: "text", max: 30 },
      { key: "shareReceived", label: "New owner's share received", type: "text", max: 30 },
      { key: "areaBefore", label: "Area held before", type: "decimal", min: 0 },
      { key: "area", label: "Area transferred", type: "decimal", min: 0 },
      { key: "areaRetained", label: "Area retained (calculated)", type: "decimal", min: 0, derived: true },
      { key: "dag", label: "Dag(s)", type: "text", max: 200 },
      { key: "khatian", label: "Khatian(s)", type: "text", max: 200 },
      { key: "deedNo", label: "Deed / document no.", type: "text", max: 60 },
      { key: "deedYear", label: "Deed year", type: "int", min: 1800, max: 2100 },
      { key: "regOffice", label: "Registration office", type: "text", max: 200 },
      { key: "verification", label: "Verification", type: "select", required: true, options: ["Unverified", "Verified", "Missing Document", "Disputed"] },
      { key: "remarks", label: "Remarks", type: "textarea", max: 1000, requireWhen: { field: "verification", values: ["Missing Document", "Disputed"] } },
      { key: "preparedBy", label: "Prepared by", type: "text", max: 150 },
      { key: "fileId", label: "Supporting document", type: "file" },
    ],
    columns: ["fromOwner", "toOwner", "transferType", "transferDate", "transferYear", "areaBefore", "area", "areaRetained", "deedNo", "verification"],
    period: true,
    derive: (d) => {
      if (d.areaBefore != null && d.area != null) d.areaRetained = Number((d.areaBefore - d.area).toFixed(4));
      else if (d.area != null && d.areaBefore == null) d.areaRetained = null;
    },
    check: (d) => (d.areaBefore != null && d.area != null && d.area > d.areaBefore ? "Area transferred is more than the area held before"
      : d.verification === "Verified" && !d.deedNo && !d.fileId ? "An event can be Verified only with a deed no. or a supporting document"
      : d.fromOwner && d.toOwner && d.fromOwner.toLowerCase() === d.toOwner.toLowerCase() ? "Previous and new owner are the same" : null),
  },

  "LA-ULC": {
    entry: "Clearance application", plural: "Clearance applications",
    note: "LA and ULC are separate applications, each with its own status. Submitting an application is not a clearance — only a received report marked Cleared is. Record every query and the reply.",
    fields: [
      { key: "clearanceType", label: "Clearance", type: "select", required: true, options: ["LA (Land Acquisition)", "ULC (Urban Land Ceiling)", "Other"] },
      { key: "otherType", label: "Other clearance name", type: "text", max: 100, requireWhen: { field: "clearanceType", values: ["Other"] } },
      { key: "applicationNo", label: "Application no.", type: "text", max: 60 },
      { key: "applicationDate", label: "Application date", type: "date", requireWhen: { field: "status", values: ["Applied", "Processing", "Query Raised", "Additional Documents Submitted", "Report Received", "Under Review", "Cleared", "Not Cleared"] } },
      { key: "authority", label: "Authority", type: "text", max: 200 },
      { key: "office", label: "Office", type: "text", max: 200 },
      { key: "mouza", label: "Mouza", type: "text", max: 100 },
      { key: "dag", label: "Dag", type: "text", max: 100 },
      { key: "khatian", label: "Khatian", type: "text", max: 100 },
      { key: "area", label: "Land area", type: "decimal", min: 0 },
      { key: "fee", label: "Fee (₹)", type: "decimal", min: 0 },
      { key: "paymentRef", label: "Payment reference", type: "text", max: 100 },
      { key: "ackDate", label: "Acknowledgement date", type: "date" },
      { key: "hearingDate", label: "Hearing date", type: "date" },
      { key: "expectedDate", label: "Expected completion (government process, not guaranteed)", type: "date" },
      { key: "status", label: "Status", type: "select", required: true, options: ["Not Started", "Applied", "Processing", "Query Raised", "Additional Documents Submitted", "Report Received", "Under Review", "Cleared", "Not Cleared"] },
      { key: "queryDetails", label: "Query and response history (date · query · response)", type: "textarea", max: 3000, requireWhen: { field: "status", values: ["Query Raised", "Additional Documents Submitted"] } },
      { key: "reportDate", label: "Report received on", type: "date", requireWhen: { field: "status", values: ["Report Received", "Under Review", "Cleared", "Not Cleared"] } },
      { key: "remarks", label: "Verifier remarks", type: "textarea", max: 1000, requireWhen: { field: "status", values: ["Not Cleared"] } },
      { key: "applicationFileId", label: "Application copy", type: "file" },
      { key: "reportFileId", label: "Report / certificate", type: "file" },
    ],
    columns: ["clearanceType", "applicationNo", "applicationDate", "authority", "expectedDate", "reportDate", "status"],
  },
  "LEGAL-HEIR": {
    entry: "Legal heir", plural: "Legal heirs",
    note: "One row per heir of a deceased owner. A heir is Verified only with a death certificate and a succession document or Farznama. Where succession does not apply, request N/A with a reason for authorised approval.",
    fields: [
      { key: "deceasedOwner", label: "Deceased owner", type: "text", required: true, max: 200 },
      { key: "deathDate", label: "Date of death", type: "date" },
      { key: "deathCertFileId", label: "Death certificate", type: "file" },
      { key: "heirName", label: "Legal heir", type: "text", required: true, max: 200 },
      { key: "relationship", label: "Relationship", type: "text", max: 60 },
      { key: "share", label: "Ownership share", type: "text", max: 30 },
      { key: "successionDoc", label: "Succession document", type: "text", max: 200 },
      { key: "successionFileId", label: "Succession copy", type: "file" },
      { key: "farznamaFileId", label: "Farznama / partition document", type: "file" },
      { key: "supportingDeed", label: "Supporting deed", type: "text", max: 100 },
      { key: "ownershipEvent", label: "Ownership event (flowchart) it supports", type: "text", max: 200 },
      { key: "commissionCheck", label: "Legal commission check", type: "select", options: ["Not Required", "Pending", "Done", "Issue Found"] },
      { key: "verification", label: "Verification", type: "select", required: true, options: ["Unverified", "Verified", "Missing Document", "Disputed"] },
      { key: "remarks", label: "Remarks", type: "textarea", max: 1000, requireWhen: { field: "verification", values: ["Missing Document", "Disputed"] } },
    ],
    columns: ["deceasedOwner", "deathDate", "heirName", "relationship", "share", "verification"],
    check: (d) => (d.verification === "Verified" && (!d.deathCertFileId || !(d.successionFileId || d.farznamaFileId))
      ? "A heir is Verified only with the death certificate and a succession document or Farznama uploaded" : null),
  },
  "MUTATION-CONVERSION": {
    entry: "Application", plural: "Mutation and conversion",
    note: "Mutation and conversion are separate applications, each with its own dates, documents and status.",
    fields: [
      { key: "recordType", label: "Type", type: "select", required: true, options: ["Mutation", "Conversion"] },
      { key: "applicationNo", label: "Application no.", type: "text", max: 60 },
      { key: "applicationDate", label: "Application date", type: "date" },
      { key: "office", label: "Office / authority", type: "text", max: 200 },
      { key: "mouza", label: "Mouza", type: "text", max: 100 },
      { key: "dag", label: "Dag", type: "text", max: 100 },
      { key: "khatian", label: "Khatian", type: "text", max: 100 },
      { key: "ownerName", label: "Owner", type: "text", max: 200 },
      { key: "area", label: "Land area", type: "decimal", min: 0 },
      { key: "currentClass", label: "Current land class", type: "text", max: 60 },
      { key: "requestedClass", label: "Requested land class", type: "text", max: 60, requireWhen: { field: "recordType", values: ["Conversion"] } },
      { key: "fee", label: "Application fee (₹)", type: "decimal", min: 0 },
      { key: "hearingDate", label: "Hearing date", type: "date" },
      { key: "inspectionDate", label: "Inspection date", type: "date" },
      { key: "status", label: "Status", type: "select", required: true, options: ["Not Started", "Applied", "Hearing", "Inspection", "Approved", "Rejected", "Completed"] },
      { key: "updatedKhatian", label: "Updated Khatian", type: "text", max: 60 },
      { key: "completionDate", label: "Completed on", type: "date", requireWhen: { field: "status", values: ["Completed"] } },
      { key: "remarks", label: "Remarks", type: "textarea", max: 1000, requireWhen: { field: "status", values: ["Rejected"] } },
      { key: "certificateFileId", label: "Mutation certificate / conversion order", type: "file" },
      { key: "reportFileId", label: "Report", type: "file" },
    ],
    columns: ["recordType", "applicationNo", "applicationDate", "office", "hearingDate", "status", "completionDate"],
  },
  "OFFLINE-SEARCH": {
    entry: "Office visit", plural: "Office visits",
    note: "One entry per office visit. Several visits to the same office are separate entries.",
    fields: [
      { key: "officeName", label: "Office", type: "text", required: true, max: 200 },
      { key: "officeLocation", label: "Location", type: "text", max: 200 },
      { key: "searchedBy", label: "Searched by (person responsible)", type: "text", required: true, max: 150 },
      { key: "fromYear", label: "Period from (year)", type: "int", min: 1900, max: 2100 },
      { key: "toYear", label: "Period to (year)", type: "int", min: 1900, max: 2100 },
      { key: "searchDate", label: "Visit date", type: "date", required: true },
      { key: "ownerName", label: "Owner searched", type: "text", max: 200 },
      { key: "propertyRef", label: "Property reference", type: "text", max: 200 },
      { key: "deedRef", label: "Deed details searched", type: "text", max: 200 },
      { key: "documentsExamined", label: "Documents examined", type: "textarea", max: 1000 },
      { key: "result", label: "Result", type: "select", options: RESULT_SEARCH, required: true },
      { key: "findings", label: "Findings", type: "textarea", max: 2000 },
      { key: "reportFileId", label: "Search report", type: "file" },
    ],
    columns: ["officeName", "searchedBy", "searchDate", "ownerName", "fromYear", "toYear", "result"],
  },
  "RS-PANCHA": {
    entry: "Application", plural: "Applications",
    fields: appFields("Panchayat / office"),
    columns: ["applicationNo", "office", "applicationDate", "expectedDate", "reportDate", "status"],
  },
  "PLOT-INFO": {
    entry: "Application", plural: "Applications",
    fields: [...appFields("Office"),
      { key: "plotArea", label: "Plot area (from report)", type: "decimal", min: 0 },
      { key: "classification", label: "Land classification", type: "text", max: 60 },
      { key: "recordedOwner", label: "Recorded owner", type: "text", max: 300 },
      { key: "verifierRemarks", label: "Verifier remarks", type: "textarea", max: 1000 }],
    columns: ["applicationNo", "office", "applicationDate", "expectedDate", "reportDate", "status"],
  },
  "BANGLA-BHUMI": {
    entry: "Dag mapping", plural: "Dag mappings",
    note: "One row per RS Dag → LR Dag pair. One RS Dag may map to several LR Dags; leave LR Dag blank when no match was found.",
    fields: [
      { key: "mouza", label: "Mouza", type: "text", max: 100 },
      { key: "jlNo", label: "J.L. no.", type: "text", max: 30 },
      { key: "rsDag", label: "RS Dag", type: "text", required: true, max: 30 },
      { key: "rsKhatian", label: "RS Khatian", type: "text", max: 30 },
      { key: "lrDag", label: "LR Dag", type: "text", max: 30 },
      { key: "lrKhatian", label: "LR Khatian", type: "text", max: 30 },
      { key: "recordedOwner", label: "Recorded owner", type: "text", max: 200 },
      { key: "area", label: "Area", type: "decimal" },
      { key: "classification", label: "Land classification", type: "text", max: 60 },
      { key: "searchDate", label: "Search date", type: "date" },
      { key: "result", label: "Result", type: "select", options: ["Matched", "Partly matched", "Unmatched", "Disputed"], required: true },
      { key: "remarks", label: "Remarks", type: "textarea", max: 1000, requireWhen: { field: "result", values: ["Unmatched", "Partly matched", "Disputed"] } },
      { key: "recordFileId", label: "Bangla Bhumi record", type: "file" },
    ],
    columns: ["rsDag", "rsKhatian", "lrDag", "lrKhatian", "recordedOwner", "area", "result"],
  },
  "OWNER-MATCH": {
    entry: "Owner match", plural: "Owner matches",
    note: "Match RS recorded owners to LR recorded owners. Use several rows for one-to-many. A name match alone is not proof of ownership — cite the supporting deed.",
    fields: [
      { key: "rsOwner", label: "RS owner", type: "text", max: 200 },
      { key: "rsKhatian", label: "RS Khatian", type: "text", max: 30 },
      { key: "rsDag", label: "RS Dag", type: "text", max: 30 },
      { key: "rsArea", label: "RS area", type: "decimal" },
      { key: "rsShare", label: "RS share", type: "text", max: 30 },
      { key: "lrOwner", label: "LR owner", type: "text", max: 200 },
      { key: "lrKhatian", label: "LR Khatian", type: "text", max: 30 },
      { key: "lrDag", label: "LR Dag", type: "text", max: 30 },
      { key: "lrArea", label: "LR area", type: "decimal" },
      { key: "lrShare", label: "LR share", type: "text", max: 30 },
      { key: "match", label: "Match", type: "select", required: true, options: ["Exact Match", "Name Variation", "Partial Match", "Mismatch", "Additional Owner", "Missing Owner", "Unable to Verify"] },
      { key: "deedNo", label: "Supporting deed no.", type: "text", max: 60 },
      { key: "deedDate", label: "Deed date", type: "date" },
      { key: "regOffice", label: "Registration office", type: "text", max: 200 },
      { key: "inheritanceDoc", label: "Inheritance document", type: "text", max: 200 },
      { key: "partitionDoc", label: "Partition document", type: "text", max: 200 },
      { key: "remarks", label: "Explanation", type: "textarea", max: 1000, requireWhen: { field: "match", values: ["Mismatch", "Additional Owner", "Missing Owner", "Unable to Verify", "Partial Match"] } },
      { key: "fileId", label: "Supporting copy", type: "file" },
    ],
    columns: ["rsOwner", "rsKhatian", "lrOwner", "lrKhatian", "match", "deedNo"],
    check: (d) => (!d.rsOwner && !d.lrOwner ? "Enter the RS owner, the LR owner, or both" : null),
  },
  "DEED-CHAIN-FINAL": {
    entry: "Deed checked", plural: "Final chain verification (6B)",
    note: "6B — verify each deed identified in 6A against the original or a certified copy: continuity of ownership, area and parties. Record every missing link and discrepancy.",
    fields: [
      { key: "deedRef", label: "Deed (no. / year from 6A)", type: "text", required: true, max: 100 },
      { key: "sourceReviewed", label: "Reviewed against", type: "select", required: true, options: ["Original", "Certified Copy", "Photocopy only", "Not Available"] },
      { key: "continuity", label: "Ownership continuity", type: "select", required: true, options: ["Continuous", "Gap", "Disputed", "Unable to Verify"] },
      { key: "partiesMatch", label: "Parties match previous deed", type: "select", options: ["Yes", "No", "Partly"] },
      { key: "areaMatch", label: "Area matches", type: "select", options: ["Yes", "No", "Partly"] },
      { key: "discrepancies", label: "Missing links / discrepancies", type: "textarea", max: 2000,
        requireWhen: { field: "continuity", values: ["Gap", "Disputed", "Unable to Verify"] } },
      { key: "remarks", label: "Remarks", type: "textarea", max: 1000, requireWhen: { field: "sourceReviewed", values: ["Photocopy only", "Not Available"] } },
      { key: "fileId", label: "Copy reviewed", type: "file" },
    ],
    columns: ["deedRef", "sourceReviewed", "continuity", "partiesMatch", "areaMatch", "discrepancies"],
    check: (d) => ((d.partiesMatch === "No" || d.areaMatch === "No") && !d.discrepancies ? "Describe the discrepancy where parties or area do not match" : null),
  },
  "DEED-CHAIN": {
    entry: "Deed", plural: "Deed chain (6A)",
    note: "6A — identify the mother deed and each link deed, and link every deed to the one before it. A deed with no previous deed (other than the oldest) shows as a gap. The chain is verified in 6B.",
    fields: [
      { key: "chainRole", label: "Deed role", type: "select", options: ["Mother Deed", "Link Deed"] },
      { key: "deedNo", label: "Deed no.", type: "text", required: true, max: 60 },
      { key: "deedDate", label: "Deed date", type: "date" },
      { key: "regYear", label: "Registration year", type: "int", min: 1800, max: 2100 },
      { key: "regOffice", label: "Registration office", type: "text", max: 200 },
      { key: "deedType", label: "Deed type", type: "text", max: 60 },
      { key: "executant", label: "Executant", type: "text", max: 300 },
      { key: "claimant", label: "Claimant", type: "text", max: 300 },
      { key: "mouza", label: "Mouza", type: "text", max: 100 },
      { key: "dag", label: "Dag", type: "text", max: 60 },
      { key: "khatian", label: "Khatian", type: "text", max: 60 },
      { key: "area", label: "Area", type: "decimal" },
      { key: "property", label: "Property description", type: "textarea", max: 1000 },
      { key: "previousEntryId", label: "Previous deed", type: "entry" },
      { key: "copyType", label: "Copy held", type: "select", options: ["Original", "Certified Copy", "Photocopy", "Scan"] },
      { key: "status", label: "Identification", type: "select", required: true, options: ["Identified", "Missing Link", "Incomplete", "Pending", "Under Review", "Verified", "Discrepancy Found", "Additional Document Required"] },
      { key: "remarks", label: "Remarks", type: "textarea", max: 1000, requireWhen: { field: "status", values: ["Missing Link", "Incomplete", "Discrepancy Found", "Additional Document Required"] } },
      { key: "fileId", label: "Deed copy", type: "file" },
    ],
    columns: ["chainRole", "deedNo", "deedDate", "deedType", "executant", "claimant", "area", "previousEntryId", "status"],
  },
  "MOTHER-DEED-ORIGINAL": {
    entry: "Physical check", plural: "Physical checks",
    fields: [
      { key: "motherDeedRef", label: "Mother deed reference", type: "text", required: true, max: 100 },
      { key: "available", label: "Original available", type: "select", options: ["Yes", "No"], required: true },
      { key: "holder", label: "Current holder", type: "text", max: 200 },
      { key: "checkDate", label: "Physical check date", type: "date", required: true },
      { key: "verifiedBy", label: "Verified by", type: "text", max: 150 },
      { key: "condition", label: "Condition", type: "select", options: ["Good", "Fair", "Damaged"] },
      { key: "remarks", label: "Remarks", type: "textarea", max: 1000, requireWhen: { field: "available", values: ["No"] } },
      { key: "photoFileId", label: "Photo / scan", type: "file" },
    ],
    columns: ["motherDeedRef", "available", "holder", "checkDate", "condition"],
  },
  "CERTIFIED-COPY": {
    entry: "Certified copy application", plural: "Certified copy applications",
    fields: [
      { key: "deedNo", label: "Deed no.", type: "text", required: true, max: 60 },
      { key: "deedYear", label: "Deed year", type: "int", min: 1800, max: 2100 },
      { key: "regOffice", label: "Registration office", type: "text", max: 200 },
      { key: "applicationNo", label: "Application no.", type: "text", max: 60 },
      { key: "applicationDate", label: "Application date", type: "date" },
      { key: "applicant", label: "Applicant", type: "text", max: 200 },
      { key: "expectedDate", label: "Expected receipt", type: "date" },
      { key: "receivedDate", label: "Received on", type: "date", requireWhen: { field: "status", values: ["Received", "Verified"] } },
      { key: "fee", label: "Application fee (₹)", type: "decimal", min: 0 },
      { key: "status", label: "Status", type: "select", required: true, options: ["Not Started", "Applied", "Processing", "Received", "Verified"] },
      { key: "remarks", label: "Remarks", type: "textarea", max: 1000 },
      { key: "receiptFileId", label: "Fee receipt", type: "file" },
      { key: "copyFileId", label: "Certified copy", type: "file" },
    ],
    columns: ["deedNo", "deedYear", "regOffice", "applicationNo", "applicationDate", "receivedDate", "status"],
  },
  "MOUZA-MAP": {
    entry: "Map sheet", plural: "Map sheets",
    note: "Keep the original Mouza map, the updated Dag sketch and the marked map as separate sheets — the original is never replaced. Without the updated Dag sketch the activity can be submitted only with an authorised exception.",
    fields: [
      { key: "sheetType", label: "Sheet", type: "select", required: true, options: ["Original Mouza Map", "Updated Dag Sketch", "Marked Map"] },
      { key: "mapRef", label: "Map sheet no. / reference", type: "text", max: 100 },
      { key: "landLocation", label: "Land location marked", type: "text", max: 300 },
      { key: "mouza", label: "Mouza", type: "text", max: 100 },
      { key: "jlNo", label: "J.L. no.", type: "text", max: 30 },
      { key: "dags", label: "Dag numbers", type: "text", max: 300 },
      { key: "roadAccess", label: "Road access", type: "text", max: 300 },
      { key: "boundary", label: "Boundary notes", type: "textarea", max: 1000 },
      { key: "surveyRef", label: "Survey reference", type: "text", max: 100 },
      { key: "remarks", label: "Remarks", type: "textarea", max: 1000 },
      { key: "fileId", label: "Map file", type: "file", required: true },
    ],
    columns: ["sheetType", "mapRef", "dags", "roadAccess", "fileId"],
  },
  KHAJNA: {
    entry: "Khajna receipt", plural: "Khajna receipts",
    fields: [
      { key: "ownerName", label: "Owner", type: "text", required: true, max: 200 },
      { key: "mouza", label: "Mouza", type: "text", max: 100 },
      { key: "dag", label: "Dag", type: "text", max: 60 },
      { key: "khatian", label: "Khatian", type: "text", max: 60 },
      { key: "lastPaidYear", label: "Last paid year", type: "text", max: 20 },
      { key: "paymentDate", label: "Payment date", type: "date" },
      { key: "receiptNo", label: "Receipt no.", type: "text", max: 60 },
      { key: "amount", label: "Amount (₹)", type: "decimal", min: 0 },
      { key: "outstanding", label: "Outstanding dues (₹)", type: "decimal", min: 0 },
      { key: "status", label: "Status", type: "select", required: true, options: ["Pending", "Receipt Collected", "Verified", "Discrepancy Found"] },
      { key: "verifiedOn", label: "Verified on", type: "date" },
      { key: "remarks", label: "Remarks", type: "textarea", max: 1000, requireWhen: { field: "status", values: ["Discrepancy Found"] } },
      { key: "fileId", label: "Receipt copy", type: "file" },
    ],
    columns: ["ownerName", "dag", "khatian", "lastPaidYear", "receiptNo", "amount", "status"],
  },
  "LAND-SURVEY": {
    entry: "Survey", plural: "Surveys",
    note: "One survey per Dag. The difference between required and measured area is shown in the list.",
    fields: [
      { key: "surveyType", label: "Survey method", type: "select", required: true, options: ["Plenty Survey", "Machine Survey"] },
      { key: "surveyDate", label: "Survey date", type: "date", required: true },
      { key: "surveyor", label: "Surveyor", type: "text", max: 150 },
      { key: "company", label: "Survey company", type: "text", max: 150 },
      { key: "mouza", label: "Mouza", type: "text", max: 100 },
      { key: "dag", label: "Dag", type: "text", required: true, max: 60 },
      { key: "khatian", label: "Khatian", type: "text", max: 60 },
      { key: "requiredArea", label: "Required area", type: "decimal", min: 0 },
      { key: "measuredArea", label: "Measured area", type: "decimal", min: 0 },
      { key: "boundary", label: "Boundary details", type: "textarea", max: 1000 },
      { key: "roadAccess", label: "Road access", type: "text", max: 300 },
      { key: "discrepancies", label: "Discrepancies", type: "textarea", max: 1000 },
      { key: "remarks", label: "Remarks", type: "textarea", max: 1000 },
      { key: "mapFileId", label: "Survey map", type: "file" },
      { key: "sketchFileId", label: "Sketch", type: "file" },
      { key: "reportFileId", label: "Survey report", type: "file" },
    ],
    columns: ["surveyType", "surveyDate", "dag", "requiredArea", "measuredArea", "surveyor"],
  },
};

function appFields(officeLabel) {
  return [
    { key: "applicationNo", label: "Application no.", type: "text", max: 60 },
    { key: "office", label: officeLabel, type: "text", required: true, max: 200 },
    { key: "applicationDate", label: "Application date", type: "date", requireWhen: { field: "status", values: ["Applied", "Processing", "Report Received", "Verified"] } },
    { key: "applicant", label: "Applicant", type: "text", max: 200 },
    { key: "mouza", label: "Mouza", type: "text", max: 100 },
    { key: "dagNo", label: "Dag no.", type: "text", max: 60 },
    { key: "khatianNo", label: "Khatian no.", type: "text", max: 60 },
    { key: "submittedDocs", label: "Documents submitted", type: "textarea", max: 1000 },
    { key: "expectedDate", label: "Expected report date", type: "date" },
    { key: "reportDate", label: "Report received on", type: "date", requireWhen: { field: "status", values: ["Report Received", "Verified"] } },
    { key: "status", label: "Status", type: "select", required: true, options: APP_STATUS },
    { key: "remarks", label: "Remarks", type: "textarea", max: 1000 },
    { key: "reportFileId", label: "Report", type: "file" },
  ];
}

/** Check and clean one entry's data. Returns { data } or { error }. `entryIds` = the activity's other live entry ids. */
function validateEntry(code, raw, entryIds = []) {
  const cfg = ENTRY_CONFIG[code];
  if (!cfg) return { error: "This activity has no detail entries" };
  const src = raw && typeof raw === "object" ? raw : {};
  const data = {};
  for (const f of cfg.fields) {
    let v = src[f.key];
    if (v === undefined || v === null || (typeof v === "string" && !v.trim())) { v = null; }
    else if (f.type === "text" || f.type === "textarea") { v = String(v).trim(); if (f.max && v.length > f.max) return { error: `${f.label}: at most ${f.max} characters` }; }
    else if (f.type === "int" || f.type === "decimal" || f.type === "file" || f.type === "entry") {
      const n = Number(v);
      if (!Number.isFinite(n) || ((f.type !== "decimal") && !Number.isInteger(n))) return { error: `${f.label}: enter a number` };
      if (f.min != null && n < f.min) return { error: `${f.label}: at least ${f.min}` };
      if (f.max != null && n > f.max) return { error: `${f.label}: at most ${f.max}` };
      if (f.type === "entry" && !entryIds.includes(n)) return { error: `${f.label}: choose an entry of this activity` };
      v = n;
    } else if (f.type === "date") { v = String(v).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) return { error: `${f.label}: enter a valid date` }; }
    else if (f.type === "select") { v = String(v); if (!f.options.includes(v) && LEGACY[v] && f.options.includes(LEGACY[v])) v = LEGACY[v]; if (!f.options.includes(v)) return { error: `${f.label}: choose from the list` }; }
    data[f.key] = v;
  }
  for (const f of cfg.fields) {
    const need = f.required || (f.requireWhen && f.requireWhen.values.includes(data[f.requireWhen.field]));
    if (need && data[f.key] == null) return { error: f.required ? `${f.label} is required` : `${f.label} is required when ${cfg.fields.find((x) => x.key === f.requireWhen.field)?.label ?? f.requireWhen.field} is ${data[f.requireWhen.field]}` };
  }
  if (data.fromYear && data.toYear && data.fromYear > data.toYear) return { error: "From year is after To year" };
  cfg.derive?.(data);
  const extra = cfg.check?.(data);
  if (extra) return { error: extra };
  return { data };
}

/** What the screens need: the config without functions. */
const publicConfig = () => Object.fromEntries(Object.entries(ENTRY_CONFIG).map(([k, c]) => [k, { entry: c.entry, plural: c.plural, note: c.note ?? null, fields: c.fields, columns: c.columns }]));

/** One-line summary of an entry for the history. */
const entryLabel = (code, d) => {
  const cfg = ENTRY_CONFIG[code];
  return (cfg?.columns ?? []).slice(0, 3).map((k) => d?.[k]).filter((x) => x != null && x !== "").join(" · ").slice(0, 300);
};

module.exports = { ENTRY_CONFIG, validateEntry, publicConfig, entryLabel };
