import { sql } from "@databases/mysql";
import ffmpeg from 'fluent-ffmpeg'
import fs from 'fs'

import config from "../config/index";
import { storage } from "./storage";
import { logger } from '../logger';

const outputResolution = '640x480'
const bitrate = '3000'

export default {

  writeToFileFromStream: async function (readStream, targetFilePath: string) {
    const writeStream = fs.createWriteStream(targetFilePath);

    // Pipe the uploaded file's readable stream to the writable stream
    await new Promise((resolve, reject) => {
      readStream().pipe(writeStream)
        .on('finish', resolve)
        .on('error', reject);
    });
  },

  convertWebmToMp4: async function (webmFilePath, mp4FilePath) {
    logger.info('reading ' + webmFilePath)
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
        .videoBitrate(bitrate)
        .on('end', () => {
          logger.info('Conversion finished');
          resolve(true)
        })
        .on('error', (err) => {
          logger.error('FFmpeg error:', err);
          logger.error('FFmpeg stderr:', err.stderr);
          logger.error('FFmpeg stdout:', err.stdout);
          reject(err)
        })
        .on('exit', (code, signal) => {
          if (code === 0) {
            logger.info('FFmpeg process exited successfully');
            resolve(true)
          } else {
            logger.error('FFmpeg process exited with code:', code);
            reject(code)
          }
        })
        .noAudio()
        .size(outputResolution)
        .save(mp4FilePath);
    })
  },
  convertMp4ToMp4: async function (inputMP4FilePath, outputMP4FilePath) {
    logger.info('reading ' + inputMP4FilePath)
    return new Promise((resolve, reject) => {
      ffmpeg(inputMP4FilePath)
        // .inputOptions('-c:v libvpx') // Input codec for WebM
        // .outputOptions('-c:v libx264') // Output codec for MP4
        .outputOptions([
          '-c:v libx264',
          '-strict experimental',
          '-movflags frag_keyframe+empty_moov+default_base_moof',
          '-f mp4',
        ])
        .videoBitrate(bitrate)
        .on('end', () => {
          logger.info('Conversion finished');
          resolve(true)
        })
        .on('error', (err) => {
          logger.error('FFmpeg error:', err);
          logger.error('FFmpeg stderr:', err.stderr);
          logger.error('FFmpeg stdout:', err.stdout);
          reject(err)
        })
        .on('exit', (code, signal) => {
          if (code === 0) {
            logger.info('FFmpeg process exited successfully');
            resolve(true)
          } else {
            logger.error('FFmpeg process exited with code:', code);
            reject(code)
          }
        })
        .noAudio()
        .size(outputResolution)
        .save(outputMP4FilePath);
    })
  },

  insert: async function (userId, streamId, chunk_id) {
    // @ts-ignore
    return (await storage().query(sql`
    INSERT INTO segments (user_id, stream_id, chunk_id) 
    VALUES (${userId}, ${streamId}, ${chunk_id});
    SELECT LAST_INSERT_ID() as id;
    `))[0].id;
  },

  startDetection: async function (id) {
    // @ts-ignore
    await storage().query(sql`
    UPDATE segments
    SET process_start_time = NOW()
    WHERE id = ${id};
    `);
  },

  getFirstUnprocessed: async function () {
    const result = await storage().query(
      sql`SELECT t1.id, t1.user_id, t1.stream_id, t1.chunk_id, t1.add_time as addTime, t2.box_id
			FROM segments t1
      INNER JOIN streams t2 ON t2.id=t1.stream_id
			WHERE process_start_time IS NULL
			ORDER BY add_time ASC
			LIMIT 1`
    );

    let segment = result[0];

    if(!segment){
      return;
    }

    segment.filename = `${segment.chunk_id}.mp4`
    segment.URL = this.getUrl(segment.user_id, segment.box_id, segment.stream_id, segment.chunk_id)

    return segment;
  },

  getFileUploadRelPath: function(userID, boxId, streamId, uploaded_filename){
    return `${userID}/gate_videos/${boxId}/${streamId}/${uploaded_filename}`
  },

  getUrl: function(userID, boxID, streamID, chunkID){
    return `${config.files_base_url}${userID}/gate_videos/${boxID}/${streamID}/${chunkID}.mp4`
  },

  getLocalTmpFile: function(userID, chunkID){
    let uploadedFilename = `${chunkID}.mp4`
    let mp4File = `/app/tmp/${userID}_${uploadedFilename}`
    return [uploadedFilename, mp4File]
  },

  // TODO introduce quorum mechanism in stats update
  // to protect from potential attacks, although we can block by UID if that happens
  updateDetections: async function(id, detectionStats){
    // @ts-ignore
    await storage().query(sql`
    UPDATE segments
    SET process_end_time = NOW(),
      bees_in = ${detectionStats.beesIn},
      bees_out = ${detectionStats.beesOut},
      wespen_count = ${detectionStats.wespenCount},
      varroa_count = ${detectionStats.varroaCount},
      pollen_count = ${detectionStats.pollenCount}
    WHERE id = ${id} AND process_end_time IS NULL;
    `);
  }
};
