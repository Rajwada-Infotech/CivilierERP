// Generates a schema-only DDL script (no data) from the live database using
// catalog views. Output: <outDir>/01-tables.sql, 02-fks.sql, modules/NNNN-*.sql,
// migrations-rows.sql. Read-only against the source DB.
//   node scripts/genBlankSchema.js <outDir>
require("../config/env").loadEnv();
const fs = require("fs");
const path = require("path");
const sql = require("mssql");

const out = path.resolve(process.argv[2] || "./blank-schema");
fs.mkdirSync(path.join(out, "modules"), { recursive: true });
const q = (n) => `[${String(n).replace(/]/g, "]]")}]`;

function typeSql(c) {
  const t = c.type_name;
  if (["varchar", "char", "varbinary", "binary"].includes(t)) return `${t}(${c.max_length === -1 ? "max" : c.max_length})`;
  if (["nvarchar", "nchar"].includes(t)) return `${t}(${c.max_length === -1 ? "max" : c.max_length / 2})`;
  if (["decimal", "numeric"].includes(t)) return `${t}(${c.precision},${c.scale})`;
  if (["datetime2", "time", "datetimeoffset"].includes(t)) return `${t}(${c.scale})`;
  return t;
}

(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER, database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || "1433", 10),
    options: { encrypt: false, trustServerCertificate: true }, requestTimeout: 120000,
  });
  const r = async (s) => (await pool.request().query(s)).recordset;

  const schemas = await r(`SELECT name FROM sys.schemas WHERE schema_id > 4 AND schema_id < 16384 AND name NOT IN ('guest','INFORMATION_SCHEMA','sys')`);
  const tables = await r(`SELECT t.object_id, s.name sch, t.name FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE t.is_ms_shipped=0 ORDER BY s.name,t.name`);
  const cols = await r(`
    SELECT c.object_id, c.column_id, c.name, ty.name type_name, c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity,
           c.is_computed, cc.definition comp_def, cc.is_persisted, ic.seed_value, ic.increment_value,
           dc.name df_name, dc.definition df_def
    FROM sys.columns c JOIN sys.types ty ON ty.user_type_id=c.user_type_id
    LEFT JOIN sys.computed_columns cc ON cc.object_id=c.object_id AND cc.column_id=c.column_id
    LEFT JOIN sys.identity_columns ic ON ic.object_id=c.object_id AND ic.column_id=c.column_id
    LEFT JOIN sys.default_constraints dc ON dc.parent_object_id=c.object_id AND dc.parent_column_id=c.column_id
    ORDER BY c.object_id, c.column_id`);
  const idx = await r(`
    SELECT i.object_id, i.index_id, i.name, i.type_desc, i.is_unique, i.is_primary_key, i.is_unique_constraint, i.filter_definition,
           ic.key_ordinal, ic.is_descending_key, ic.is_included_column, c.name col
    FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
    JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
    WHERE i.type IN (1,2) AND i.object_id IN (SELECT object_id FROM sys.tables WHERE is_ms_shipped=0)
    ORDER BY i.object_id, i.index_id, ic.is_included_column, ic.key_ordinal, ic.index_column_id`);
  const checks = await r(`SELECT parent_object_id oid, name, definition FROM sys.check_constraints`);
  const fks = await r(`
    SELECT fk.name, fk.parent_object_id pid, ps.name psch, pt.name ptab, rs.name rsch, rt.name rtab,
           fk.delete_referential_action da, fk.update_referential_action ua, fkc.constraint_column_id ord, pc.name pcol, rc.name rcol
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id=fk.object_id
    JOIN sys.tables pt ON pt.object_id=fk.parent_object_id JOIN sys.schemas ps ON ps.schema_id=pt.schema_id
    JOIN sys.tables rt ON rt.object_id=fk.referenced_object_id JOIN sys.schemas rs ON rs.schema_id=rt.schema_id
    JOIN sys.columns pc ON pc.object_id=fkc.parent_object_id AND pc.column_id=fkc.parent_column_id
    JOIN sys.columns rc ON rc.object_id=fkc.referenced_object_id AND rc.column_id=fkc.referenced_column_id
    ORDER BY fk.name, fkc.constraint_column_id`);
  const mods = await r(`
    SELECT o.object_id, s.name sch, o.name, o.type, m.definition FROM sys.sql_modules m
    JOIN sys.objects o ON o.object_id=m.object_id JOIN sys.schemas s ON s.schema_id=o.schema_id
    WHERE o.is_ms_shipped=0 AND o.type IN ('V','P','FN','IF','TF','TR') ORDER BY o.type, s.name, o.name`);

  let ddl = schemas.map((s) => `CREATE SCHEMA ${q(s.name)};\nGO\n`).join("");
  const byObj = (arr, k) => arr.reduce((m, x) => ((m[x[k]] ||= []).push(x), m), {});
  const colsBy = byObj(cols, "object_id"), idxBy = byObj(idx, "object_id"), chkBy = byObj(checks, "oid");

  for (const t of tables) {
    const lines = [];
    for (const c of colsBy[t.object_id] || []) {
      if (c.is_computed) { lines.push(`  ${q(c.name)} AS ${c.comp_def}${c.is_persisted ? " PERSISTED" : ""}`); continue; }
      let l = `  ${q(c.name)} ${typeSql(c)}`;
      if (c.is_identity) l += ` IDENTITY(${c.seed_value},${c.increment_value})`;
      if (c.df_name) l += ` CONSTRAINT ${q(c.df_name)} DEFAULT ${c.df_def}`;
      l += c.is_nullable ? " NULL" : " NOT NULL";
      lines.push(l);
    }
    const byIdx = byObj(idxBy[t.object_id] || [], "index_id");
    const post = [];
    for (const rows of Object.values(byIdx)) {
      const f = rows[0];
      const key = rows.filter((x) => !x.is_included_column).map((x) => `${q(x.col)}${x.is_descending_key ? " DESC" : ""}`).join(", ");
      const inc = rows.filter((x) => x.is_included_column).map((x) => q(x.col)).join(", ");
      const clus = f.type_desc === "CLUSTERED" ? "CLUSTERED" : "NONCLUSTERED";
      if (f.is_primary_key) lines.push(`  CONSTRAINT ${q(f.name)} PRIMARY KEY ${clus} (${key})`);
      else if (f.is_unique_constraint) lines.push(`  CONSTRAINT ${q(f.name)} UNIQUE ${clus} (${key})`);
      else post.push(`CREATE ${f.is_unique ? "UNIQUE " : ""}${clus} INDEX ${q(f.name)} ON ${q(t.sch)}.${q(t.name)} (${key})${inc ? ` INCLUDE (${inc})` : ""}${f.filter_definition ? ` WHERE ${f.filter_definition}` : ""};\nGO\n`);
    }
    for (const c of chkBy[t.object_id] || []) lines.push(`  CONSTRAINT ${q(c.name)} CHECK ${c.definition}`);
    ddl += `CREATE TABLE ${q(t.sch)}.${q(t.name)} (\n${lines.join(",\n")}\n);\nGO\n${post.join("")}`;
  }
  fs.writeFileSync(path.join(out, "01-tables.sql"), ddl);

  const fkBy = byObj(fks, "name");
  let fkSql = "";
  for (const rows of Object.values(fkBy)) {
    const f = rows[0], act = ["NO ACTION", "CASCADE", "SET NULL", "SET DEFAULT"];
    fkSql += `ALTER TABLE ${q(f.psch)}.${q(f.ptab)} ADD CONSTRAINT ${q(f.name)} FOREIGN KEY (${rows.map((x) => q(x.pcol)).join(", ")}) REFERENCES ${q(f.rsch)}.${q(f.rtab)} (${rows.map((x) => q(x.rcol)).join(", ")}) ON DELETE ${act[f.da]} ON UPDATE ${act[f.ua]};\nGO\n`;
  }
  fs.writeFileSync(path.join(out, "02-fks.sql"), fkSql);

  mods.forEach((m, i) => fs.writeFileSync(path.join(out, "modules", `${String(i).padStart(4, "0")}-${m.type}-${m.name}.sql`), m.definition + "\nGO\n"));

  const mig = await r(`SELECT name FROM dbo.__Migrations ORDER BY name`).catch(() => []);
  fs.writeFileSync(path.join(out, "03-migrations-rows.sql"), mig.map((x) => `INSERT INTO dbo.__Migrations (name) VALUES (N'${x.name.replace(/'/g, "''")}');`).join("\nGO\n") + "\nGO\n");

  console.log(JSON.stringify({ tables: tables.length, fks: Object.keys(fkBy).length, modules: mods.length, migrations: mig.length, out }));
  await pool.close();
})().catch((e) => { console.error(e); process.exit(1); });
