import fs from "fs";
import path from "path";

function loadOpenApiSpec() {
  const candidates = [
    path.resolve(__dirname, "../openapi.json"),
    path.resolve(process.cwd(), "openapi.json"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return JSON.parse(fs.readFileSync(candidate, "utf8"));
    }
  }

  throw new Error(`openapi.json not found in ${candidates.join(", ")}`);
}

// Keep the JSON loading in one place so Fastify and docs tooling use the same
// service-owned OpenAPI contract without duplicating endpoint metadata in code.
export default loadOpenApiSpec();
