export default {
    routerSignature: "",// use own
    sentryDsn: "", // use own

	// needed to register graphql schema
    schema_registry_url: process.env.NATIVE ? 'http://localhost:6001/schema/push' :'http://gql-schema-registry:3000/schema/push',
    selfUrl: "gate-video-stream:8900",
    selfRESTUrl: "http://localhost:8950",

	// external service url for inferencing
    models_gate_tracker_url: "http://models-gate-tracker:9100/",

    // user-cycle service url, needed to verify apiTokens for direct API video uploads
    userCycleUrl: 'http://user-cycle:4000',

	// set own db
    postgres: {
        host: process.env.DB_HOST || (process.env.NATIVE ? 'localhost' : 'postgres'),
        port: process.env.DB_PORT || '5432',
        user: process.env.DB_USER || 'test',
        password: process.env.DB_PASSWORD || 'test',
        database: process.env.DB_NAME || 'gate_video_stream',
        // disable | prefer | require | no-verify
        ssl: process.env.DB_SSL || 'prefer',
    },

	// set own aws s3 bucket where to store files
    aws: {
        "bucket": process.env.AWS_BUCKET || "gratheon-test", // use own
        "key": process.env.AWS_KEY || "", // use own
        "secret": process.env.AWS_SECRET || "", // use own
        "region": process.env.AWS_REGION || "eu-central-1",
        // set for MinIO/local S3-compatible targets
        "target_upload_endpoint": process.env.AWS_TARGET_UPLOAD_ENDPOINT || "",
        "s3ForcePathStyle": process.env.AWS_S3_FORCE_PATH_STYLE === "1"
    },
    "files_base_url": process.env.FILES_BASE_URL || "https://gratheon-test.s3.eu-central-1.amazonaws.com/",

    jwt:{
        // should match user-cycle JWT_KEY
        privateKey: process.env.JWT_KEY || "",
    }
}
