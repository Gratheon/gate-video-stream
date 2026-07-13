#!/bin/sh
set -eu

CONTAINER_NAME="${CONTAINER_NAME:-gate-video-stream_gate-video-stream_1}"
EXPECTED_PROJECT="${EXPECTED_PROJECT:-gate-video-stream}"
EXPECTED_WORKING_DIR="${EXPECTED_WORKING_DIR:-/www/gate-video-stream}"
SCHEMA_REGISTRY_URL="${SCHEMA_REGISTRY_URL:-http://127.0.0.1:3000/schema/latest}"
VERIFY_ATTEMPTS="${VERIFY_ATTEMPTS:-45}"
VERIFY_INTERVAL_SECONDS="${VERIFY_INTERVAL_SECONDS:-2}"

actual_project=$(docker inspect "$CONTAINER_NAME" --format '{{ index .Config.Labels "com.docker.compose.project" }}')
actual_working_dir=$(docker inspect "$CONTAINER_NAME" --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}')
if [ "$actual_project" != "$EXPECTED_PROJECT" ]; then
  echo "Expected $CONTAINER_NAME to use Compose project $EXPECTED_PROJECT, got $actual_project" >&2
  exit 1
fi
if [ "$actual_working_dir" != "$EXPECTED_WORKING_DIR" ]; then
  echo "Expected $CONTAINER_NAME to be deployed from $EXPECTED_WORKING_DIR, got $actual_working_dir" >&2
  exit 1
fi

for attempt in $(seq 1 "$VERIFY_ATTEMPTS"); do
  if curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8900/metrics >/dev/null \
    && curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8950/openapi.json >/dev/null \
    && python3 - "$SCHEMA_REGISTRY_URL" <<'PY'
import json
import sys
import urllib.request

with urllib.request.urlopen(sys.argv[1], timeout=10) as response:
    payload = json.load(response)
schema = next((entry for entry in payload.get("data", []) if entry.get("name") == "gate-video-stream"), None)
if schema is None:
    raise SystemExit("gate-video-stream schema is missing from registry")
if schema.get("url") != "localhost:8900":
    raise SystemExit(f"expected gate-video-stream registry URL localhost:8900, got {schema.get('url')}")
type_defs = schema.get("type_defs", "")
for contract_entry in ("entranceLiveStreamSession", "EntranceLiveStreamSession", "relayDetails"):
    if contract_entry not in type_defs:
        raise SystemExit(f"gate-video-stream schema is missing {contract_entry}")
print("Verified gate-video-stream endpoints and schema registration")
PY
  then
    exit 0
  fi

  if [ "$attempt" -lt "$VERIFY_ATTEMPTS" ]; then
    echo "Waiting for gate-video-stream readiness (attempt $attempt/$VERIFY_ATTEMPTS)..." >&2
    sleep "$VERIFY_INTERVAL_SECONDS"
  fi
done

exit 1
