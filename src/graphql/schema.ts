export const schema = `
scalar Upload
scalar ID

type Query{
	hello: String
}

type Mutation {
	uploadGateVideo(file: Upload!, boxId: ID!): Boolean
}

extend type Box @key(fields: "id") {
	id: ID! @external
	streamActive: Boolean
}
`;
