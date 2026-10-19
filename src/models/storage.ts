import createConnectionPool, { sql } from "@databases/pg";
import * as fs from "fs";
import * as crypto from "crypto";

import config from "../config/index";

import { logger } from "../logger";
import { recordDbQuery } from "../metrics";

// WHY: config.prod.ts replaces the whole postgres section, so pool limits are read with env and default fallbacks here
function positiveInt(value: unknown, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return parsed >= 1 ? parsed : fallback;
}

export { sql };

let db;

function extractQueryText(query: unknown): string {
  if (typeof query === "string") {
    return query;
  }

  if (query && typeof query === "object" && "text" in query) {
    const text = (query as { text?: unknown }).text;
    if (typeof text === "string") {
      return text;
    }
  }

  return "unknown";
}

function normalizeQueryShape(sqlText: string): string {
  if (!sqlText || sqlText === "unknown") {
    return "unknown";
  }

  const normalized = sqlText
    .toLowerCase()
    .replace(/'[^']*'/g, "?")
    .replace(/"[^"]*"/g, "?")
    .replace(/\b\d+(\.\d+)?\b/g, "?")
    .replace(/\s+/g, " ")
    .trim();

  return normalized.slice(0, 180) || "unknown";
}

function getQueryOperation(sqlText: string): string {
  const match = sqlText.trim().match(/^[a-z]+/i);
  return match ? match[0].toUpperCase() : "UNKNOWN";
}

function instrumentDbQueryMetrics(pool: any) {
  const originalQuery = pool.query.bind(pool);

  pool.query = async (query: unknown, ...args: unknown[]) => {
    const start = process.hrtime.bigint();
    const queryText = extractQueryText(query);
    const operation = getQueryOperation(queryText);
    const queryShape = normalizeQueryShape(queryText);

    try {
      const result = await originalQuery(query, ...args);
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1_000_000_000;
      recordDbQuery({
        operation,
        queryShape,
        status: "success",
        durationSeconds,
      });
      return result;
    } catch (error) {
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1_000_000_000;
      recordDbQuery({
        operation,
        queryShape,
        status: "error",
        durationSeconds,
      });
      throw error;
    }
  };
}

export function storage() {
  return db;
}

export async function initStorage(storageLogger) {
  const { user, password, host, port, database, ssl } = config.postgres;

  // WHY: unlike MySQL, Postgres has no CREATE DATABASE IF NOT EXISTS, and the prod
  // database lives on a managed cluster where it is provisioned manually.
  db = createConnectionPool({
    connectionString: `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`,
    // DigitalOcean managed Postgres requires TLS; "prefer" also works with the local dev container without TLS.
    ssl: ssl as any,
    bigIntMode: "number",
    // The managed Postgres cluster is shared by all services and has ~22 usable slots
    poolSize: positiveInt(config.postgres.poolSize ?? process.env.DB_POOL_SIZE, 2),
    idleTimeoutMilliseconds: positiveInt(config.postgres.idleTimeoutMilliseconds ?? process.env.DB_IDLE_TIMEOUT_MS, 10000),
    onQueryError: (_query, { text }, err) => {
      storageLogger.error(
        `DB error ${text} - ${err.message}`
      );
    },
  });
  instrumentDbQueryMetrics(db);

  await migrate(storageLogger);
}

process.once("SIGTERM", () => {
  db?.dispose().catch((ex) => {
    logger.error(ex);
  });
});

async function migrate(storageLogger) {
  try {
    await db.query(sql`CREATE TABLE IF NOT EXISTS _db_migrations (
      hash VARCHAR(255),
      filename VARCHAR(255),
      execution_time TIMESTAMPTZ
    );`);

    const files = await fs.promises.readdir("./migrations");

    // Sorted so that migrations run in a deterministic order (readdir order is not guaranteed)
    const sqlFiles = files
      .filter((file) => file.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b));

    for (const file of sqlFiles) {
      storageLogger.info(`Processing DB migration ${file}`);
      const sqlStatement = await fs.promises.readFile(
        `./migrations/${file}`,
        "utf8"
      );

      const hash = crypto
        .createHash("sha256")
        .update(sqlStatement)
        .digest("hex");

      // Matched by filename too: editing an applied migration does NOT re-run it, add a new file instead
      const rows = await db.query(
        sql`SELECT * FROM _db_migrations WHERE filename = ${file} OR hash = ${hash} LIMIT 1`
      );

      if (rows.length === 0) {
        // Postgres supports transactional DDL, so a failed migration leaves no partial schema behind
        await db.tx(async (dbi) => {
          await dbi.query(sql.file(`./migrations/${file}`));
          await dbi.query(
            sql`INSERT INTO _db_migrations (hash, filename, execution_time) VALUES (${hash}, ${file}, NOW())`
          );
        });

        storageLogger.info(`Successfully executed SQL from ${file}.`);
      } else {
        storageLogger.info(`SQL from ${file} has already been executed. Skipping.`);
      }
    }
  } catch (err) {
    logger.error(err);
    // Fail fast: starting the service against a half-migrated schema hides the problem
    throw err;
  }
}
