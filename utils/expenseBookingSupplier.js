"use strict";

/**
 * Generates the JOIN clauses and CASE-expression SQL needed to resolve the
 * effective supplier/contractor (AccountHeadMaster) for an ExpenseBooking row.
 *
 * GRN / PO / WO_PO / WORK_DONE / WO bookings resolve through their linked
 * source document's own supplier reference. Direct/manual bookings (TOD —
 * "Other Expenses") have no source document, so they resolve through
 * ExpenseBooking.LHeadId — the supplier chosen directly on the booking form.
 * EName (the booking/item label) is only ever a last-resort display fallback
 * — it must never stand in for an actual supplier.
 *
 * Previously this CASE/JOIN logic was copy-pasted across several queries in
 * expenseBooking.js with drift: some fell back to eb.LHeadId correctly,
 * others fell straight to eb.EName and silently ignored eb.LHeadId — which is
 * why direct invoices showed the booking name/doc-type label instead of the
 * actual supplier. This is now the single source of truth for that logic.
 *
 * @param {string} ebAlias - alias of the ExpenseBooking table in the query (e.g. "eb")
 * @param {string} suffix - unique suffix to keep join aliases collision-free
 *   when this helper is invoked more than once in the same query
 * @returns {{ joins: string, nameExpr: string, idExpr: string }}
 */
