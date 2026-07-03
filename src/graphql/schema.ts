export const schema = `
scalar Upload
scalar ID
scalar DateTime
scalar URL
scalar JSON

enum EntranceLiveStreamStatus {
	REQUESTED
	DEVICE_OFFLINE
	STARTING
	ACTIVE
	STOPPING
	STOPPED
	FAILED
}

type EntranceLiveRelayDetails {
	relayProtocol: String!
	placeholder: Boolean
	publisherUrl: URL
	publishToken: String
	signalingToken: String
	playbackUrl: URL
	frameContentType: String
	playbackContentType: String
}

type EntranceLiveStreamSession {
	id: ID!
	boxId: ID!
	status: EntranceLiveStreamStatus!
	playbackUrl: URL
	signalingToken: String
	expiresAt: DateTime!
	qualityProfile: String!
	recordingMode: String!
	relayProtocol: String!
	publisherUrl: URL
	publishToken: String
	clipHandoffEnabled: Boolean!
	handoffStreamId: ID
	lastKeepaliveAt: DateTime
	lastDeviceSeenAt: DateTime
	lastErrorCode: String
	lastErrorMessage: String
	relayDetails: EntranceLiveRelayDetails
}

type Query {
	videoStreams(boxIds: [ID], active: Boolean): [VideoStream]
	entranceHeatmaps(boxIds: [ID]!, date: String, limit: Int): [EntranceHeatmap]
	fetchNextUnprocessedVideoSegment: VideoSegment
	entranceLiveStreamSession(boxId: ID!): EntranceLiveStreamSession
}

type Mutation {
	uploadGateVideo(file: Upload!, detectionsFile: Upload, boxId: ID!, startTime: DateTime): Boolean
	updateVideoSegmentDetectionStats(id: ID!, detectionStats: DetectionStats!): Boolean
	startEntranceLiveStream(boxId: ID!, qualityProfile: String, recordingMode: String): EntranceLiveStreamSession!
	stopEntranceLiveStream(sessionId: ID!): Boolean!
	keepEntranceLiveStreamAlive(sessionId: ID!): EntranceLiveStreamSession!
}

input DetectionStats {
	beesIn: Int
	beesOut: Int
	wespenCount: Int
	varroaCount: Int
	pollenCount: Int
	coolingCount: Int
	processedFrames: Int
}

type VideoStream {
	id: ID!
	maxSegment: Int
	playlistURL: URL
	active: Boolean
	startTime: DateTime
	endTime: DateTime
}

type EntranceHeatmap {
	id: ID!
	boxId: ID!
	date: String!
	imageURL: URL
	width: Int
	height: Int
	trajectoryCount: Int
	pointCount: Int
	lastSampleAt: DateTime
	updatedAt: DateTime
}

type VideoSegment{
	id: ID!
	addTime: DateTime
	URL: URL
	filename: String
}

`;


// extend type Box @key(fields: "id") {
// 	id: ID! @external
// 	streamActive: Boolean
// }
