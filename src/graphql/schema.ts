export const schema = `
scalar Upload
scalar ID
scalar DateTime
scalar URL

type Query {
	videoStreams(boxIds: [ID], active: Boolean): [VideoStream]
	fetchNextUnprocessedVideoSegment: VideoSegment
}

type Mutation {
	uploadGateVideo(file: Upload!, boxId: ID!): Boolean
	updateVideoSegmentDetectionStats(id: ID!, detectionStats: DetectionStats): Boolean
}

input DetectionStats {
	beesIn: Int
	beesOut: Int
	wespenCount: Int
	varroaCount: Int
	pollenCount: Int
}

type VideoStream {
	id: ID!
	maxSegment: Int
	playlistURL: URL
	active: Boolean
	startTime: DateTime
	endTime: DateTime
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