# gratheon / gate-video-stream
Main backend video processng microservice.
In UI videos are uploaded from this component:
![Screenshot 2024-05-01 at 23 39 40](https://github.com/Gratheon/gate-video-stream/assets/445122/c1d211e7-d686-4930-8957-0133f612bb57)

## Features
- Converts webm videos to mp4 for HLS playback
- Uploads short 10s video segments to S3 for long-term storage
- Stores some results in mysql db
- Theoretically can post videos to be inferenced, but not in use yet as we don't have GPU hosting enabled. Relying on edge devices for now.

## Limits
Max - 40 MB video file size limit.

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
	beehive-entrance-video-processor --"upload video chunk"--> gate-video-stream
	gate-video-stream --"store unprocessed files" --> mysql

    web-app("<a href='https://github.com/Gratheon/web-app'>web-app</a>\n:8080") --> graphql-router("<a href='https://github.com/Gratheon/graphql-router'>graphql-router</a>") --"list video stream URLs"--> gate-video-stream("<a href='https://github.com/Gratheon/gate-video-stream'>gate-video-stream</a>\n:8900") -- "get data for playback" --> mysql

	beehive-entrance-video-processor("<a href='https://github.com/Gratheon/beehive-entrance-video-processor'>beehive-entrance-video-processor</a>") --"get next unprocessed video segment"--> gate-video-stream
	beehive-entrance-video-processor --"inference unprocessed file" --> models-gate-tracker
	beehive-entrance-video-processor --"send inference results"--> gate-video-stream -- "store results long-term" --> mysql
	gate-video-stream -- "post results as events" --> redis --> event-stream-filter

```

### Database
- Stream - video session that has multiple 10s segments. 
- Segment - part of the stream. Contains statistics on found bees coming in/out.

### Development
```
make start
```
