import defaults from './config.default';

export default {
    ...defaults,
    routerSignature: process.env.ROUTER_SIGNATURE || '',
    sentryDsn: process.env.SENTRY_DSN || '',
    schema_registry_url: process.env.SCHEMA_REGISTRY_URL || 'http://127.0.0.1:3000/schema/push',
    selfUrl: process.env.SELF_URL || 'localhost:8900',
    selfRESTUrl: process.env.SELF_REST_URL || 'https://video.gratheon.com',
    userCycleUrl: process.env.USER_CYCLE_URL || 'http://127.0.0.1:4000',
    models_gate_tracker_url: process.env.MODELS_GATE_TRACKER_URL || 'http://127.0.0.1:9100/',
    mysql: {
        host: process.env.DB_HOST || '127.0.0.1',
        port: process.env.DB_PORT || '3306',
        user: process.env.DB_USER || 'gate-video-stream',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'gate-video-stream',
    },
    files_base_url: process.env.FILES_BASE_URL || defaults.files_base_url,
    aws: {
        ...defaults.aws,
        bucket: process.env.AWS_BUCKET || defaults.aws.bucket,
        key: process.env.AWS_KEY || '',
        secret: process.env.AWS_SECRET || '',
    },
    jwt: {
        privateKey: process.env.JWT_KEY || '',
    },
};
