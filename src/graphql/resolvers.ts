import fs from 'fs';
import crypto from 'crypto';

import { GraphQLUpload } from 'graphql-upload';
import { finished } from 'stream/promises';

import { logger } from '../logger';
import upload from '../models/s3';
import fileModel from '../models/file';
import { emitWarning } from 'process';

export const resolvers = {
	Query: {
		hello: 'world'
	},
	Box: {
		streamActive: async (box, _, ctx) => {
			return false
		}
	},

	Mutation: {
		uploadGateVideo: async (_, { file, boxId }, { uid }) => {
			try {

				let [stream_id, max_chunk] = await fileModel.getMaxChunk(uid, boxId)
				max_chunk = max_chunk + 1;

				// local file
				const { createReadStream, filename, mimetype, encoding } = await file;
				const stream = createReadStream();

				// db
				if (!stream_id) {
					await fileModel.insert(uid, boxId);
					[stream_id, max_chunk] = await fileModel.getMaxChunk(uid, boxId)
				} else {
					await fileModel.increment(uid, boxId)
				}

				let uploaded_filename = `${max_chunk}.mp4`
				// AWS
				const result = await upload(
					stream,
					// `tmp/${uid}_${filename}`, 
					`${uid}/gate_videos/${boxId}/${stream_id}/${uploaded_filename}`);


				logger.info('uploaded', { filename, result });

				return true

			} catch (err) {
				console.error(err);
				return false;
			}
		},
	},
	Upload: GraphQLUpload,
}
