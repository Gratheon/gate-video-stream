import { sql } from "@databases/mysql";

import { storage } from "./storage";
import config from "../config/index";
import internal from "stream";

export default {
  getMaxChunk: async function (userId, boxId): Promise<[number|null, number]> {
    const result = await storage().query(
      sql`SELECT id, max_segment
      FROM video_streams 
      WHERE user_id=${userId} AND box_id=${boxId} AND NOW() - date_start < 60`
    );

    console.log('db result', result)
    const rel = result[0];

    if (!rel) {
      return [null, 0]; //lets say it takes 1 sec on avg
    }

    return [rel.id, rel.max_segment];
  },

  insert: async function (userId, boxId) {
    // @ts-ignore
    return (await storage().query(sql`
    INSERT INTO video_streams (user_id, box_id, max_segment, date_start) 
    VALUES (${userId}, ${boxId}, 1, NOW());
    SELECT LAST_INSERT_ID() as id;
    `))[0].id;
  },
  
  increment: async function (userId, boxId) {
    // @ts-ignore
    return (await storage().query(sql`
    UPDATE video_streams SET max_segment = max_segment + 1
    WHERE user_id=${userId} AND box_id=${boxId};
    `));
  },
};
