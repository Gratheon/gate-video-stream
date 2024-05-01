cd /www/gate-video-stream/
COMPOSE_PROJECT_NAME=gratheon docker-compose -f docker-compose.prod.yml down

chown www:www-data -R /www/gate-video-stream
sudo -H -u www bash -c 'cd /www/gate-video-stream/' 
COMPOSE_PROJECT_NAME=gratheon docker-compose -f docker-compose.prod.yml up -d --build