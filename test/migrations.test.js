const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { splitStatements, DEFAULT_DIR } = require("../lib/migrations");

test("memecah berkas SQL menjadi pernyataan terpisah tanpa komentar", () => {
  const sql = `-- komentar awal\nCREATE TABLE a (id INT);\n\n-- komentar lain\nCREATE TABLE b (id INT);\n`;
  const statements = splitStatements(sql);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /^CREATE TABLE a/);
  assert.match(statements[1], /^CREATE TABLE b/);
});

test("migrasi yang ada bersifat aditif dan idempoten", () => {
  const files = fs.readdirSync(DEFAULT_DIR).filter((f) => f.endsWith(".sql"));
  assert.ok(files.length >= 2, "harus ada berkas migrasi");
  for (const file of files) {
    const sql = fs.readFileSync(path.join(DEFAULT_DIR, file), "utf8");
    const statements = splitStatements(sql);
    assert.ok(statements.length > 0, `${file} tidak boleh kosong`);
    for (const statement of statements) {
      assert.doesNotMatch(statement, /^\s*(drop|truncate)\b/i);
      assert.match(statement, /IF NOT EXISTS|ALTER TABLE/i, `${file} harus idempoten`);
    }
  }
});

function fakePool(applied = []) {
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      if (/^SELECT version FROM schema_migrations/.test(sql.trim()))
        return [applied.map((version) => ({ version }))];
      if (/ORDER BY version DESC/.test(sql))
        return [[{ version: applied[applied.length - 1] || null }]];
      return [[]];
    },
  };
}

test("menjalankan migrasi yang belum diterapkan dan mencatatnya", async () => {
  const { runMigrations } = require("../lib/migrations");
  const pool = fakePool();
  const result = await runMigrations({ pool });
  assert.deepEqual(result.ran, ["001_baseline.sql", "002_usage_logs.sql"]);
  assert.equal(result.total, 2);
  const inserts = pool.queries.filter((q) => /INSERT INTO schema_migrations/.test(q.sql));
  assert.equal(inserts.length, 2);
  assert.deepEqual(inserts[0].params, ["001_baseline.sql"]);
});

test("melewati migrasi yang sudah tercatat sehingga data lama aman", async () => {
  const { runMigrations } = require("../lib/migrations");
  const pool = fakePool(["001_baseline.sql"]);
  const result = await runMigrations({ pool });
  assert.deepEqual(result.ran, ["002_usage_logs.sql"]);
  const touched = pool.queries.some((q) => /conversations \(/.test(q.sql));
  assert.equal(touched, false);
});

test("menolak migrasi destruktif sebelum dijalankan", async () => {
  const fsx = require("node:fs");
  const os = require("node:os");
  const { runMigrations } = require("../lib/migrations");
  const dir = fsx.mkdtempSync(path.join(os.tmpdir(), "nalar-mig-"));
  fsx.writeFileSync(path.join(dir, "001_bad.sql"), "DROP TABLE conversations;");
  const pool = fakePool();
  await assert.rejects(() => runMigrations({ pool, dir }), /destruktif/);
  const ran = pool.queries.some((q) => /^DROP TABLE/i.test(q.sql));
  assert.equal(ran, false);
});
