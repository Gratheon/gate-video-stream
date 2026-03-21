import createConnectionPool, { sql } from "@databases/mysql";
import tables from "@databases/mysql-typed";
import * as fs from "fs";
import * as crypto from "crypto";

import DatabaseSchema, { serializeValue } from "./__generated__";
import config from "../config/index";
import { logger } from "../logger";
import { recordDbQuery } from "../metrics";

export { sql };

// You can list whatever tables you actually have here:
const { files, files_hive_rel, files_frame_side_rel } = tables<DatabaseSchema>({
  serializeValue,
});

export { files, files_hive_rel, files_frame_side_rel };

// ${sql.join(cols.map(c => sql.ident(c)), `, `)}
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
  const conn = createConnectionPool(
    `mysql://${config.mysql.user}:${config.mysql.password}@${config.mysql.host}:${config.mysql.port}/`
  );

  await conn.query(sql`
  CREATE DATABASE IF NOT EXISTS \`gate-video-stream\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
`);

  db = createConnectionPool({
    connectionString: `mysql://${config.mysql.user}:${config.mysql.password}@${config.mysql.host}:${config.mysql.port}/${config.mysql.database}`,
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
  db.dispose().catch((ex) => {
    logger.error(ex);
  });
});

async function migrate(storageLogger) {
  try {
    await db.query(sql`CREATE TABLE IF NOT EXISTS _db_migrations (
		hash VARCHAR(255),
		filename VARCHAR(255),
		executionTime DATETIME
	  );
`);

    // List the directory containing the .sql files
    const files = await fs.promises.readdir("./migrations");

    // Filter the array to only include .sql files
    const sqlFiles = files.filter((file) => file.endsWith(".sql"));

    // Read each .sql file and execute the SQL statements
    for (const file of sqlFiles) {
      storageLogger.info(`Processing DB migration ${file}`);
      const sqlStatement = await fs.promises.readFile(
        `./migrations/${file}`,
        "utf8"
      );

      // Hash the SQL statements
      const hash = crypto
        .createHash("sha256")
        .update(sqlStatement)
        .digest("hex");

      // Check if the SQL has already been executed by checking the hashes in the dedicated table
      const rows = await db.query(
        sql`SELECT * FROM _db_migrations WHERE hash = ${hash}`
      );

      // If the hash is not in the table, execute the SQL and store the hash in the table
      if (rows.length === 0) {
        await db.query(sql.file(`./migrations/${file}`));

        storageLogger.info(`Successfully executed SQL from ${file}.`);

        // Store the hash in the dedicated table
        await db.query(
          sql`INSERT INTO _db_migrations (hash, filename, executionTime) VALUES (${hash}, ${file}, NOW())`
        );
        storageLogger.info(`Successfully stored hash in executed_sql_hashes table.`);
      } else {
        storageLogger.info(`SQL from ${file} has already been executed. Skipping.`);
      }
    }
  } catch (err) {
    logger.error(err);
  }
}
