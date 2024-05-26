import { sql } from "@databases/mysql";

import { storage } from "./storage";
import config from "../config/index";
import segmentModel from "./segment"

export default {
  generateHlsPlaylist: async function (userId, boxId, streamId) {
    
    const count = await this.getStreamMaxChunk(userId, streamId)

    let segments = ""
    for (let i = 1; i <= count; i++) {
      segments += `#EXTINF:10.0,\n${segmentModel.getUrl(userId, boxId, streamId, i)}\n`
    }

    return `#EXTM3U
#EXT-X-TARGETDURATION:${count * 10}
#EXT-X-VERSION:3
${segments}
#EXT-X-ENDLIST`;

  },

  list: async function (userId, boxIds, active): Promise<[number | null, number]> {
    let streams;
    if (active) {
      streams = await storage().query(
        sql`SELECT id, max_segment as maxSegment, start_time as startTime, box_id as boxId, end_time as endTime, user_id as userId
      FROM streams 
      WHERE user_id=${userId} AND box_id IN (${boxIds}) AND end_time IS NULL
      ORDER BY start_time DESC
      LIMIT 20`
      );
    }
    else {
      streams = await storage().query(
        sql`SELECT id, max_segment as maxSegment, start_time as startTime, box_id as boxId, end_time as endTime, user_id as userId
      FROM streams 
      WHERE user_id=${userId} AND box_id IN (${boxIds})
      ORDER BY start_time DESC
      LIMIT 20`
      );
    }

    for (const row of streams) {
      row.playlistURL = `${config.selfRESTUrl}/hls/${row.userId}/${row.boxId}/${row.id}/playlist.m3u8`
    }

    return streams;
  },
  
  getActiveStreamMaxChunk: async function (userId, boxId, maxStreamTTLSec = 600): Promise<[number | null, number]> {
    const result = await storage().query(
      sql`SELECT id, max_segment
      FROM streams 
      WHERE user_id=${userId} AND box_id=${boxId} AND end_time is NULL AND NOW() - last_upload_time < ${maxStreamTTLSec}
      ORDER BY last_upload_time DESC
      LIMIT 1`
    );

    const rel = result[0];

    if (!rel) {
      return [null, 0]; //lets say it takes 1 sec on avg
    }

    return [rel.id, rel.max_segment];
  },
  getStreamMaxChunk: async function (userId, streamId): Promise<number> {
    const result = await storage().query(
      sql`SELECT id, max_segment
      FROM streams 
      WHERE user_id=${userId} AND id=${streamId}`
    );

    const rel = result[0];

    if (!rel) {
      return 0;
    }

    return rel.max_segment;
  },

  endPreviousBoxStreams: async function (userId, boxId) {
    return (await storage().query(sql`
    UPDATE streams 
    SET end_time = NOW()
    WHERE user_id = ${userId} AND box_id = ${boxId} AND end_time IS NULL`));
  },

  insert: async function (userId, boxId) {
    // @ts-ignore
    return (await storage().query(sql`
    INSERT INTO streams (user_id, box_id, max_segment, start_time, last_upload_time) 
    VALUES (${userId}, ${boxId}, 1, NOW(), NOW());
    SELECT LAST_INSERT_ID() as id;
    `))[0].id;
  },

  increment: async function (userId, streamId) {
    // @ts-ignore
    return (await storage().query(sql`
    UPDATE streams SET max_segment = max_segment + 1, last_upload_time=NOW()
    WHERE user_id=${userId} AND id=${streamId};
    `));
  },
};
