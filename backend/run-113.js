const fs = require('fs');
const path = require('path');
const { connectDB, getPool } = require('./db');

async function runMigration() {
  try {
    await connectDB();
    const pool = getPool();
    const sqlContent = fs.readFileSync(path.join(__dirname, 'migrations', '113-drop-legacy-gst-pan-columns.sql'), 'utf-8');
    const batches = sqlContent
      .split(/^\s*GO\s*$/im)
      .map((b) => b.trim())
      .filter((b) => b.length > 0);

    for (let i = 0; i < batches.length; i++) {
      console.log(`Executing batch ${i + 1}/${batches.length}...`);
      await pool.request().query(batches[i]);
    }
    console.log('Migration 113 executed successfully.');
  } catch (err) {
    console.error('Error executing migration:', err);
  } finally {
    process.exit(0);
  }
}

runMigration();
