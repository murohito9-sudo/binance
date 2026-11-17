"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_DIR = path.join(__dirname, "..", "db", "migrations");

/**
 * Splits a .sql file into individual statements. Line comments are removed;
 * the schema in this project never contains a semicolon inside a string
 * literal, so a simple terminator split is sufficient and predictable.
 */
function splitStatements(sql) {
  return String(sql || "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*--/.test(line))
    .join("\n")
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/**
 * Applies pending migrations in filename order and records each one in
 * `schema_migrations`. Only forward, idempotent statements are allowed: no
 * DROP, no data loss, so existing conversations keep working.
 */
async function runMigrations({ pool, dir = DEFAULT_DIR, logger } = {}) {
  if (!pool) throw new Error("Pool database belum tersedia.");
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(120) NOT NULL PRIMARY KEY,
    applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  const [rows] = await pool.query("SELECT version FROM schema_migrations");
  const applied = new Set(rows.map((row) => row.version));

  let files = [];
  try {
    files = (await fs.readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  } catch (error) {
    throw new Error(`Folder migrasi tidak dapat dibaca: ${error.message}`);
  }

  const ran = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await fs.readFile(path.join(dir, file), "utf8");
    const statements = splitStatements(sql);
    for (const statement of statements) {
      if (/^\s*(drop|truncate)\b/i.test(statement))
        throw new Error(
          `Migrasi ${file} memuat perintah destruktif; hentikan dan tinjau manual.`,
        );
      await pool.query(statement);
    }
    await pool.query(
      "INSERT INTO schema_migrations (version) VALUES (?)",
      [file],
    );
    ran.push(file);
    logger?.info("db.migration_applied", { file, statements: statements.length });
  }

  const [latest] = await pool.query(
    "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
  );
  return { ran, applied: files.filter((f) => applied.has(f)), current: latest[0]?.version || null, total: files.length };
}

module.exports = { runMigrations, splitStatements, DEFAULT_DIR };
