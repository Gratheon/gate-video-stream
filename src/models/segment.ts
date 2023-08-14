import { sql } from "@databases/mysql";
import ffmpeg from 'fluent-ffmpeg'
import fs from 'fs'

import { storage } from "./storage";
import config from "../config/index";

export default {
  getFirstUnprocessed: async function () {
    const result = await storage().query(
      sql`SELECT t1.user_id, t2.filename, t2.width, t2.height, t1.file_id, t1.frame_side_id
			FROM segments
			WHERE t1.process_start_time IS NULL
			ORDER BY t1.added_time ASC
			LIMIT 1`
    );

    const file = result[0];

    if (!file) {
      return null;
    }

    file.url = `${config.files_base_url}${file.user_id}/${file.filename}`;
    file.localFilePath = `tmp/${file.user_id}_${file.filename}`;

    return file;
  },


  writeWebmFile: async function (readStream, webmFilePath) {
    const writeStream = fs.createWriteStream(webmFilePath);

    // Pipe the uploaded file's readable stream to the writable stream
    await new Promise((resolve, reject) => {
      readStream().pipe(writeStream)
        .on('finish', resolve)
        .on('error', reject);
    });
  },
  convertWebmToMp4: async function (webmFilePath, mp4FilePath) {
    console.log('reading '+webmFilePath)
    return new Promise((resolve, reject) => {
      ffmpeg(webmFilePath)
        // .inputOptions('-c:v libvpx') // Input codec for WebM
        // .outputOptions('-c:v libx264') // Output codec for MP4
        .outputOptions([
          '-c:v libx264',
          '-strict experimental',
          '-movflags frag_keyframe+empty_moov+default_base_moof',
          '-f mp4',
        ])
        .videoBitrate('3000')
        .on('end', () => {
          console.log('Conversion finished');
          resolve(true)
        })
        .on('error', (err) => {
          console.error('FFmpeg error:', err);
          console.error('FFmpeg stderr:', err.stderr);
          console.error('FFmpeg stdout:', err.stdout);
          reject(err)
        })
        .on('exit', (code, signal) => {
          if (code === 0) {
            console.log('FFmpeg process exited successfully');
            resolve(true)
          } else {
            console.error('FFmpeg process exited with code:', code);
            reject(code)
          }
        })
        .noAudio()
        // .size('1920x1080')
        .save(mp4FilePath);
    })
  }
};
