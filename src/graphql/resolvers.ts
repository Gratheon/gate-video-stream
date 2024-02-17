import fs from 'fs';

import { GraphQLUpload } from 'graphql-upload';

import { logger } from '../logger';
import upload from '../models/s3';
import segmentModel from '../models/segment';
import streamModel from '../models/stream';

const MP4_FILE_DELETE_TIMEOUT = 2 * 60 * 1000;

export const resolvers = {
	Query: {
		hello: 'world',
		videoStreams: async (_, { active, boxIds }, { uid }) => {
			return await streamModel.list(uid, boxIds, active)
		}
	},
	Mutation: {
		uploadGateVideo: async (_, { file, boxId: boxID }, { uid: userID }) => {
			try {

				let [streamID, chunkID] = await streamModel.getActiveStreamMaxChunk(userID, boxID)
				chunkID = chunkID + 1;

				// local file
				const { createReadStream } = await file;

				let ctx = { userID, boxID, streamID, chunkID }
				logger.info("Uploading video file", ctx)

				if (streamID) {
					await streamModel.increment(userID, streamID)
				}

				// path inside the container
				let webmFilePath = `/app/tmp/${userID}_${chunkID}.webm`
				await segmentModel.writeWebmFile(createReadStream, webmFilePath)

				logger.info("Wrote webm", ctx)

				let [uploadedFilename, mp4File] = segmentModel.getLocalTmpFile(userID, chunkID)

				await segmentModel.convertWebmToMp4(webmFilePath, mp4File)
				logger.info("Converted webm -> mp4", ctx)

				try {
					fs.unlinkSync(webmFilePath);
				} catch (err) {
					logger.error('Error deleting webm file:', err, ctx);
				}

				// db
				if (!streamID) {
					await streamModel.endPreviousBoxStreams(userID, boxID);
					await streamModel.insert(userID, boxID);
					[streamID, chunkID] = await streamModel.getActiveStreamMaxChunk(userID, boxID)

					let ctx = { userID, boxID, streamID, chunkID }
					logger.info('Created new stream', ctx)
				}

				await upload(
					fs.createReadStream(mp4File),
					segmentModel.getFileUploadRelPath(userID, boxID, streamID, uploadedFilename)
				);

				logger.info('Uploaded file to S3', ctx)

				// we want to reuse local mp4 file in a separate async worker stream
				// to avoid re-downloading it, so schedule cleanup a bit later
				deleteLocalMp4FileLater(mp4File)

				await segmentModel.insert(userID, streamID, chunkID);

				logger.info('Saved segment info to DB', ctx)
				return true

			} catch (err) {
				console.error(err);
				return false;
			}
		},
	},
	Upload: GraphQLUpload,
}

function deleteLocalMp4FileLater(mp4File) {
	setTimeout(() => {
		try {
			fs.unlinkSync(mp4File);
		} catch (err) {
			logger.error('Error deleting mp4 file:', err);
		}
	}, MP4_FILE_DELETE_TIMEOUT)
}