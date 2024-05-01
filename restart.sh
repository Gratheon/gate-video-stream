cd /www/gate-video-stream/
COMPOSE_PROJECT_NAME=gratheon docker-compose -f docker-compose.prod.yml down

chown www:www-data -R /www/gate-video-stream

# tmp folder for videos
sudo -u www bash -c 'mkdir -p /www/gate-video-stream/tmp'

sudo -u www bash -c 'rm -rf /www/gate-video-stream/app'

# installing dependencies is faster on host than in the image
sudo -u www bash -c 'cd /www/gate-video-stream/ && source ~/.nvm/nvm.sh && nvm use && npm i && npm run build'

COMPOSE_PROJECT_NAME=gratheon docker-compose -f docker-compose.prod.yml up -d --build