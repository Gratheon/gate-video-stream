// @ts-ignore
import fs from 'fs';

import { GraphQLScalarType, Kind } from 'graphql';
import { GraphQLUpload } from 'graphql-upload';

import { logger } from '../logger';
import upload from '../models/s3';
import segmentModel from '../models/segment';
import streamModel from '../models/stream';
import entranceLiveModel from '../models/entranceLive';
import { wrapGraphqlResolversWithMetrics } from '../metrics';

const MP4_FILE_DELETE_TIMEOUT = 2 * 60 * 1000;

const JSONScalar = new GraphQLScalarType({
	name: 'JSON',
	description: 'Arbitrary JSON value',
	serialize(value) {
		return value;
	},
	parseValue(value) {
		return value;
	},
	parseLiteral(ast) {
		switch (ast.kind) {
			case Kind.STRING:
				return ast.value;
			case Kind.INT:
				return Number(ast.value);
			case Kind.FLOAT:
				return Number(ast.value);
			case Kind.BOOLEAN:
				return ast.value;
			case Kind.NULL:
				return null;
			case Kind.OBJECT:
				return ast.fields.reduce((acc, field) => {
					acc[field.name.value] = (JSONScalar.parseLiteral as any)(field.value);
					return acc;
				}, {} as Record<string, unknown>);
			case Kind.LIST:
				return ast.values.map((value) => (JSONScalar.parseLiteral as any)(value));
			default:
				return null;
		}
	},
});

function mapSessionToGraphql(session) {
	if (!session) {
		return null;
	}

	return {
		id: session.id,
		boxId: session.boxId,
		status: session.status,
		playbackUrl: session.playbackUrl,
		signalingToken: session.signalingToken,
		expiresAt: session.expiresAt,
		qualityProfile: session.qualityProfile,
		recordingMode: session.recordingMode,
		relayProtocol: session.relayProtocol,
		publisherUrl: session.publisherUrl,
		publishToken: session.publishToken,
		clipHandoffEnabled: Boolean(session.clipHandoffEnabled),
		handoffStreamId: session.handoffStreamId,
		lastKeepaliveAt: session.lastKeepaliveAt,
		lastErrorCode: session.lastErrorCode,
		lastErrorMessage: session.lastErrorMessage,
		relayDetails: session.relayCredentials
			? {
				relayProtocol: session.relayCredentials.relayProtocol || session.relayProtocol,
				placeholder: Boolean(session.relayCredentials.placeholder),
				publisherUrl: session.relayCredentials.publisherUrl || session.publisherUrl,
				publishToken: session.relayCredentials.publishToken || session.publishToken,
				signalingToken: session.relayCredentials.signalingToken || session.signalingToken,
				playbackUrl: session.relayCredentials.playbackUrl || session.playbackUrl,
				frameContentType: session.relayCredentials.frameContentType || null,
				playbackContentType: session.relayCredentials.playbackContentType || null,
			}
			: null,
	};
}

