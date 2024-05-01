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
			if (!uid) {
				return false;
			}

			return await streamModel.list(uid, boxIds, active)
		},
		fetchNextUnprocessedVideoSegment: async(_, __, { uid }) => {
			if (!uid) {
				return null;
			}

			return await segmentModel.getFirstUnprocessed();
		}
	},
	Mutation: {
		updateVideoSegmentDetectionStats: async (_, { id, detectionStats }, { uid }) => {
			console.log({id, detectionStats})
			if (!uid) {
				logger.error('Unauthorized attempt to update video segment detection stats', { id, detectionStats })
				return null;
			}

			return await segmentModel.updateDetections(id, detectionStats);
		},

		// todo change schema to return graphql ERR type instead of boolean
		uploadGateVideo: async (_, { file, boxId: boxID }, { uid: userID }) => {
			try {
				console.log('uploadGateVideo')
				if (!userID) {
					logger.info("Unauthorized, failing response")
					return false;
				}

				let [streamID, chunkID] = await streamModel.getActiveStreamMaxChunk(userID, boxID)
				chunkID = chunkID + 1;

				// local file
				const fileInternals = await file;
				let { createReadStream } = fileInternals

				let ctx = { userID, boxID, streamID, chunkID }
				logger.info("Uploading video file", ctx)

				if (streamID) {
					await streamModel.increment(userID, streamID)
				}

				// processed local and uploaded file paths
				let [uploadedFilename, mp4File] = segmentModel.getLocalTmpFile(userID, chunkID)
				// path inside the container
				let tmpLocalFilePath = `/app/tmp/${userID}_${chunkID}`

				// chrome browser sends only webm
				if (fileInternals.mimetype == 'video/webm') {
					tmpLocalFilePath = `${tmpLocalFilePath}.webm`
					await segmentModel.writeToFileFromStream(createReadStream, tmpLocalFilePath)
					await segmentModel.convertWebmToMp4(tmpLocalFilePath, mp4File)
					logger.info("Converted webm -> mp4", ctx)

					try {
						fs.unlinkSync(tmpLocalFilePath);
					} catch (err) {
						logger.error('Error deleting webm file:', err, ctx);
					}
				}

				// other integrations may send mp4 directly
				else { //if (fileInternals.mimetype == 'video/mp4') {
					mp4File = `${tmpLocalFilePath}.mp4`
					tmpLocalFilePath = `${tmpLocalFilePath}_orig.mp4`
					await segmentModel.writeToFileFromStream(createReadStream, tmpLocalFilePath)
					await segmentModel.convertMp4ToMp4(tmpLocalFilePath, mp4File)

					try {
						fs.unlinkSync(tmpLocalFilePath);
					} catch (err) {
						logger.error('Error deleting original mp4 file:', err, ctx);
					}
				}
				// else{
				// 	throw new Error(`Unsupported file MIME type: ${fileInternals.mimetype}`)
				// }

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
				logger.error(err);
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