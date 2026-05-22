const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { checkPermission } = require("../middleware/permissions");

const router = express.Router();

const PERMISSION_MODULE = "Followup";
const PERMISSION_SUBMODULE = "Bookings";

router.use(authMiddleware);

// GET /api/followup-bookings
router.get(
  "/",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanView"),
  async (req, res) => {
    try {
      // Stub — table not yet created
      res.json({
        data: [],
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
      });
    } catch (err) {
      console.error("followupBookings GET error:", err);
      res.status(500).json({ error: "Failed to fetch bookings" });
    }
  },
);

// POST /api/followup-bookings
router.post(
  "/",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanAdd"),
  async (req, res) => {
    try {
      res.status(501).json({ error: "Not implemented yet" });
    } catch (err) {
      console.error("followupBookings POST error:", err);
      res.status(500).json({ error: "Failed to create booking" });
    }
  },
);

// PUT /api/followup-bookings/:id
router.put(
  "/:id",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanEdit"),
  async (req, res) => {
    try {
      res.status(501).json({ error: "Not implemented yet" });
    } catch (err) {
      console.error("followupBookings PUT error:", err);
      res.status(500).json({ error: "Failed to update booking" });
    }
  },
);

// DELETE /api/followup-bookings/:id
router.delete(
  "/:id",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanDelete"),
  async (req, res) => {
    try {
      res.status(501).json({ error: "Not implemented yet" });
    } catch (err) {
      console.error("followupBookings DELETE error:", err);
      res.status(500).json({ error: "Failed to delete booking" });
    }
  },
);

module.exports = router;