const baseResolvers = {
	Query: {
		hello: 'world',
		videoStreams: async (_, { active, boxIds }, { uid }) => {
			if (!uid) {
				logger.error('Unauthorized attempt to access videoStreams', { uid })
				return [];
			}

			return await streamModel.list(uid, boxIds, active)
		},
		fetchNextUnprocessedVideoSegment: async (_, __, { uid }) => {
			if (!uid) {
				logger.error('Unauthorized attempt to access fetchNextUnprocessedVideoSegment', { uid })
				return null;
			}

			return await segmentModel.getFirstUnprocessed();
		},
		entranceLiveStreamSession: async (_, { boxId }, { uid }) => {
			if (!uid) {
				logger.error('Unauthorized attempt to access entranceLiveStreamSession', { uid, boxId })
				return null;
			}

			const session = await entranceLiveModel.getSessionForBox(uid, boxId);
			return mapSessionToGraphql(session);
		}
	},
	Mutation: {
		updateVideoSegmentDetectionStats: async (_, { id, detectionStats }, { uid }) => {
			logger.debug('updateVideoSegmentDetectionStats', { id, detectionStats })
			if (!uid) {
				logger.error('Unauthorized attempt to update video segment detection stats', { id, detectionStats })
				return null;
			}

			return await segmentModel.updateDetections(id, detectionStats);
		},
		startEntranceLiveStream: async (_, { boxId, qualityProfile, recordingMode }, { uid }) => {
			if (!uid) {
				throw new Error('Unauthorized');
			}

			const session = await entranceLiveModel.startSession({
				userId: uid,
				boxId,
				qualityProfile,
				recordingMode,
			});

			return mapSessionToGraphql(session);
		},
		stopEntranceLiveStream: async (_, { sessionId }, { uid }) => {
			if (!uid) {
				throw new Error('Unauthorized');
			}

			return await entranceLiveModel.stopSession(uid, sessionId);
		},
		keepEntranceLiveStreamAlive: async (_, { sessionId }, { uid }) => {
			if (!uid) {
				throw new Error('Unauthorized');
			}

			const session = await entranceLiveModel.keepAlive(uid, sessionId);
			return mapSessionToGraphql(session);
		},

		// todo change schema to return graphql ERR type instead of boolean
		uploadGateVideo: async (_, { file, detectionsFile, boxId: boxID, startTime }, { uid }) => {
			try {
				if (!uid) {
					logger.error('Unauthorized attempt to access uploadGateVideo', { uid })
					return false;
				}

				let [streamID, chunkID] = await streamModel.getActiveStreamMaxChunk(uid, boxID)
				chunkID = chunkID + 1;

				// local file
				const fileInternals = await file;
				let { createReadStream } = fileInternals

				let ctx = { uid, boxID, streamID, chunkID }
				logger.info("Uploading video file", ctx)

				if (streamID) {
					await streamModel.increment(uid, streamID)
				}

				// processed local and uploaded file paths
				let [generatedChunkFilename, mp4FileResized] = segmentModel.getLocalTmpFile(uid, chunkID)
				// path inside the container
				let tmpLocalFilePath = `/app/tmp/${uid}_${chunkID}`

				// chrome browser sends only webm
				if (fileInternals.mimetype == 'video/webm') {
					tmpLocalFilePath = `${tmpLocalFilePath}.webm`
					await segmentModel.writeToFileFromStream(createReadStream, tmpLocalFilePath)
					await segmentModel.convertWebmToMp4(tmpLocalFilePath, mp4FileResized)
					logger.info("Converted webm -> mp4", ctx)

					try {
						fs.unlinkSync(tmpLocalFilePath);
					} catch (err) {
						logger.errorEnriched('Error deleting webm file', err, ctx);
					}
				}

				// other integrations may send mp4 directly
				else {

					tmpLocalFilePath = `${tmpLocalFilePath}_orig.mp4`
					await segmentModel.writeToFileFromStream(createReadStream, tmpLocalFilePath)

					mp4FileResized = `${tmpLocalFilePath}.mp4`
					await segmentModel.convertMp4ToMp4(tmpLocalFilePath, mp4FileResized)

					logger.info("Resized mp4", {
						tmpLocalFilePath,
						mp4FileResized
					})

					try {
						fs.unlinkSync(tmpLocalFilePath);
					} catch (err) {
						logger.errorEnriched('Error deleting original mp4 file', err, ctx);
					}
				}

				// db
				if (!streamID) {
					await streamModel.endPreviousBoxStreams(uid, boxID);
					await streamModel.insert(uid, boxID, startTime);
					[streamID, chunkID] = await streamModel.getActiveStreamMaxChunk(uid, boxID)

					let ctx = { userID:uid, boxID, streamID, chunkID }
					logger.info('Created new stream', ctx)
				}

				logger.info('Uploading file to S3', {
					mp4FileResized,
					uid, boxID,
					streamID, generatedChunkFilename
				})
				await upload(
					fs.createReadStream(mp4FileResized),
					segmentModel.getFileUploadRelPath(uid, boxID, streamID, generatedChunkFilename)
				);

				logger.info('Uploaded file to S3', ctx)

				// we want to reuse local mp4 file in a separate async worker stream
				// to avoid re-downloading it, so schedule cleanup a bit later
				deleteLocalMp4FileLater(mp4FileResized)

				// Optional for backward compatibility with older clients.
				if (detectionsFile) {
					const detectionsFileInternals = await detectionsFile;
					const { createReadStream: createDetectionsReadStream } = detectionsFileInternals;
					const detectionsTmpLocalFilePath = `/app/tmp/${uid}_${chunkID}_detections.mp4`;
					await segmentModel.writeToFileFromStream(createDetectionsReadStream, detectionsTmpLocalFilePath);

					const detectionsMp4FileResized = `${detectionsTmpLocalFilePath}.mp4`;
					await segmentModel.convertMp4ToMp4(detectionsTmpLocalFilePath, detectionsMp4FileResized);

					const detectionsGeneratedChunkFilename = `${chunkID}_detections.mp4`;
					logger.info('Uploading detections file to S3', {
						detectionsMp4FileResized,
						uid, boxID,
						streamID, detectionsGeneratedChunkFilename
					});
					await upload(
						fs.createReadStream(detectionsMp4FileResized),
						segmentModel.getFileUploadRelPath(uid, boxID, streamID, detectionsGeneratedChunkFilename)
					);
					logger.info('Uploaded detections file to S3', ctx);
					deleteLocalMp4FileLater(detectionsMp4FileResized);
					try {
						fs.unlinkSync(detectionsTmpLocalFilePath);
					} catch (err) {
						logger.errorEnriched('Error deleting original detections mp4 file', err, ctx);
					}
				} else {
					logger.info('No detectionsFile provided; skipping detections upload', ctx);
				}


				await segmentModel.insert(uid, streamID, chunkID);

				logger.info('Saved segment info to DB', ctx)
				return true

			} catch (err) {
				logger.error(err);
				return false;
			}
		},
	},
	Upload: GraphQLUpload,
	JSON: JSONScalar,
}

export const resolvers = wrapGraphqlResolversWithMetrics(baseResolvers);

function deleteLocalMp4FileLater(mp4File) {
	setTimeout(() => {
		try {
			fs.unlinkSync(mp4File);
		} catch (err) {
			logger.error('Error deleting mp4 file:', err);
		}
	}, MP4_FILE_DELETE_TIMEOUT)
}
