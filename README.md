# gratheon / gate-video-stream
Main video processng microservice.

- Exposes /graphql endpoint to upload short 5s videos from hive entrances
- Uploads it to S3 for long-term storage
- Exposes /hls REST endpoint for video playback in web-app
- [TODO] Posts video to inference

### URLs
localhost:8900

## Architecture

```mermaid
flowchart LR
	web-app --"upload /graphql"--> gate-video-stream --"store for re-training with 1 month TTL"--> S3
	web-app --"get /hls video playlist"--> gate-video-stream
	raspberry-pi-client("<a href='https://github.com/Gratheon/raspberry-pi-client'>raspberry-pi-client</a>") --"upload"--> gate-video-stream
	gate-video-stream --"store unprocessed files" --> mysql
 	gate-video-stream --"inference unprocessed file" --> models-gate-tracker -- "post results" --> redis --> event-stream-filter
	gate-video-stream --"store results long-term" --> mysql
        

    web-app("<a href='https://github.com/Gratheon/web-app'>web-app</a>\n:8080") --> graphql-router("<a href='https://github.com/Gratheon/graphql-router'>graphql-router</a>") --"list video stream URLs"--> gate-video-stream("<a href='https://github.com/Gratheon/gate-video-stream'>gate-video-stream</a>\n:8900") -- "get data for playback" --> mysql

```

### Development
```
make start
```
