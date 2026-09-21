// Which picker group an AccountHeadMaster row belongs to.
//
// LHeadType alone is not enough to tell what a head really is:
//   - Landlords are stored as LHeadType='S' (Supplier) and only differ by
//     LHeadCategory='Landlord' (see SupplierMaster.tsx's lheadTypeForVendorType).
//   - The Cash-in-Hand head is LHeadType='B' with LHeadCategory='Cash'.
//   - A project's auto-created ledger heads (ensureProjectLedgerHeads, codes
//     PRJ-<id>-CUST / PRJ-<id>-SUPP) reuse 'C' and 'S' even though the 'C' one
//     is a customer-side ledger, not a Contractor.
const GROUP_BY_TYPE = {
  GL: "general",
  B: "bank",
  A: "customer",
  S: "supplier",
  C: "contractor",
  BR: "broker",
  P: "partner",
  V: "vendor",
};

function ledgerOptionGroup(type, category, code) {
  if (typeof code === "string" && /^PRJ-\d+-(CUST|SUPP)$/i.test(code)) return "project";
  if (type === "S" && category === "Landlord") return "landlord";
  if (type === "B" && category === "Cash") return "cash";
  return GROUP_BY_TYPE[type] || "other";
}

module.exports = { ledgerOptionGroup };
