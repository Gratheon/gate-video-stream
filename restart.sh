#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="${COMPOSE_PROJECT_NAME:-gate-video-stream}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$ROOT_DIR"

mkdir -p "$ROOT_DIR/tmp"

COMPOSE_PROJECT_NAME="$PROJECT_NAME" docker-compose -f "$COMPOSE_FILE" down --remove-orphans
COMPOSE_PROJECT_NAME="$PROJECT_NAME" docker-compose -f "$COMPOSE_FILE" up -d --build
