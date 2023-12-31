# gratheon / gate-video-stream
Main video processng microservice.

- Exposes /graphql endpoint to upload short 5s videos from hive entrances
- Uploads it to S3 for long-term storage
- Posts video to inference
- Stores results in DB
- Exposes /hls REST endpoint for video playback in web-app

### URLs
localhost:8900

## Architecture

```mermaid
flowchart LR
	web-app --"upload /graphql"--> gate-video-stream --"store for re-training with 1 month TTL"--> S3
	web-app --"get /hls video playlist"--> gate-video-stream
	raspberry-pi-client("<a href='https://github.com/Gratheon/raspberry-pi-client'>raspberry-pi-client</a>") --"upload"--> gate-video-stream
	gate-video-stream --"store unprocessed files" --> mysql
 	gate-video-stream --"[worker] inference unprocessed file" --> models-gate-tracker
	gate-video-stream --"[worker] store results long-term" --> mysql
	gate-video-stream -- "[worker] post results as events" --> redis --> event-stream-filter
        

    web-app("<a href='https://github.com/Gratheon/web-app'>web-app</a>\n:8080") --> graphql-router("<a href='https://github.com/Gratheon/graphql-router'>graphql-router</a>") --"list video stream URLs"--> gate-video-stream("<a href='https://github.com/Gratheon/gate-video-stream'>gate-video-stream</a>\n:8900") -- "get data for playback" --> mysql

```

### Development
```
make start
```
