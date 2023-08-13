import { sql } from "@databases/mysql";

import { storage } from "./storage";
import config from "../config/index";

export default {
  list: async function (userId, boxIds, active): Promise<[number | null, number]> {
    let streams;
    if (active) {
      streams = await storage().query(
        sql`SELECT id, max_segment as maxSegment, start_time as startTime, box_id as boxId, end_time as endTime
      FROM streams 
      WHERE user_id=${userId} AND box_id IN (${boxIds}) AND end_time IS NULL`
      );
    }
    else {
      streams = await storage().query(
        sql`SELECT id, max_segment as maxSegment, start_time as startTime, box_id as boxId, end_time as endTime
      FROM streams 
      WHERE user_id=${userId} AND box_id IN (${boxIds}) `
      );
    }

    for (const row of streams) {
      row.manifest = this.generateManifest(
        `${config.files_base_url}${userId}/gate_videos/${row.boxId}/${row.id}/`,
        row.maxSegment
      )
    }

    return streams;
  },
  getMaxChunk: async function (userId, boxId): Promise<[number | null, number]> {
    const result = await storage().query(
      sql`SELECT id, max_segment
      FROM streams 
      WHERE user_id=${userId} AND box_id=${boxId} AND NOW() - last_upload_time < 60`
    );

    const rel = result[0];

    if (!rel) {
      return [null, 0]; //lets say it takes 1 sec on avg
    }

    return [rel.id, rel.max_segment];
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

  increment: async function (userId, boxId) {
    // @ts-ignore
    return (await storage().query(sql`
    UPDATE streams SET max_segment = max_segment + 1, last_upload_time=NOW()
    WHERE user_id=${userId} AND box_id=${boxId};
    `));
  },

  generateManifest: function (baseUrl, segmentCount=1) {
    const durationSec = segmentCount * 5
    const manifestTemplate = `<?xml version="1.0" encoding="utf-8"?>
    <MPD xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
      xmlns="urn:mpeg:dash:schema:mpd:2011"
      xmlns:xlink="http://www.w3.org/1999/xlink"
      xsi:schemaLocation="urn:mpeg:DASH:schema:MPD:2011 http://standards.iso.org/ittf/PubliclyAvailableStandards/MPEG-DASH_schema_files/DASH-MPD.xsd"
      profiles="urn:mpeg:dash:profile:isoff-live:2011"
      type="static" 
      minBufferTime="PT1.500S"
      mediaPresentationDuration="PT${durationSec}S">
        <BaseURL>${baseUrl}</BaseURL>
        <Period id="0" start="PT0.0S">
          <AdaptationSet id="1" contentType="video" segmentAlignment="true" subsegmentAlignment="true" subsegmentStartsWithSAP="1" par="16:9">
            <Representation id="1" mimeType="video/mp4" codecs="avc1.42c01e">
              <SegmentTemplate 
                initialization="1.mp4"
                media="$Number$.mp4" startNumber="1" timescale="1000" duration="5000"/>
            </Representation>
          </AdaptationSet>
        </Period>
      </MPD>
    `;
    const encodedManifest = btoa(manifestTemplate); // Base64 encode the manifest
    return encodedManifest;
  }
};
