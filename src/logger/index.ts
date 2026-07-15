import { createLogger } from '@gratheon/log-lib';
import config from '../config';

const { logger, fastifyLogger } = createLogger({
    mysql: {
        host: config.mysql.host,
        port: parseInt(config.mysql.port, 10),
        user: config.mysql.user,
        password: config.mysql.password,
        database: 'logs'
    },
    logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') ||
              (process.env.ENV_ID === 'dev' ? 'debug' : 'info')
});

function sanitizeError(err: any): Record<string, any> {
    if (!err || typeof err !== 'object') return {};
    return {
        name: err.name,
        message: err.message,
        code: err.code,
        statusCode: err.statusCode
    };
}

function sanitizePayload(value: any, depth: number = 0): any {
    if (value == null) return value;
    if (depth > 2) return '[Truncated]';
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizePayload(item, depth + 1));

    const out: Record<string, any> = {};
    const entries = Object.entries(value).slice(0, 30);

    for (const [key, val] of entries) {
        if (key === 'raw' || key === 'socket' || key.startsWith('_')) continue;
        if (key === 'err' || key === 'error') {
            out[key] = sanitizeError(val);
            continue;
        }
        out[key] = sanitizePayload(val, depth + 1);
    }

    return out;
}

function normalizeFastifyLog(msg: any, args: any[]): { message: string; meta?: any } {
    const messageFromArgs = args.find((arg) => typeof arg === 'string') as string | undefined;

    if (msg instanceof Error) {
        return {
            message: messageFromArgs ? `${messageFromArgs}: ${msg.message}` : msg.message,
            meta: { err: sanitizeError(msg) }
        };
    }

    if (msg && typeof msg === 'object') {
        const defaultMessage = typeof msg.msg === 'string' ? msg.msg : 'fastify request';
        return {
            message: messageFromArgs || defaultMessage,
            meta: sanitizePayload(msg)
        };
    }

    return { message: messageFromArgs ? `${String(msg)} ${messageFromArgs}` : String(msg) };
}

function shouldSkipFastifyInfoLog(msg: any): boolean {
    const url = typeof msg?.req?.url === 'string' ? msg.req.url : '';
    const method = typeof msg?.req?.method === 'string' ? msg.req.method : '';
    const highVolumeRoutes = [
        '/api/entrance-live/device/poll',
        '/api/entrance-live/device/events',
        '/api/entrance-heatmaps/trajectories',
    ];

    // WHY: device polling/trajectory uploads are operationally noisy at info
    // level. Keep warnings/errors, metrics, and explicit application logs intact.
    return method !== '' && highVolumeRoutes.some((route) => url.startsWith(route));
}

const wrappedFastifyLogger = {
    info: (msg: any, ...args: any[]) => {
        if (shouldSkipFastifyInfoLog(msg)) {
            return;
        }
        const normalized = normalizeFastifyLog(msg, args);
        logger.info(normalized.message, normalized.meta);
    },
    warn: (msg: any, ...args: any[]) => {
        const normalized = normalizeFastifyLog(msg, args);
        logger.warn(normalized.message, normalized.meta);
    },
    error: (msg: any, ...args: any[]) => {
        const normalized = normalizeFastifyLog(msg, args);
        logger.error(normalized.message, normalized.meta);
    },
    debug: (msg: any, ...args: any[]) => {
        const normalized = normalizeFastifyLog(msg, args);
        logger.debug(normalized.message, normalized.meta);
    },
    fatal: (msg: any, ...args: any[]) => {
        const normalized = normalizeFastifyLog(msg, args);
        logger.error(normalized.message, { ...normalized.meta, fatal: true });
    },
    trace: () => {
        // keep noisy trace logs out of DB-backed logs
    },
    child: () => wrappedFastifyLogger
};

export { logger, wrappedFastifyLogger as fastifyLogger };
