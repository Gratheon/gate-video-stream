export default {
    routerSignature: "",// use own
    sentryDsn: "", // use own

	// needed to register graphql schema
    schema_registry_url: process.env.NATIVE ? 'http://localhost:6001/schema/push' :'http://gql-schema-registry:3000/schema/push',
    selfUrl: "gate-video-stream:8900",
    selfRESTUrl: "http://localhost:8950",

	// external service url for inferencing
    models_gate_tracker_url: "http://models-gate-tracker:9100/",

	// set own db
    mysql: {
        host: process.env.NATIVE ? 'localhost': 'mysql',
        port: process.env.NATIVE ? '60003' :'3306',
        user: 'root',
        password: 'test',
        database: 'gate-video-stream',
    },

	// set own aws s3 bucket where to store files
    aws: {
        "bucket": "gratheon-test", // use own
        "key": "", // use own
        "secret": "" // use own
    },
    "files_base_url": "https://gratheon-test.s3.eu-central-1.amazonaws.com/",

    jwt:{
        privateKey: "",
    }
}