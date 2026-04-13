import { execSync } from 'child_process';
import dotenv from 'dotenv';
import { sql, connectDB, getPool } from './backend/db.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, 'backend/.env') });

const main = async () => {
  let pool;
  try {
    await connectDB();
    pool = getPool();
    
    // Read migration SQL
    const sqlPath = path.join(__dirname, 'backend/migrations/005-create-roles-table.sql');
    const sqlContent = await fs.readFile(sqlPath, 'utf8');
    
    console.log('Executing migration...');
    const result = await pool.request().query(sqlContent);
    console.log('Migration result:', result.output || result.recordsets || 'Success');
    
    // Check table
    const check = await pool.request().query("SELECT COUNT(*) as cnt FROM sys.tables WHERE name = 'Roles'");
    console.log('Roles table exists:', check.recordset[0].cnt > 0 ? 'YES' : 'NO');
    
    // Row count
    const rowCount = await pool.request().query("SELECT COUNT(*) as cnt FROM Roles");
    console.log('Current rows:', rowCount.recordset[0].cnt);
    
    // Samples if empty
    if (rowCount.recordset[0].cnt === 0) {
      await pool.request().query(`
        INSERT INTO Roles (RName, RCode, RDesc, RCreatedBy) VALUES
        ('Admin', 'ADM', 'System Administrator', 'system'),
        ('Super Admin', 'SA', 'Highest privilege user', 'system'),
        ('DBA', 'DBA', 'Database Administrator', 'system'),
        ('User', 'USR', 'Standard User', 'system')
      `);
      console.log('Sample data inserted.');
    }
    
    // Test
    const test = await pool.request().query('SELECT TOP 3 * FROM Roles ORDER BY RId DESC');
    console.log('Test roles:', test.recordset);
    
    console.log('\n✅ FIXED! /api/roles ready. Delete this script after use.');
  } catch (err) {
    console.error('❌ Failed:', err.message);
  }
};

main();

