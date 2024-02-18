# gratheon / gate-video-stream
Main video processng microservice.

- Converts webm videos to mp4 for HLS playback
- Uploads short 10s video segments to S3 for long-term storage
- Posts video to inference
- Stores detected results in DB


### API
- Exposes /hls REST endpoint for video playback in web-app
- Exposes /graphql endpoint to upload short 10s videos from hive entrances

### URLs
- localhost:8900 - graphql endpoint
- localhost:8950 - hls/REST endpoint

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

### Database
- Stream - video session that has multiple 10s segments. 
- Segment - part of the stream. Contains statistics on found bees coming in/out.

### Development
```
make start
```