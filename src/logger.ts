import config from "./config/index";
import Transport from 'winston-transport';
import winston, { transports, format } from 'winston';
import createConnectionPool, { sql } from "@databases/mysql";

class CustomMySQLLogTransport extends Transport {
  conn: any;
  constructor(opts) {
    super(opts);

    this.conn = createConnectionPool(
      `mysql://${config.mysql.user}:${config.mysql.password}@${config.mysql.host}:${config.mysql.port}/logs`
    );
  }

  log(info, callback) {
    const { level, message, ...winstonMeta } = info;

    // setImmediate(() => {
    //   this.emit('logged', info);
    // });

    // Perform the writing to the remote service
    this.conn.query(sql`
      INSERT INTO logs (level, message, meta, timestamp)
      VALUES (${level}, ${message}, ${JSON.stringify(winstonMeta)}, NOW())
    `);
    callback();
  }
};

export const logger = winston.createLogger({
  level: 'info',
  levels: Object.assign({ 'fatal': 0, 'warn': 4, 'trace': 7 }, winston.config.syslog.levels),
  format: format.json(),
  defaultMeta: { service: 'gate-video-stream' },
  transports: [
    new transports.Console({
      format: format.combine(
        format.timestamp({format: 'HH:mm:ss'}),
        format.colorize({all: true}),
        format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
      ),
      handleExceptions: true
    }),
    new CustomMySQLLogTransport({
      host: config.mysql.host,
      user: config.mysql.user,
      password: config.mysql.password,
      database: 'logs',
      table: 'logs'
    }),
  ],
});

logger.child = function () { return winston.loggers.get("default") };

process.on('uncaughtException', function (err) {
  console.log("UncaughtException processing: %s", err);
});
