import pino from 'pino';
import pretty from 'pino-pretty';

export const logger = pino(pretty());

logger.log = function (...msg) {
    logger.info(...msg);
};

export function log(...msg) {
    const message = `${msg[0]}`;
    delete msg[0];
    const child = logger.child(msg)
    child.info(message)
};