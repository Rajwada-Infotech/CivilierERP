const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql, queryWithRetry } = require("../db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { redisGet, redisSet, redisDel, invalidateUserSession } = require("../redis");
const { blacklistToken } = require("../middleware/blacklist");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { checkPermission } = require("../middleware/permissions");
const allowRoles = require("../middleware/role");
const { normalizeRole: normalizeRoleFromRoleMiddleware } = allowRoles;

// Privileged roles that can always list users (Password Reset, User Management)
const PRIVILEGED_ROLES = ["super_admin", "admin", "dba"];

// Roles allowed to be assigned as an Agreement's Legal Executive. Filtered by
// RName (the stable, human-assigned role code), not RId — role IDs are
// auto-increment and not guaranteed to match across environments, RName is
// what migrations actually seed by. legal_head can also prepare paperwork in
// smaller teams even though their primary function is senior approval, so
// both legal roles are included rather than just legal_person.
// TEMP (continuous dev/testing only): super_admin included so testing isn't
// blocked on real legal-role users existing in every environment. Remove
// once real legal_head/legal_person accounts are seeded everywhere this
// matters — this is a scope hole if it ships to production as-is.
const LEGAL_EXECUTIVE_ROLES = ["legal_head", "legal_person", "super_admin"];

const SALT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = process.env.NODE_ENV === "development" ? 50 : 10;
const LOCKOUT_SECONDS = 15 * 60;

// When an email doesn't exist we still run a bcrypt.compare against this hash
// so the response time matches the "user found, wrong password" path —
// otherwise the timing difference reveals which emails are registered (user
// enumeration). Computed once at module load at the same cost factor.
const dummyHashPromise = bcrypt.hash(
  "timing-equalizer-not-a-real-password",
  SALT_ROUNDS,
);

// ======================
// ROLE NORMALIZER - Root Cause Fix
// ======================
const normalizeRole = normalizeRoleFromRoleMiddleware;

// ======================
// LOGIN
// ======================
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  // Normalize email early to avoid subtle DB mismatches (whitespace, casing)
  const normalizedEmail = String(email).trim().toLowerCase();
  const incomingPassword = String(password);

  const lockKey = `login:lock:${normalizedEmail}`;
  const attemptsKey = `login:attempts:${normalizedEmail}`;

  // Skip rate limiting for local development
  const isLocal =
    req.ip === "::1" ||
    req.ip === "127.0.0.1" ||
    req.ip === "::ffff:127.0.0.1" ||
    req.ip?.includes("127.0.0.1");

  try {
    // Redis may be unavailable — never let a cache check block login
    try {
      const locked = isLocal ? null : await redisGet(lockKey);
      if (locked) {
        return res.status(429).json({
          error: "Too many attempts. Try again later.",
        });
      }
    } catch {
      // Redis down — skip lockout check, proceed to DB auth
    }

    let result;
    try {
      result = await queryWithRetry(async (request) =>
        request
          .input("email", sql.NVarChar, normalizedEmail).query(`
            SELECT u.id, u.name, u.email, u.RoleId, u.password, u.discontinue,
                   ISNULL(u.can_accept_tickets, 0) AS can_accept_tickets,
                   ISNULL(u.ShowLoginReminders, 1) AS ShowLoginReminders,
                   r.RName AS roleName
            FROM dbo.users u
            LEFT JOIN dbo.Role r ON u.RoleId = r.RId
            WHERE u.email = @email
          `),
      );
    } catch (dbErr) {
      // Pool exhausted / dead connection (tarn "operation timed out") —
      // queryWithRetry already retried twice on transient errors, so if
      // we're here the DB genuinely isn't answering. Tell the user that
      // plainly instead of letting Express's generic 500 (or a silent
      // hang up to requestTimeout) look like "login is broken".
      console.error("Login DB Error:", dbErr);
      return res.status(503).json({
        error: "Login service is temporarily unavailable. Please try again in a moment.",
      });
    }

    const user = result.recordset[0];
    if (!user) {
      // Equalise timing with the wrong-password path to avoid user enumeration.
      await bcrypt.compare(incomingPassword, await dummyHashPromise);
      if (process.env.NODE_ENV === "development") {
        console.warn("[Login] No user found for email:", normalizedEmail);
      }
      if (!isLocal) await incrementLoginAttempts(attemptsKey, lockKey);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (user.discontinue) {
      return res.status(403).json({ error: "User inactive" });
    }

    const match = await bcrypt.compare(password, user.password);

    if (process.env.NODE_ENV === "development") {
      console.warn("[Login] bcrypt compare result:", {
        matched: match,
        email: normalizedEmail,
      });
    }

    if (!match) {
      if (!isLocal) await incrementLoginAttempts(attemptsKey, lockKey);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    try {
      await redisDel(attemptsKey);
      await redisDel(lockKey);
    } catch {}

    // FIXED: Normalize role
    const normalizedRole = normalizeRole(user.roleName);

    const token = jwt.sign(
      {
        userId: user.id,
        roleId: user.RoleId,
        role: normalizedRole,
        email: user.email,
        name: user.name,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: normalizedRole,
        roleId: user.RoleId,
        can_accept_tickets: !!user.can_accept_tickets,
        showLoginReminders: !!user.ShowLoginReminders,
        pagePermissions: await (async () => {
          try {
            const {
              getEffectivePagePermissions,
            } = require("../middleware/permissions");
            const merged = await getEffectivePagePermissions(
              user.id,
              user.RoleId,
            );
            return merged.length ? merged : null;
          } catch {
            return null;
          }
        })(),
      },
    });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ======================
// AUTH REQUIRED BELOW THIS LINE
// ======================
router.use(authMiddleware);
router.use(apiRateLimit);

async function incrementLoginAttempts(attemptsKey, lockKey) {
  try {
    const attempts = parseInt((await redisGet(attemptsKey)) || "0") + 1;
    await redisSet(attemptsKey, String(attempts), LOCKOUT_SECONDS);
    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      await redisSet(lockKey, "1", LOCKOUT_SECONDS);
    }
  } catch {}
}

// ======================
// LOGOUT
// ======================
router.post("/logout", authMiddleware, async (req, res) => {
  try {
    if (req.token && req.user?.exp) {
      await blacklistToken(req.token, req.user.exp);
    }
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Logout failed" });
  }
});

// ======================
// GET USERS
// ======================
// Open to any privileged role (super_admin / admin / dba) so that the
// Password Reset and User Management pages always load, regardless of
// whether a RoleRights row exists for "Users / List" in the DB.
router.get(
  "/legal-executives",
  authMiddleware,
  async (req, res) => {
    try {
      const pool = getPool();
      const req0 = pool.request();
      LEGAL_EXECUTIVE_ROLES.forEach((role, i) => req0.input(`role${i}`, sql.NVarChar(50), role));
      const inClause = LEGAL_EXECUTIVE_ROLES.map((_, i) => `@role${i}`).join(",");
      const result = await req0.query(`
        SELECT u.id, u.name, u.email, r.RName AS roleName
        FROM dbo.users u
        JOIN dbo.Role r ON u.RoleId = r.RId
        WHERE r.RName IN (${inClause})
          AND ISNULL(u.discontinue, 0) = 0
        ORDER BY u.name
      `);
      res.json(result.recordset);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

router.get(
  "/",
  authMiddleware,
  allowRoles(...PRIVILEGED_ROLES),
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`
        SELECT u.id, u.name, u.email, u.RoleId,
               r.RName AS roleName,
               u.created_datetime, u.discontinue,
               ISNULL(u.can_accept_tickets, 0) AS can_accept_tickets
        FROM dbo.users u
        LEFT JOIN dbo.Role r ON u.RoleId = r.RId
      `);

      // Normalize roles for frontend
      const normalizedUsers = result.recordset.map((user) => ({
        ...user,
        role: normalizeRole(user.roleName),
        roleName: user.roleName,
        can_accept_tickets: !!user.can_accept_tickets,
      }));

      res.json(normalizedUsers);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ======================
// CREATE USER
// ======================
router.post(
  "/",
  authMiddleware,
  checkPermission("Users", "List", "CanAdd"),
  async (req, res) => {
    const { name, email, RoleId, roleId, password, can_accept_tickets } =
      req.body;
    if (!password) {
      return res.status(400).json({ error: "Password required" });
    }
    const assignedRoleId = Number(RoleId ?? roleId);
    try {
      const hashed = await bcrypt.hash(password, SALT_ROUNDS);
      const pool = getPool();
      await pool
        .request()
        .input("name", sql.NVarChar, name)
        .input("email", sql.NVarChar, email)
        .input("RoleId", sql.Int, assignedRoleId)
        .input("can_accept_tickets", sql.Bit, can_accept_tickets ? 1 : 0)
        .input("password", sql.NVarChar, hashed).query(`
          INSERT INTO dbo.users (name, email, password, RoleId, role, created_datetime, discontinue, can_accept_tickets)
          VALUES (
            @name, @email, @password, @RoleId,
            (SELECT RName FROM dbo.Role WHERE RId = @RoleId),
            GETDATE(), 0, @can_accept_tickets
          )
        `);
      res.json({ message: "User created" });
    } catch (err) {
      // SQL Server unique constraint violation (error number 2627 or 2601)
      if (
        err.number === 2627 ||
        err.number === 2601 ||
        (err.message && err.message.includes("duplicate key"))
      ) {
        return res
          .status(409)
          .json({ error: "A user with this email address already exists." });
      }
      res.status(500).json({ error: err.message });
    }
  },
);

// ======================
// UPDATE USER
// ======================
router.put(
  "/:id",
  authMiddleware,
  checkPermission("Users", "List", "CanEdit"),
  async (req, res) => {
    const { id } = req.params;
    const { name, email, RoleId, roleId, discontinue, can_accept_tickets } =
      req.body;
    try {
      const pool = getPool();

      // If only `discontinue` was sent (toggle active/inactive), skip updating
      // name/email/RoleId so we don't accidentally NULL them out.
      const isToggleOnly =
        discontinue !== undefined &&
        name === undefined &&
        email === undefined &&
        RoleId === undefined &&
        roleId === undefined &&
        can_accept_tickets === undefined;

      if (isToggleOnly) {
        await pool
          .request()
          .input("id", sql.Int, id)
          .input("discontinue", sql.Bit, discontinue ? 1 : 0)
          .query(`UPDATE dbo.users SET discontinue=@discontinue WHERE id=@id`);
      } else {
        const assignedRoleId = Number(RoleId ?? roleId);
        await pool
          .request()
          .input("id", sql.Int, id)
          .input("name", sql.NVarChar, name)
          .input("email", sql.NVarChar, email)
          .input("RoleId", sql.Int, assignedRoleId)
          .input(
            "can_accept_tickets",
            sql.Bit,
            can_accept_tickets === undefined
              ? null
              : can_accept_tickets
                ? 1
                : 0,
          )
          .input("discontinue", sql.Bit, discontinue ? 1 : 0).query(`
          UPDATE dbo.users
          SET name=@name,
              email=@email,
              RoleId=@RoleId,
              role=(SELECT RName FROM dbo.Role WHERE RId = @RoleId),
              discontinue=@discontinue,
              can_accept_tickets=COALESCE(@can_accept_tickets, can_accept_tickets)
          WHERE id=@id
        `);
      }

      // Discontinuing a user must stop their existing tokens immediately,
      // same as an outright delete — re-activating is safe to leave to the
      // cache's own short TTL since there's no urgency there.
      if (discontinue) invalidateUserSession(id).catch(() => {});

      res.json({ message: "User updated" });
    } catch (err) {
      if (
        err.number === 2627 ||
        err.number === 2601 ||
        (err.message && err.message.includes("duplicate key"))
      ) {
        return res
          .status(409)
          .json({ error: "A user with this email address already exists." });
      }
      res.status(500).json({ error: err.message });
    }
  },
);

// ======================
// DELETE USER
// ======================
router.delete(
  "/:id",
  authMiddleware,
  checkPermission("Users", "List", "CanDelete"),
  async (req, res) => {
    const { id } = req.params;
    if (parseInt(id) === req.user?.userId) {
      return res.status(400).json({ error: "Cannot delete yourself" });
    }
    const pool = getPool();
    // Reassignment + NULL-out + ownership-delete + final DELETE must be atomic.
    // Without a transaction, a failure partway (or an unlisted FK) leaves the
    // user half-deleted: some references reassigned to admin, some rows gone,
    // but the user row still present — an inconsistent, hard-to-recover state.
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();

      // Clear nullable audit/assignment references before deleting.
      // Per-user rights rows are deleted because their UserId columns are required.
      // NOT NULL FK columns reassigned to admin; nullable ones set NULL; ownership rows deleted
      await tx
        .request()
        .input("id", sql.Int, id)
        .input("adminId", sql.Int, req.user.userId).query(`
          -- NOT NULL CreatedBy/UserId/AssignedTo: reassign to the deleting admin
          UPDATE dbo.AccountGroup         SET CreatedBy  = @adminId WHERE CreatedBy  = @id;
          UPDATE dbo.BankMaster           SET CreatedBy  = @adminId WHERE CreatedBy  = @id;
          UPDATE dbo.FinYear              SET FCreatedBy = @adminId WHERE FCreatedBy = @id;
          UPDATE dbo.HSN                  SET CreatedBy  = @adminId WHERE CreatedBy  = @id;
          UPDATE dbo.TaskComments         SET UserId     = @adminId WHERE UserId     = @id;
          UPDATE dbo.Tasks                SET AssignedTo = @adminId WHERE AssignedTo = @id;

          -- Nullable audit columns: SET NULL
          UPDATE dbo.AccountGroup         SET UpdatedBy   = NULL WHERE UpdatedBy   = @id;
          UPDATE dbo.AccountGroup         SET ApprovedBy  = NULL WHERE ApprovedBy  = @id;
          UPDATE dbo.BankMaster           SET UpdatedBy   = NULL WHERE UpdatedBy   = @id;
          UPDATE dbo.BankMaster           SET ApprovedBy  = NULL WHERE ApprovedBy  = @id;
          UPDATE dbo.Billing_Terms_Master SET CreatedBy   = NULL WHERE CreatedBy   = @id;
          UPDATE dbo.Billing_Terms_Master SET UpdatedBy   = NULL WHERE UpdatedBy   = @id;
          UPDATE dbo.Billing_Terms_Master SET ApprovedBy  = NULL WHERE ApprovedBy  = @id;
          UPDATE dbo.DebitNote            SET created_by  = NULL WHERE created_by  = @id;
          UPDATE dbo.DebitNote            SET updated_by  = NULL WHERE updated_by  = @id;
          UPDATE dbo.DebitNote            SET approved_by = NULL WHERE approved_by = @id;
          UPDATE dbo.ExpenseBooking       SET ECreatedBy  = NULL WHERE ECreatedBy  = @id;
          UPDATE dbo.ExpenseBooking       SET EApprovedBy = NULL WHERE EApprovedBy = @id;
          UPDATE dbo.FinYear              SET FUpdatedBy  = NULL WHERE FUpdatedBy  = @id;
          UPDATE dbo.FinYear              SET FApprovedBy = NULL WHERE FApprovedBy = @id;
          UPDATE dbo.HSN                  SET UpdatedBy   = NULL WHERE UpdatedBy   = @id;
          UPDATE dbo.HSN                  SET ApprovedBy  = NULL WHERE ApprovedBy  = @id;
          UPDATE dbo.TCMaster             SET CreatedBy   = NULL WHERE CreatedBy   = @id;
          UPDATE dbo.TCMaster             SET UpdatedBy   = NULL WHERE UpdatedBy   = @id;
          UPDATE dbo.TCMaster             SET ApprovedBy  = NULL WHERE ApprovedBy  = @id;
          UPDATE dbo.UOMMaster            SET CreatedBy   = NULL WHERE CreatedBy   = @id;
          UPDATE dbo.UOMMaster            SET UpdatedBy   = NULL WHERE UpdatedBy   = @id;
          UPDATE dbo.UOMMaster            SET ApprovedBy  = NULL WHERE ApprovedBy  = @id;

          -- CRM tables with a real FK to Users — never wired up when the CRM
          -- module was built, so deleting a user ever assigned/referenced on
          -- any of these would hit a live FK violation. All nullable.
          UPDATE dbo.CrmAgreementDocument SET RequestedBy    = NULL WHERE RequestedBy    = @id;
          UPDATE dbo.CrmApplication       SET AssignedTo     = NULL WHERE AssignedTo     = @id;
          UPDATE dbo.CrmBooking           SET AssignedTo     = NULL WHERE AssignedTo     = @id;
          UPDATE dbo.CrmCancellation      SET RequestedBy    = NULL WHERE RequestedBy    = @id;
          UPDATE dbo.CrmCancellation      SET ApprovedBy     = NULL WHERE ApprovedBy     = @id;
          UPDATE dbo.CrmHandover          SET KeyHandoverBy  = NULL WHERE KeyHandoverBy  = @id;
          UPDATE dbo.CrmServiceTicket     SET AssignedTo     = NULL WHERE AssignedTo     = @id;
          UPDATE dbo.CrmSnagItem          SET RaisedBy       = NULL WHERE RaisedBy       = @id;
          UPDATE dbo.CrmSnagItem          SET ResolvedBy     = NULL WHERE ResolvedBy     = @id;
          UPDATE dbo.CrmWelcomeCall       SET CalledBy       = NULL WHERE CalledBy       = @id;

          -- Ownership rows: delete entirely (UserId is NOT NULL in these tables)
          DELETE FROM dbo.UserPageRightsJson WHERE UserId = @id;
          DELETE FROM dbo.UserWidgetRights   WHERE UserId = @id;
        `);

      // All FK references cleared — safe to delete
      const delResult = await tx
        .request()
        .input("id", sql.Int, id)
        .query("DELETE FROM dbo.users WHERE id = @id");

      await tx.commit();

      if (!delResult.rowsAffected[0]) {
        return res.status(404).json({ error: "User not found" });
      }

      // Deleted — any still-valid JWT for this user must stop working on
      // their very next request, not after the auth middleware's cache TTL.
      invalidateUserSession(id).catch(() => {});

      res.json({ message: "User deleted" });
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        /* rollback best-effort — original error is what matters */
      }
      console.error(
        "[DELETE USER] SQL error:",
        err.message,
        "| errNum:",
        err.number,
      );
      res.status(500).json({ error: err.message });
    }
  },
);

// ======================
// PATCH USER PAGE PERMISSIONS
// Called by AuthContext.updateUserPagePermissions()
// Stores the permissions JSON in dbo.UserPageRightsJson
// ======================
router.patch(
  "/:id/permissions",
  authMiddleware,
  checkPermission("Users", "List", "CanEdit"),
  async (req, res) => {
    const { id } = req.params;
    const { pagePermissions } = req.body;

    if (!Array.isArray(pagePermissions)) {
      return res
        .status(400)
        .json({ error: "pagePermissions must be an array" });
    }

    try {
      const pool = getPool();
      const jsonStr = JSON.stringify(pagePermissions);

      await pool
        .request()
        .input("id", sql.Int, id)
        .input("perms", sql.NVarChar(sql.MAX), jsonStr).query(`
          MERGE dbo.UserPageRightsJson AS target
          USING (VALUES (@id, @perms)) AS source (UserId, RightsJson)
          ON target.UserId = source.UserId
          WHEN MATCHED THEN
            UPDATE SET RightsJson = source.RightsJson, UpdatedAt = GETDATE(), IsActive = 1
          WHEN NOT MATCHED THEN
            INSERT (UserId, RightsJson, IsActive, CreatedAt, UpdatedAt)
            VALUES (source.UserId, source.RightsJson, 1, GETDATE(), GETDATE());
        `);

      try {
        const { userPermissionCache } = require("../middleware/permissions");
        userPermissionCache.invalidateUser(id);
      } catch {}

      // Push to this user's active session(s) so their sidebar/menu
      // refreshes immediately — mirrors the same push in
      // routes/userRights.js's PUT /:userId (SAVE permissions) handler,
      // which this route duplicates for the AuthContext caller.
      try {
        require("../socket").getIo().to(`user:${id}`).emit("permissions:updated");
      } catch {
        /* socket.io not initialized (e.g. tests) — no-op */
      }

      res.json({ message: "Permissions updated" });
    } catch (err) {
      console.error("PATCH /users/:id/permissions error:", err);
      res.status(500).json({ error: err.message });
    }
  },
);

// ======================
// PATCH USER TICKET ACCEPTANCE
// ======================
router.patch(
  "/:id/ticket-access",
  authMiddleware,
  checkPermission("Users", "List", "CanEdit"),
  async (req, res) => {
    const { id } = req.params;
    const { can_accept_tickets } = req.body;

    if (typeof can_accept_tickets !== "boolean") {
      return res
        .status(400)
        .json({ error: "can_accept_tickets must be a boolean" });
    }

    try {
      const pool = getPool();
      const result = await pool
        .request()
        .input("id", sql.Int, id)
        .input("can_accept_tickets", sql.Bit, can_accept_tickets ? 1 : 0)
        .query(`
          UPDATE dbo.users
          SET can_accept_tickets = @can_accept_tickets
          WHERE id = @id
        `);

      if (result.rowsAffected?.[0] === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({
        message: "Ticket acceptance updated",
        can_accept_tickets,
      });
    } catch (err) {
      console.error("PATCH /users/:id/ticket-access error:", err);
      res.status(500).json({ error: err.message });
    }
  },
);

// ======================
// RESET USER PASSWORD (admin action - no current password required)
// ======================
router.patch(
  "/:id/reset-password",
  authMiddleware,
  checkPermission("Users", "List", "CanEdit"),
  async (req, res) => {
    const { id } = req.params;
    const { new_password } = req.body;

    if (!new_password || new_password.length < 6) {
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters" });
    }

    try {
      const pool = getPool();
      const hashed = await bcrypt.hash(new_password, SALT_ROUNDS);
      await pool
        .request()
        .input("id", sql.Int, id)
        .input("password", sql.NVarChar, hashed)
        .query("UPDATE dbo.users SET password = @password WHERE id = @id");

      res.json({ message: "Password reset successfully" });
    } catch (err) {
      console.error("PATCH /users/:id/reset-password error:", err);
      res.status(500).json({ error: err.message });
    }
  },
);

module.exports = router;