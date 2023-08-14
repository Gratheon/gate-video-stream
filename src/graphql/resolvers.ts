import fs from 'fs';

import { GraphQLUpload } from 'graphql-upload';

import { logger } from '../logger';
import upload from '../models/s3';
import segmentModel from '../models/segment';
import streamModel from '../models/stream';

export const resolvers = {
	Query: {
		hello: 'world',
		videoStreams: async (_, { active, boxIds }, { uid }) => {
			return await streamModel.list(uid, boxIds, active)
		}
	},
	Mutation: {
		uploadGateVideo: async (_, { file, boxId }, { uid }) => {
			try {

				let [stream_id, max_chunk] = await streamModel.getActiveStreamMaxChunk(uid, boxId)
				max_chunk = max_chunk + 1;

				// local file
				const { createReadStream } = await file;


				if (stream_id) {
					await streamModel.increment(uid, stream_id)
				}

				let webmFilePath = `/app/tmp/${uid}_${max_chunk}.webm`
				await segmentModel.writeWebmFile(createReadStream, webmFilePath)

				let uploaded_filename = `${max_chunk}.mp4`
				let mp4File = `/app/tmp/${uid}_${uploaded_filename}`
				await segmentModel.convertWebmToMp4(webmFilePath, mp4File)

				try {
					fs.unlinkSync(webmFilePath);
				} catch (err) {
					console.error('Error deleting file:', err);
				}

				// db
				if (!stream_id) {
					await streamModel.endPreviousBoxStreams(uid, boxId);
					await streamModel.insert(uid, boxId);
					[stream_id, max_chunk] = await streamModel.getActiveStreamMaxChunk(uid, boxId)
				}

				await upload(
					fs.createReadStream(mp4File),
					`${uid}/gate_videos/${boxId}/${stream_id}/${uploaded_filename}`
				);

				try {
					fs.unlinkSync(mp4File);
				} catch (err) {
					console.error('Error deleting file:', err);
				}
				return true

			} catch (err) {
				console.error(err);
				return false;
			}
		},
	},
	Upload: GraphQLUpload,
}
