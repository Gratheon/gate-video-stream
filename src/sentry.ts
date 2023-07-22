import * as Sentry from '@sentry/node';
import config from './config'
// import * as Tracing from '@sentry/tracing';

Sentry.init({
  dsn: config.sentryDsn,

  // Set tracesSampleRate to 1.0 to capture 100%
  // of transactions for performance monitoring.
  // We recommend adjusting this value in production
  tracesSampleRate: 1.0,
});