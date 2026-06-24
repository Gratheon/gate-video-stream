#!/usr/bin/env bash
set -euo pipefail

cd /www/gate-video-stream/

# Production uses host networking, so any stale container from the old default
# compose project keeps ports 8900/8950 busy and prevents the new project from
# starting. Stop both names before rebuilding.
COMPOSE_PROJECT_NAME=gratheon docker-compose -f docker-compose.prod.yml down
COMPOSE_PROJECT_NAME=gate-video-stream docker-compose -f docker-compose.prod.yml down --remove-orphans || true

# tmp folder for videos
mkdir -p /www/gate-video-stream/tmp
rm -rf /www/gate-video-stream/app

# installing dependencies is faster on host than in the image
source ~/.nvm/nvm.sh
nvm install 25
nvm use 25
npm install -g pnpm@10.29.2
pnpm install
pnpm run build

COMPOSE_PROJECT_NAME=gratheon docker-compose -f docker-compose.prod.yml up -d --build
