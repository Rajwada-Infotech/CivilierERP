const express = require("express");

const router = express.Router();

const sql = require("mssql");

router.post("/create", async (req, res) => {

  try {

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

    await sql.query`
      INSERT INTO tickets (
        subject,
        priority,
        issue_details,
        customer_name,
        customer_phone,
        company_id,
        project_id,
        attachment_path,
        status
      )

      VALUES (
        ${subject},
        ${priority},
        ${issue_details},
        ${customer_name},
        ${customer_phone},
        ${company_id},
        ${project_id},
        ${attachment_path},
        'Pending'
      )
    `;

    res.json({
      success: true,
    });

  } catch (err) {

    console.log(err);

    res.status(500).json({
      error: err.message,
    });
  }
});

router.get("/", async (req, res) => {

  try {

    const result = await sql.query(`
      SELECT *
      FROM tickets
      ORDER BY id DESC
    `);

    res.json(result.recordset);

  } catch (err) {

    res.status(500).json({
      error: err.message,
    });
  }
});

router.put("/resolve/:id", async (req, res) => {

  try {

    await sql.query`
      UPDATE tickets
      SET status='Resolved'
      WHERE id=${req.params.id}
    `;

    res.json({
      success: true,
    });

  } catch (err) {

    res.status(500).json({
      error: err.message,
    });
  }
});

module.exports = router;