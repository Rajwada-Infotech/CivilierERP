// Gate for a single-step approve / reject route: the person must be an approver of `module` in
// Admin → Approval Setup (its roles or named people) — or a super admin, who can approve every
// kind of approval. The shared engine decides (approvalService.isApproverFor); no role list here.
const { isApproverFor } = require("../services/approvalService");

function requireApprover(module, what) {
  return async (req, res, next) => {
    try {
      const userId = Number(req.user?.userId ?? req.user?.id) || null;
      if (await isApproverFor(module, userId, req.user?.role)) return next();
      // "not authorized" is kept in the message: routes and the inbox map it to a 403.
      return res.status(403).json({ error: `You are not authorized to approve ${what} — Approval Setup doesn't name your role or you.` });
    } catch (err) {
      console.error(`[requireApprover] ${module}:`, err.message);
      return res.status(500).json({ error: "Could not check your approval rights" });
    }
  };
}

module.exports = { requireApprover };
