// dbo.users.WhatsAppNo arrives with migration 624. The users list / create / edit ask first, so they keep working on a server
// where it has not run yet. A "yes" is cached for good; a "no" is re-checked after a minute (no restart needed).
let cached = false;
let checkedNoAt = 0;

async function usersHaveWhatsApp(pool) {
  if (cached) return true;
  if (Date.now() - checkedNoAt < 60_000) return false;
  const r = await pool.request().query("SELECT COL_LENGTH('dbo.users', 'WhatsAppNo') AS len");
  if (r.recordset[0]?.len != null) return (cached = true);
  checkedNoAt = Date.now();
  return false;
}

// Keep digits and a leading +, at most 20 characters; empty → null.
const cleanWhatsApp = (v) => {
  const s = String(v ?? "").trim().replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "").slice(0, 20);
  return s || null;
};

module.exports = { usersHaveWhatsApp, cleanWhatsApp };
