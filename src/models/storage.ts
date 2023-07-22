import createConnectionPool, { sql } from "@databases/mysql";
import tables from "@databases/mysql-typed";
import * as fs from "fs";
import * as crypto from "crypto";

import DatabaseSchema, { serializeValue } from "./__generated__";
import config from "../config/index";

export { sql };

// You can list whatever tables you actually have here:
const { files, files_hive_rel, files_frame_side_rel } = tables<DatabaseSchema>({
  serializeValue,
});

export { files, files_hive_rel, files_frame_side_rel };

// ${sql.join(cols.map(c => sql.ident(c)), `, `)}
let db;
export function storage() {
  return db;
}

export async function initStorage(logger) {
  db = createConnectionPool({
    connectionString: `mysql://${config.mysql.user}:${config.mysql.password}@${config.mysql.host}:${config.mysql.port}/${config.mysql.database}`,
    onQueryError: (_query, { text }, err) => {
      logger.error(
        `DB error ${text} - ${err.message}`
      );
    },
  });

  await migrate(logger);
}

process.once("SIGTERM", () => {
  db.dispose().catch((ex) => {
    console.error(ex);
  });
});

async function migrate(logger) {
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
      logger.log(`Processing DB migration ${file}`);
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

        logger.log(`Successfully executed SQL from ${file}.`);

        // Store the hash in the dedicated table
        await db.query(
          sql`INSERT INTO _db_migrations (hash, filename, executionTime) VALUES (${hash}, ${file}, NOW())`
        );
        logger.info(`Successfully stored hash in executed_sql_hashes table.`);
      } else {
        logger.info(`SQL from ${file} has already been executed. Skipping.`);
      }
    }
  } catch (err) {
    console.error(err);
  }
}
