const express = require("express");
const router = express.Router();

router.get("/", async (req, res) => {
  try {
    res.json([]);
  } catch (err) {
    console.error("ContractorCategory error:", err);
    res.status(500).json({ error: "Failed" });
  }
});

module.exports = router;
