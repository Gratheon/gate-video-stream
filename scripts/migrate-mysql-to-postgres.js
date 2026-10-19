#!/usr/bin/env node
/*
 * One-off copy of gate-video-stream data from MySQL to Postgres.
 *
 * WHY: the service switched its storage from MySQL to Postgres. Data volume is tiny
 * (tens of thousands of rows), so a plain read-all / batch-insert copy is simpler and
 * more predictable than pgloader (which would create its own schema and types).
 *
 * WHAT it does:
 *   1. applies ./migrations/*.sql to Postgres and records them in _db_migrations
 *      exactly like src/models/storage.ts does, so the service skips them on boot
 *   2. in ONE transaction: truncates target tables, copies every row with its original id,
 *      resets SERIAL sequences, compares row counts (rolls back on mismatch)
 *
 * MySQL is only read, so it stays intact as a rollback target.
 * Re-runnable: each run replaces Postgres table contents with a fresh copy.
 *
 * Run (from the repo root, deps are installed into a throwaway dir):
 *   docker run --rm --network host -v "$PWD":/repo -w /repo \
 *     -e MYSQL_HOST -e MYSQL_PORT -e MYSQL_USER -e MYSQL_PASSWORD -e MYSQL_DATABASE \
 *     -e PG_HOST -e PG_PORT -e PG_USER -e PG_PASSWORD -e PG_DATABASE -e DRY_RUN \
 *     node:24-slim sh -c 'npm i --prefix /tmp/deps mysql2@3 pg@8 >/dev/null && NODE_PATH=/tmp/deps/node_modules node scripts/migrate-mysql-to-postgres.js'
 *
 * DRY_RUN=1 performs the full copy and verification, then rolls the data copy back.
 * FORCE=1 is required when Postgres tables already contain rows (e.g. a second rehearsal),
 * so that a re-run after cutover cannot silently wipe data written by the new service.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mysql = require("mysql2/promise");
const { Client } = require("pg");

// Parents first is not required (no FKs), but keeps the log readable
const TABLES = [
  "streams",
  "segments",
  "entrance_live_devices",
  "entrance_live_sessions",
  "entrance_live_commands",
  "entrance_heatmaps",
];
const BOOLEAN_COLUMNS = new Set(["clip_handoff_enabled"]);
const JSON_COLUMNS = new Set(["heat_grid"]);
const BATCH_SIZE = 1000;
const DRY_RUN = process.env.DRY_RUN === "1";
const FORCE = process.env.FORCE === "1";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env ${name}`);
  }
  return value;
}

function convertValue(column, value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (BOOLEAN_COLUMNS.has(column)) {
    return Number(value) === 1;
  }
  if (JSON_COLUMNS.has(column)) {
    // mysql2 already parses JSON columns; stringify explicitly because node-pg would
    // turn a JS array (old heat_grid format) into a Postgres array literal
    return typeof value === "string" ? value : JSON.stringify(value);
  }
  // MySQL zero dates have no Postgres equivalent
  if (typeof value === "string" && value.startsWith("0000-00-00")) {
    return null;
  }
  return value;
}

async function applyMigrations(pg) {
  await pg.query(`CREATE TABLE IF NOT EXISTS _db_migrations (
      hash VARCHAR(255),
      filename VARCHAR(255),
      execution_time TIMESTAMPTZ
    );`);

  const dir = path.join(process.cwd(), "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), "utf8");
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    const { rows } = await pg.query(
      "SELECT 1 FROM _db_migrations WHERE filename = $1 OR hash = $2 LIMIT 1",
      [file, hash]
    );
    if (rows.length > 0) {
      console.log(`migration ${file}: already applied`);
      continue;
    }
    await pg.query("BEGIN");
    try {
      await pg.query(content);
      await pg.query(
        "INSERT INTO _db_migrations (hash, filename, execution_time) VALUES ($1, $2, NOW())",
        [hash, file]
      );
      await pg.query("COMMIT");
      console.log(`migration ${file}: applied`);
    } catch (err) {
      await pg.query("ROLLBACK");
      throw err;
    }
  }
}

async function pgColumns(pg, table) {
  const { rows } = await pg.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position",
    [table]
  );
  return rows.map((r) => r.column_name);
}

async function copyTable(my, pg, table) {
  const [sourceRows] = await my.query(`SELECT * FROM \`${table}\` ORDER BY 1`);
  const targetColumns = await pgColumns(pg, table);
  const sourceColumns = sourceRows.length > 0 ? Object.keys(sourceRows[0]) : targetColumns;

  // Fail loudly instead of silently dropping data if schemas drifted
  const missing = sourceColumns.filter((c) => !targetColumns.includes(c));
  if (missing.length > 0) {
    throw new Error(`${table}: columns missing in Postgres: ${missing.join(", ")}`);
  }

  const columns = sourceColumns;
  const columnList = columns.map((c) => `"${c}"`).join(", ");

  for (let offset = 0; offset < sourceRows.length; offset += BATCH_SIZE) {
    const batch = sourceRows.slice(offset, offset + BATCH_SIZE);
    const params = [];
    const tuples = batch.map((row) => {
      const placeholders = columns.map((column) => {
        params.push(convertValue(column, row[column]));
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await pg.query(`INSERT INTO "${table}" (${columnList}) VALUES ${tuples.join(", ")}`, params);
  }

  return sourceRows.length;
}

async function main() {
  const my = await mysql.createConnection({
    host: requireEnv("MYSQL_HOST"),
    port: Number(process.env.MYSQL_PORT || 3306),
    user: requireEnv("MYSQL_USER"),
    password: requireEnv("MYSQL_PASSWORD"),
    database: requireEnv("MYSQL_DATABASE"),
    // Keep DATETIME/DATE as raw strings: no JS timezone conversion on the way through
    dateStrings: true,
    timezone: "Z",
    supportBigNumbers: true,
  });

  const pg = new Client({
    host: requireEnv("PG_HOST"),
    port: Number(process.env.PG_PORT || 5432),
    user: requireEnv("PG_USER"),
    password: requireEnv("PG_PASSWORD"),
    database: requireEnv("PG_DATABASE"),
    // DigitalOcean managed Postgres needs TLS; its CA is not in the default trust store
    ssl: process.env.PG_SSL === "disable" ? false : { rejectUnauthorized: false },
  });
  await pg.connect();

  try {
    // MySQL DATETIME has no zone: values were written with NOW() in the server zone, so
    // reading them as UTC is only correct if that zone is UTC. Abort instead of shifting data.
    const [[tz]] = await my.query("SELECT @@global.time_zone AS global_tz, @@system_time_zone AS system_tz");
    console.log(`MySQL time zone: global=${tz.global_tz} system=${tz.system_tz}`);
    const isUtc = (zone) => ["UTC", "+00:00", "Etc/UTC"].includes(zone);
    if (!(isUtc(tz.global_tz) || (tz.global_tz === "SYSTEM" && isUtc(tz.system_tz)))) {
      throw new Error("MySQL server time zone is not UTC; DATETIME values would be shifted");
    }
    await pg.query("SET TIME ZONE 'UTC'");

    await applyMigrations(pg);

    const existing = [];
    for (const table of TABLES) {
      const { rows } = await pg.query(`SELECT COUNT(*)::int AS cnt FROM "${table}"`);
      if (rows[0].cnt > 0) {
        existing.push(`${table}=${rows[0].cnt}`);
      }
    }
    if (existing.length > 0) {
      console.log(`Postgres already has rows: ${existing.join(", ")}`);
      if (!FORCE) {
        throw new Error("Refusing to truncate non-empty Postgres tables without FORCE=1");
      }
    }

    await pg.query("BEGIN");
    await pg.query(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY`);

    const summary = [];
    for (const table of TABLES) {
      const copied = await copyTable(my, pg, table);
      const [[{ cnt: mysqlCount }]] = await my.query(`SELECT COUNT(*) AS cnt FROM \`${table}\``);
      const { rows } = await pg.query(`SELECT COUNT(*)::int AS cnt FROM "${table}"`);
      const pgCount = rows[0].cnt;

      // Only SERIAL tables have a sequence (entrance_live_sessions uses a varchar id)
      const { rows: seqRows } = await pg.query("SELECT pg_get_serial_sequence($1, 'id') AS seq", [table]);
      // setval is not transactional, so a dry run must not touch sequences
      if (seqRows[0].seq && !DRY_RUN) {
        await pg.query(
          `SELECT setval($1, COALESCE((SELECT MAX(id) FROM "${table}"), 1), (SELECT MAX(id) IS NOT NULL FROM "${table}"))`,
          [seqRows[0].seq]
        );
      }

      summary.push({ table, copied, mysqlCount: Number(mysqlCount), pgCount });
    }

    console.table(summary);
    const mismatches = summary.filter((s) => s.mysqlCount !== s.pgCount);
    if (mismatches.length > 0) {
      throw new Error(`Row count mismatch: ${mismatches.map((m) => m.table).join(", ")}`);
    }

    if (DRY_RUN) {
      await pg.query("ROLLBACK");
      console.log("DRY_RUN=1: copy verified and rolled back (schema migrations stay applied)");
    } else {
      await pg.query("COMMIT");
      console.log("Data copy committed");
    }
  } catch (err) {
    await pg.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await my.end();
    await pg.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
