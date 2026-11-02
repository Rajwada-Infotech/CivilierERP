const express = require("express");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
const { getPool } = require("../db");
const authMiddleware = require("../middleware/auth");
const { projectPredicate } = require("../services/projectScope");
const { QUEUES, BOOKING_FROM, BOOKING_COLS, bookingLink } = require("../services/crmWorkQueues");

router.use(apiRateLimit);
router.use(authMiddleware);

// Rows shown per queue; the queue's own page holds the rest.
const ROWS_PER_QUEUE = 8;

// The queues this person may act on (each queue's `permit` reads Menu Rights or
// Approval Setup — no role list here), with their FROM and scoped WHERE.
async function permittedQueues(req) {
  const allowed = [];
  for (const q of QUEUES) {
    if (await q.permit(req).catch(() => false)) allowed.push(q);
  }
  return allowed.map((q) => ({
    q,
    from: q.from || BOOKING_FROM,
    where: `WHERE ${q.where} ${projectPredicate(req.projectScope, q.projectColumn || "b.ProjectId", "AND")}`,
  }));
}
const countOf = (pool, { from, where }) =>
  pool.request().query(`SELECT COUNT(*) AS Cnt ${from} ${where}`).then((r) => r.recordset[0]?.Cnt ?? 0);

// GET / — the CRM queues the signed-in person can act on, in the order of the
// sale, each with its count and oldest-first rows. A queue the person has no
// right to is left out entirely. Only lists; every row links to the page that
// already does the step.
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const queues = await Promise.all((await permittedQueues(req)).map(async (pq) => {
      const { q, from, where } = pq;
      const [count, rows] = await Promise.all([
        countOf(pool, pq),
        pool.request().query(`
          SELECT TOP ${ROWS_PER_QUEUE} ${q.cols || BOOKING_COLS}, ${q.since} AS Since${q.extra ? `, ${q.extra}` : ""}
          ${from} ${where}
          ORDER BY Since ASC`),
      ]);
      const link = q.link || bookingLink;
      return {
        key: q.key,
        title: q.title,
        note: q.note,
        action: q.action,
        listLink: q.listLink,
        sinceIs: q.sinceIs || "waiting",
        count,
        rows: rows.recordset.map((r) => ({ ...r, Link: link(r) })),
      };
    }));

    res.json({ queues });
  } catch (e) {
    console.error("[crm-my-work] error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET /count — the total waiting on this person, for the menu badge.
router.get("/count", async (req, res) => {
  try {
    const pool = getPool();
    const counts = await Promise.all((await permittedQueues(req)).map((pq) => countOf(pool, pq)));
    res.json({ count: counts.reduce((n, c) => n + c, 0) });
  } catch (e) {
    console.error("[crm-my-work] count error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

module.exports = router;