function expenseBookingSupplierSql(ebAlias, suffix) {
  const grnT = `grn_${suffix}`,
    grnSuppT = `grn_supp_${suffix}`;
  const poT = `po_${suffix}`,
    poSuppT = `po_supp_${suffix}`;
  const wdT = `wd_${suffix}`,
    wdSuppT = `wd_supp_${suffix}`;
  const woT = `wo_${suffix}`,
    woSuppT = `wo_supp_${suffix}`;
  const directSuppT = `direct_supp_${suffix}`;

  const joins = `
        LEFT JOIN dbo.GoodsReceiptNotes ${grnT}
          ON ${ebAlias}.ESourceType = 'GRN' AND ${grnT}.GRNID = TRY_CAST(${ebAlias}.ESourceId AS INT)
        LEFT JOIN dbo.AccountHeadMaster ${grnSuppT} ON ${grnSuppT}.LHeadId = ${grnT}.SupplierID
        LEFT JOIN dbo.PurchaseOrders ${poT}
          ON ${ebAlias}.ESourceType IN ('PO','WO_PO') AND ${poT}.PurchaseOrderID = TRY_CAST(${ebAlias}.ESourceId AS INT)
        LEFT JOIN dbo.AccountHeadMaster ${poSuppT} ON ${poSuppT}.LHeadId = ${poT}.SupplierID
        LEFT JOIN dbo.WorkDone ${wdT}
          ON ${ebAlias}.ESourceType = 'WORK_DONE' AND ${wdT}.ID = TRY_CAST(${ebAlias}.ESourceId AS INT)
        LEFT JOIN dbo.AccountHeadMaster ${wdSuppT} ON ${wdSuppT}.LHeadId = ${wdT}.SupplierId
        LEFT JOIN dbo.WorkOrderHeader ${woT}
          ON ${ebAlias}.ESourceType = 'WO' AND ${woT}.Id = TRY_CAST(${ebAlias}.ESourceId AS INT)
        LEFT JOIN dbo.AccountHeadMaster ${woSuppT}
          ON ${woSuppT}.LHeadId = COALESCE(${woT}.SupplierId, ${woT}.ContractorId)
        LEFT JOIN dbo.AccountHeadMaster ${directSuppT} ON ${directSuppT}.LHeadId = ${ebAlias}.LHeadId`;

  const nameExpr = `
          CASE
            WHEN ${ebAlias}.ESourceType = 'GRN' AND ${ebAlias}.ESourceId IS NOT NULL THEN ISNULL(${grnSuppT}.LHeadName, ISNULL(${ebAlias}.EName, ''))
            WHEN ${ebAlias}.ESourceType IN ('PO','WO_PO') THEN ISNULL(${poSuppT}.LHeadName, ISNULL(${ebAlias}.EName, ''))
            WHEN ${ebAlias}.ESourceType = 'WORK_DONE' THEN ISNULL(${wdSuppT}.LHeadName, ISNULL(${ebAlias}.EName, ''))
            WHEN ${ebAlias}.ESourceType = 'WO' THEN ISNULL(${woSuppT}.LHeadName, ISNULL(${ebAlias}.EName, ''))
            ELSE ISNULL(${directSuppT}.LHeadName, ISNULL(${ebAlias}.EName, ''))
          END`;

  const idExpr = `
          CASE
            WHEN ${ebAlias}.ESourceType = 'GRN' AND ${ebAlias}.ESourceId IS NOT NULL THEN ${grnSuppT}.LHeadId
            WHEN ${ebAlias}.ESourceType IN ('PO','WO_PO') THEN ${poSuppT}.LHeadId
            WHEN ${ebAlias}.ESourceType = 'WORK_DONE' THEN ${wdSuppT}.LHeadId
            WHEN ${ebAlias}.ESourceType = 'WO' THEN ${woSuppT}.LHeadId
            ELSE ${directSuppT}.LHeadId
          END`;

  // Whether the resolved supplier/contractor is GST-registered.
  // Returns 1 (Registered), 0 (Unregistered), or NULL (status unknown —
  // supplier row exists but LGSTType was never set and no GST number on file).
  //
  // NULL is important: the frontend badge is hidden when the value is NULL,
  // so suppliers with incomplete master data don't misleadingly show
  // "Non GST Bill". Only show the badge when we know for certain:
  //   • LGSTType = 'Registered'              → 1 (GST Bill)
  //   • LGSTType = 'Unregistered'            → 0 (Non GST Bill)
  //   • LGSTType IS NULL but LGST is set     → 1 (legacy: has GST number = registered)
  //   • LGSTType IS NULL and LGST is blank   → NULL (unknown, badge hidden)
  //   • No matching supplier row at all       → NULL (unknown, badge hidden)
  const gstRegisteredExpr = `
          CASE
            WHEN ${ebAlias}.ESourceType = 'GRN' AND ${ebAlias}.ESourceId IS NOT NULL
              THEN CASE
                     WHEN ${grnSuppT}.LGSTType = 'Registered'   OR (${grnSuppT}.LGSTType IS NULL AND ISNULL(${grnSuppT}.LGST, '') <> '') THEN 1
                     WHEN ${grnSuppT}.LGSTType = 'Unregistered' THEN 0
                     ELSE NULL
                   END
            WHEN ${ebAlias}.ESourceType IN ('PO','WO_PO')
              THEN CASE
                     WHEN ${poSuppT}.LGSTType = 'Registered'   OR (${poSuppT}.LGSTType IS NULL AND ISNULL(${poSuppT}.LGST, '') <> '') THEN 1
                     WHEN ${poSuppT}.LGSTType = 'Unregistered' THEN 0
                     ELSE NULL
                   END
            WHEN ${ebAlias}.ESourceType = 'WORK_DONE'
              THEN CASE
                     WHEN ${wdSuppT}.LGSTType = 'Registered'   OR (${wdSuppT}.LGSTType IS NULL AND ISNULL(${wdSuppT}.LGST, '') <> '') THEN 1
                     WHEN ${wdSuppT}.LGSTType = 'Unregistered' THEN 0
                     ELSE NULL
                   END
            WHEN ${ebAlias}.ESourceType = 'WO'
              THEN CASE
                     WHEN ${woSuppT}.LGSTType = 'Registered'   OR (${woSuppT}.LGSTType IS NULL AND ISNULL(${woSuppT}.LGST, '') <> '') THEN 1
                     WHEN ${woSuppT}.LGSTType = 'Unregistered' THEN 0
                     ELSE NULL
                   END
            ELSE CASE
                   WHEN ${directSuppT}.LGSTType = 'Registered'   OR (${directSuppT}.LGSTType IS NULL AND ISNULL(${directSuppT}.LGST, '') <> '') THEN 1
                   WHEN ${directSuppT}.LGSTType = 'Unregistered' THEN 0
                   ELSE NULL
                 END
          END`;

  // Whether the resolved supplier/contractor has TDS switched on
  // (AccountHeadMaster.IsTdsApplicable) — same CASE shape as
  // gstRegisteredExpr above, walked across every possible source type.
  // Returns 1/0, or NULL when no supplier/contractor row resolved at all.
  const tdsApplicableExpr = `
          CASE
            WHEN ${ebAlias}.ESourceType = 'GRN' AND ${ebAlias}.ESourceId IS NOT NULL THEN ${grnSuppT}.IsTdsApplicable
            WHEN ${ebAlias}.ESourceType IN ('PO','WO_PO') THEN ${poSuppT}.IsTdsApplicable
            WHEN ${ebAlias}.ESourceType = 'WORK_DONE' THEN ${wdSuppT}.IsTdsApplicable
            WHEN ${ebAlias}.ESourceType = 'WO' THEN ${woSuppT}.IsTdsApplicable
            ELSE ${directSuppT}.IsTdsApplicable
          END`;

  return { joins, nameExpr, idExpr, gstRegisteredExpr, tdsApplicableExpr };
}

module.exports = { expenseBookingSupplierSql };
