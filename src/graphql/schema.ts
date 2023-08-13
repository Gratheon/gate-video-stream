export const schema = `
scalar Upload
scalar ID
scalar DateTime

type Query {
	videoStreams(boxIds: [ID], active: Boolean): [VideoStream]
}

type Mutation {
	uploadGateVideo(file: Upload!, boxId: ID!): Boolean
}

type VideoStream {
	id: ID!
	maxSegment: Int
	manifest: String
	active: Boolean
	startTime: DateTime
	endTime: DateTime
}
`;


// extend type Box @key(fields: "id") {
// 	id: ID! @external
// 	streamActive: Boolean
// }