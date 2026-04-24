// Run this from your backend folder: node fix-passwords.js
// It will bcrypt-hash any plaintext passwords in dbo.users

require("dotenv").config();
const sql = require("mssql");
const bcrypt = require("bcrypt");

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  options: { encrypt: false, trustServerCertificate: true },
};

const SALT_ROUNDS = 12;

// Passwords that are clearly NOT bcrypt hashes (bcrypt always starts with $2b$)
function isPlaintext(pwd) {
  if (!pwd) return false;
  return !pwd.startsWith("$2b$") && !pwd.startsWith("$2a$");
}

async function run() {
  console.log("Connecting to SQL Server...");
  const pool = await sql.connect(config);
  console.log("Connected.\n");

  const result = await pool.request().query(`
    SELECT id, name, email, password, RoleId
    FROM dbo.users
    ORDER BY id
  `);

  const users = result.recordset;
  console.log(`Found ${users.length} users:\n`);

  for (const user of users) {
    const plain = isPlaintext(user.password);
    console.log(
      `  [${user.id}] ${user.email} - password ${plain ? "PLAINTEXT [WARN]" : "hashed [OK]"}`,
    );
  }

  console.log("\nFixing plaintext passwords...\n");

  for (const user of users) {
    if (!isPlaintext(user.password)) continue;

    const hashed = await bcrypt.hash(user.password, SALT_ROUNDS);
    await pool
      .request()
      .input("id", sql.Int, user.id)
      .input("pwd", sql.NVarChar, hashed)
      .query("UPDATE dbo.users SET password = @pwd WHERE id = @id");

    console.log(`  [OK] [${user.id}] ${user.email} - hashed "${user.password}"`);
  }

  // Also fix NULL RoleId rows — assign them to 'user' role
  const roleResult = await pool.request().query(`
    SELECT TOP 1 RId FROM dbo.Role
    WHERE LOWER(RName) IN ('user', 'standard user', 'employee')
    ORDER BY RId ASC
  `);

  if (roleResult.recordset.length > 0) {
    const userRoleId = roleResult.recordset[0].RId;
    const nullFixed = await pool
      .request()
      .input("roleId", sql.Int, userRoleId)
      .query("UPDATE dbo.users SET RoleId = @roleId WHERE RoleId IS NULL");
    console.log(
      `\n  [OK] Fixed ${nullFixed.rowsAffected[0]} users with NULL RoleId -> RoleId ${userRoleId}`,
    );
  }

  console.log("\nDone. All users can now log in.");
  await pool.close();
}

run().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

