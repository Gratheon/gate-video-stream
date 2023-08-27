import fs from 'fs';
import https from 'https';
import FormData from 'form-data';
import fetch from "node-fetch";

import { logger } from '../logger';
import streamModel from '../models/stream';
import segmentModel from '../models/segment';
import config from '../config';
import { publisher, generateChannelName } from '../redisPubSub'

async function downloadFile(url, localPath) {
	return new Promise((resolve, reject) => {
		try {
			const file = fs.createWriteStream(localPath);
			https.get(url, function (response) {
				response.pipe(file);

				// after download completed close filestream
				file.on("finish", () => {
					file.close();
					logger.info("Download Completed");
					resolve(true);
				});
			});
		} catch (e) {
			reject(e);
		}
	});
}

export async function loopAnalyzeGateVideo() {
	const videoSegment = await segmentModel.getFirstUnprocessed();

	if (videoSegment == null) {
		setTimeout(loopAnalyzeGateVideo, 10000);
		logger.info('empty queue, 10s..');
		return
	}

	logger.info('starting processing segment', videoSegment);


	try {
		if (!fs.existsSync(videoSegment.localFilePath)) {
			logger.info("Downloading file")
			logger.info(videoSegment)
			await downloadFile(videoSegment.url, videoSegment.localFilePath);
		}

		await segmentModel.startDetection(videoSegment.id);

		await detectGateBeesOnVideoSegment(videoSegment);

		// await fileModel.endDetection(file.file_id, file.frame_side_id);
		// fs.unlinkSync(file.localFilePath);
	}
	catch (e) {
		logger.error(e)
	}

	setTimeout(loopAnalyzeGateVideo, 100);
}

async function detectGateBeesOnVideoSegment(segment) {
	try {
		const fileContents = fs.readFileSync(segment.localFilePath);
		const formData = new FormData();
		formData.append('file', fileContents, { type: 'application/octet-stream', filename: segment.filename });

		const response = await fetch(config.models_gate_tracker_url, {
			method: 'POST',
			body: formData,
		});

		if (!response.ok) {
			throw new Error(`HTTP request failed with status ${response.status}`);
		}

		const detectionStats = await response.json();

		logger.info("Received response")
		logger.info({detectionStats})
		// wespenCount: 0
		// varroaCount: 0
		// pollenCount: 0
		// coolingCount: 0
		// beesIn: 0
		// beesOut: 0
		// processedFames: 327

		await segmentModel.updateDetections(
			segment.id,
			detectionStats
		)

		// const ch = generateChannelName(
		// 	segment.user_id,
		// 	'frame_side',
		// 	segment.frame_side_id,
		// 	'frame_resources_detected'
		// );

		// logger.info("Publishing to redis channel", ch)
		// await publisher.publish(
		// 	ch, 
		// 	JSON.stringify({
		// 		delta
		// 	})
		// )
	}
	catch (e) {
		logger.error(e);
	}
}