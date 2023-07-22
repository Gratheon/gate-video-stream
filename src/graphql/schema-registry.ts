import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import config from "../config/index";

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve("package.json"), "utf8")
);

async function postData(url = "", data = {}) {
  // Default options are marked with *
  try {
    const response = await fetch(url, {
      method: "POST",
      //@ts-ignore
      mode: "cors", // no-cors, *cors, same-origin
      cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
      credentials: "same-origin", // include, *same-origin, omit
      headers: {
        "Content-Type": "application/json",
      },
      redirect: "follow", // manual, *follow, error
      referrerPolicy: "no-referrer", // no-referrer, *client
      body: JSON.stringify(data), // body data type must match "Content-Type" header
    });

    if (!response.ok) {
      const result = await response.text();
      console.error(result);
      return false;
    }

    return await response.json(); // parses JSON response into native JavaScript objects
  } catch (e) {
    console.error(e);
    return false;
  }
}

export async function registerSchema(schema, version) {
  await postData(config.schema_registry_url, {
    name: packageJson.name,
    url: config.selfUrl,
    version: process.env.ENV_ID === "dev" ? "latest" : version,
    type_defs: schema,
  });
}
