cd /www/gate-video-stream/
COMPOSE_PROJECT_NAME=gratheon docker-compose down

chown www:www-data -R /www/gate-video-stream
sudo -H -u www bash -c 'cd /www/gate-video-stream/' 
COMPOSE_PROJECT_NAME=gratheon docker-compose up -d --build