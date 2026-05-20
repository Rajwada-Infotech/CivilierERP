const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");

router.post("/create", async (req, res) => {
  try {
    const pool = getPool();
    const {
      subject,
      priority,
      issue_details,
      customer_name,
      customer_phone,
      company_id,
      project_id,
      attachment_path,
    } = req.body;

    await pool
      .request()
      .input("subject", sql.NVarChar(500), subject)
      .input("priority", sql.NVarChar(50), priority)
      .input("issue_details", sql.NVarChar(sql.MAX), issue_details)
      .input("customer_name", sql.NVarChar(255), customer_name)
      .input("customer_phone", sql.NVarChar(50), customer_phone ?? null)
      .input("company_id", sql.Int, company_id ?? null)
      .input("project_id", sql.Int, project_id ?? null)
      .input("attachment_path", sql.NVarChar(sql.MAX), attachment_path ?? null)
      .query(`
        INSERT INTO tickets (
          subject, priority, issue_details,
          customer_name, customer_phone,
          company_id, project_id,
          attachment_path, status
        ) VALUES (
          @subject, @priority, @issue_details,
          @customer_name, @customer_phone,
          @company_id, @project_id,
          @attachment_path, 'Pending'
        )
      `);

    res.json({ success: true });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT * FROM tickets ORDER BY id DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/resolve/:id", async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .query(`UPDATE tickets SET status = 'Resolved' WHERE id = @id`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
