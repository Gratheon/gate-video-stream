cd /www/gate-video-stream/
COMPOSE_PROJECT_NAME=gratheon docker-compose -f docker-compose.prod.yml down

# tmp folder for videos
mkdir -p /www/gate-video-stream/tmp
rm -rf /www/gate-video-stream/app

# installing dependencies is faster on host than in the image
cd /www/gate-video-stream/ && source ~/.nvm/nvm.sh && nvm install 25 && nvm use && npm install -g pnpm@10.29.2 && pnpm install && pnpm run build

COMPOSE_PROJECT_NAME=gratheon docker-compose -f docker-compose.prod.yml up -d --build
