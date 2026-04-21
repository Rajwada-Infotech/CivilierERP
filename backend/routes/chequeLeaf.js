const express = require("express");
const router = express.Router();

/**
 * TEMP SAFE ROUTE - Prevents server crash and allows endpoint to respond
 * Matches project pattern and user-approved minimal implementation
 */
router.get("/", async (req, res) => {
  try {
    res.json([]);
  } catch (err) {
    console.error("ChequeLeaf GET error:", err);
    res.status(500).json({ error: "Failed to fetch cheque leaves" });
  }
});

module.exports = router;
