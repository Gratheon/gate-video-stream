start:
	mkdir -p tmp
	COMPOSE_PROJECT_NAME=gratheon docker compose -f docker-compose.dev.yml up --build
stop:
	COMPOSE_PROJECT_NAME=gratheon docker compose -f docker-compose.dev.yml down
run:
	npm run dev
test:
	
deploy-clean:
	ssh root@gratheon.com 'rm -rf /www/gate-video-stream/app/*;'

deploy-copy:
	rsync -av -e ssh ./migrations docker-compose.yml Dockerfile package.json package-lock.json restart.sh .version ./src root@gratheon.com:/www/gate-video-stream/

deploy-run:
	ssh root@gratheon.com 'chmod +x /www/gate-video-stream/restart.sh'
	ssh root@gratheon.com 'bash /www/gate-video-stream/restart.sh'

deploy:
	git rev-parse --short HEAD > .version
	# make deploy-clean
	make deploy-copy
	make deploy-run