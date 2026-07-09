const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");

router.use(authMiddleware);
router.use(apiRateLimit);

router.get("/booking/:bookingId", requirePageRight("crm-customer-bank-details", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().input("bid", sql.Int, parseInt(req.params.bookingId))
      .query("SELECT * FROM dbo.CrmCustomerBankDetail WHERE BookingId = @bid");
    res.json(result.recordset[0] || null);
  } catch (e) {
    console.error("[crm-customer-bank-details] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.put("/booking/:bookingId", requirePageRight("crm-customer-bank-details", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const bid = parseInt(req.params.bookingId);
    const b = req.body;
    const actor = actorId(req);

    const existing = await pool.request().input("bid", sql.Int, bid).query("SELECT Id FROM dbo.CrmCustomerBankDetail WHERE BookingId = @bid");

    const fields = {
      bank: b.BankName || null, branch: b.BranchName || null, acc: b.AccountNo || null, ifsc: b.IfscCode || null,
      holder: b.AccountHolderName || null, nname: b.NomineeName || null, nrel: b.NomineeRelation || null,
      ndob: b.NomineeDob || null, ncon: b.NomineeContact || null, naddr: b.NomineeAddress || null,
      pan: b.PanNo || null, aadh: b.AadhaarNo || null, notes: b.Notes || null,
    };

    if (existing.recordset.length) {
      await pool.request()
        .input("bid", sql.Int, bid)
        .input("bank", sql.NVarChar(200), fields.bank).input("branch", sql.NVarChar(200), fields.branch)
        .input("acc", sql.NVarChar(50), fields.acc).input("ifsc", sql.NVarChar(20), fields.ifsc)
        .input("holder", sql.NVarChar(200), fields.holder).input("nname", sql.NVarChar(200), fields.nname)
        .input("nrel", sql.NVarChar(50), fields.nrel).input("ndob", sql.Date, fields.ndob)
        .input("ncon", sql.NVarChar(20), fields.ncon).input("naddr", sql.NVarChar(500), fields.naddr)
        .input("pan", sql.NVarChar(20), fields.pan).input("aadh", sql.NVarChar(20), fields.aadh)
        .input("notes", sql.NVarChar(sql.MAX), fields.notes).input("ub", sql.Int, actor)
        .query(`
          UPDATE dbo.CrmCustomerBankDetail SET
            BankName = ISNULL(@bank, BankName), BranchName = ISNULL(@branch, BranchName),
            AccountNo = ISNULL(@acc, AccountNo), IfscCode = ISNULL(@ifsc, IfscCode),
            AccountHolderName = ISNULL(@holder, AccountHolderName),
            NomineeName = ISNULL(@nname, NomineeName), NomineeRelation = ISNULL(@nrel, NomineeRelation),
            NomineeDob = ISNULL(@ndob, NomineeDob), NomineeContact = ISNULL(@ncon, NomineeContact),
            NomineeAddress = ISNULL(@naddr, NomineeAddress),
            PanNo = ISNULL(@pan, PanNo), AadhaarNo = ISNULL(@aadh, AadhaarNo),
            Notes = @notes, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
          WHERE BookingId = @bid
        `);
    } else {
      await pool.request()
        .input("bid", sql.Int, bid)
        .input("bank", sql.NVarChar(200), fields.bank).input("branch", sql.NVarChar(200), fields.branch)
        .input("acc", sql.NVarChar(50), fields.acc).input("ifsc", sql.NVarChar(20), fields.ifsc)
        .input("holder", sql.NVarChar(200), fields.holder).input("nname", sql.NVarChar(200), fields.nname)
        .input("nrel", sql.NVarChar(50), fields.nrel).input("ndob", sql.Date, fields.ndob)
        .input("ncon", sql.NVarChar(20), fields.ncon).input("naddr", sql.NVarChar(500), fields.naddr)
        .input("pan", sql.NVarChar(20), fields.pan).input("aadh", sql.NVarChar(20), fields.aadh)
        .input("notes", sql.NVarChar(sql.MAX), fields.notes).input("cb", sql.Int, actor)
        .query(`
          INSERT INTO dbo.CrmCustomerBankDetail
            (BookingId, BankName, BranchName, AccountNo, IfscCode, AccountHolderName,
             NomineeName, NomineeRelation, NomineeDob, NomineeContact, NomineeAddress,
             PanNo, AadhaarNo, Notes, CreatedBy, CreatedAt)
          VALUES (@bid, @bank, @branch, @acc, @ifsc, @holder, @nname, @nrel, @ndob, @ncon, @naddr, @pan, @aadh, @notes, @cb, SYSDATETIME())
        `);
    }
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-customer-bank-details] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
