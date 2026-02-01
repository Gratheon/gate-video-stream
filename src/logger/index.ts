import { createLogger } from '@gratheon/log-lib';
import config from '../config';

// Create logger with MySQL database persistence and log level from config
const { logger, fastifyLogger } = createLogger({
    mysql: {
        host: config.mysql.host,
        port: parseInt(config.mysql.port, 10),
        user: config.mysql.user,
        password: config.mysql.password,
        database: 'logs'
    }
});

export { logger, fastifyLogger };
