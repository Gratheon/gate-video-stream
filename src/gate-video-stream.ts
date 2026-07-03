import { ApolloServer } from "apollo-server-fastify";
import {
  ApolloServerPluginDrainHttpServer,
  ApolloServerPluginLandingPageGraphQLPlayground,
} from "apollo-server-core";
import fastify from "fastify";
import { buildSubgraphSchema } from "@apollo/federation";
import { processRequest } from "graphql-upload";
import jwt from "jsonwebtoken";
import gql from "graphql-tag";
import fs from "fs";
import path from "path";
import cors from "@fastify/cors"

import { schema } from "./graphql/schema";
import { resolvers } from "./graphql/resolvers";
import { initStorage } from "./models/storage";
import { registerSchema } from "./graphql/schema-registry";
import config from "./config/index";
import { logger, fastifyLogger } from "./logger";
import './sentry';
import streamModel from './models/stream'
import entranceLiveModel from './models/entranceLive'
import { buildMultipartFrameChunk, clearLiveFrame, getLiveFrame, storeLiveFrame } from './models/entranceLiveMedia'
// import { loopAnalyzeGateVideo } from './workers/video-inferencer'
import fetch from 'cross-fetch';
import { metricsContentType, recordHttpRequest, renderMetrics } from "./metrics";
import openapiSpec from "./openapi";
import { swaggerUIDocsHTML } from "./openapi-docs";

const requestStartTimes = new WeakMap<object, bigint>();

type AuthenticatedRestRequest = {
  userId?: string;
};

function fastifyAppClosePlugin(app) {
  return {
    async serverWillStart() {
      return {
        async drainServer() {
          await app.close();
        },
      };
    },
  };
}

async function resolveBearerUserId(bearerToken?: string) {
  if (!bearerToken) {
    return undefined;
  }

  const endpoint = `${config.userCycleUrl}/graphql`;
  const bearerTokenValidationResult = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `
        mutation ValidateApiToken($token: String) {
          validateApiToken(token: $token) {
            ... on TokenUser{
                id
            }
          }
        }
      `,
      variables: {
        token: bearerToken
      },
    }),
  })

  const bearerTokenValidationResultJSON = await bearerTokenValidationResult.json()

  return bearerTokenValidationResultJSON?.data?.validateApiToken?.id;
}

async function resolveRequestUserId(rawHeaders: Record<string, unknown>) {
  const signature = rawHeaders["internal-router-signature"];
  const trustedRouterSignatures = [config.routerSignature, "a239vmwoeifworg"].filter(Boolean);

  if (signature && trustedRouterSignatures.includes(String(signature))) {
    return String(
      rawHeaders["internal-userid"] ||
      rawHeaders["internal-userId"] ||
      ""
    ) || undefined;
  }

  const bearer = rawHeaders['authorization'];
  const bearerToken = typeof bearer === 'string' && bearer.startsWith('Bearer ')
    ? bearer.split(' ')[1]
    : undefined;

  if (bearerToken) {
    return await resolveBearerUserId(bearerToken);
  }

  const token = rawHeaders.token as string | undefined;
  const privateKey = config?.jwt?.privateKey;

  if (!token || !privateKey) {
    return undefined;
  }

  const decoded = await new Promise((resolve, reject) =>
    jwt.verify(token, privateKey, function (err, decoded) {
      if (err) {
        reject(err);
      }
      resolve(decoded);
    })
  ) as {
    user_id: string
  };

  return decoded?.user_id;
}

async function startApolloServer(app, typeDefs, resolvers) {
  app.addContentTypeParser("multipart", (request, payload, done) => {
    request.isMultipart = true;
    done();
  });

  // Format the request body to follow graphql-upload's
  app.addHook("preValidation", async function (request, reply) {
    if (!request.isMultipart) {
      return;
    }

    request.body = await processRequest(request.raw, reply.raw);
  });

  const server = new ApolloServer({
    schema: buildSubgraphSchema({ typeDefs: gql(typeDefs), resolvers }),
    //@ts-ignore
    cors: {
      origin: ["https://app.gratheon.com", "http://localhost:8080", "http://0.0.0.0:8080"]
    },
    plugins: [
      fastifyAppClosePlugin(app),
      ApolloServerPluginLandingPageGraphQLPlayground(),
      ApolloServerPluginDrainHttpServer({ httpServer: app.server }),
    ],
    // @ts-ignore
    uploads: {
      maxFileSize: 40000000, // 40 MB, see nginx config too
      maxFiles: 1,
    },
    context: async (req) => {
      logger.info('loading request context')

      try {
        const uid = await resolveRequestUserId(req.request.raw.headers as Record<string, unknown>);
        return { uid };
      }
      catch (e) {
        logger.error('Error in loading middleware context', e)
      }
    }
  });

  await server.start();
  app.register(server.createHandler());

  return server.graphqlPath;
}

(async function main() {
  logger.info('Starting service...');

  await initStorage(logger);

  try {
    // @ts-ignore
    const server = fastify({ logger: fastifyLogger });

    server.addHook("onRequest", async (request) => {
      requestStartTimes.set(request.raw, process.hrtime.bigint());
    });

    server.addHook("onResponse", async (request, reply) => {
      const start = requestStartTimes.get(request.raw);
      if (!start) {
        return;
      }

      requestStartTimes.delete(request.raw);
      const elapsedNanoseconds = Number(process.hrtime.bigint() - start);
      const durationSeconds = elapsedNanoseconds / 1_000_000_000;
      const route = request.routerPath || request.raw.url?.split("?")[0] || "unknown";

      recordHttpRequest({
        method: request.method,
        route,
        statusCode: reply.statusCode,
        durationSeconds,
      });
    });

    server.get("/metrics", async (_request, reply) => {
      reply.type(metricsContentType);
      return renderMetrics();
    });

    const version = fs.readFileSync(path.resolve(".version"), "utf8");
    await registerSchema(schema, version);
    const relPath = await startApolloServer(server, schema, resolvers);

    // @ts-ignore
    await server.listen(process.env.PORT, "0.0.0.0");
    logger.info(`Graphql server ready at http://localhost:${process.env.PORT}${relPath}`);

    // worker
    // logger.info(`Starting async worker`);
    // loopAnalyzeGateVideo()

    // REST server
    await startRestAPI();

    logger.info(`📷 Server ready at http://localhost:8950`);
  } catch (e) {
    logger.error(e);
  }
})();


async function startRestAPI() {
  // @ts-ignore
  const restServer = fastify({ logger: fastifyLogger });

  restServer.addHook("onRequest", async (request) => {
    requestStartTimes.set(request.raw, process.hrtime.bigint());
  });

  restServer.addHook("onResponse", async (request, reply) => {
    const start = requestStartTimes.get(request.raw);
    if (!start) {
      return;
    }

    requestStartTimes.delete(request.raw);
    const elapsedNanoseconds = Number(process.hrtime.bigint() - start);
    const durationSeconds = elapsedNanoseconds / 1_000_000_000;
    const route = request.routerPath || request.raw.url?.split("?")[0] || "unknown";

    recordHttpRequest({
      method: request.method,
      route,
      statusCode: reply.statusCode,
      durationSeconds,
    });
  });

  restServer.register(cors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  });

  // WHY: live publishers push raw JPEG frames with Content-Type image/jpeg.
  // Fastify rejects unknown non-JSON content types before the route handler, so
  // register a raw buffer parser before defining /live/publish routes.
  const parseJpegFrame = (_request, payload, done) => {
    const chunks: Buffer[] = [];
    payload.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    payload.on('end', () => done(null, Buffer.concat(chunks)));
    payload.on('error', (error) => done(error));
  };
  restServer.addContentTypeParser('image/jpeg', parseJpegFrame);
  restServer.addContentTypeParser('image/jpg', parseJpegFrame);

  restServer.addHook('preHandler', async (request) => {
    const routeUrl = request.routeOptions?.url || request.raw.url || '';
    const needsAuth = routeUrl.startsWith('/api/entrance-live/');
    if (!needsAuth) {
      return;
    }

    const userId = await resolveRequestUserId(request.raw.headers as Record<string, unknown>);
    (request as unknown as AuthenticatedRestRequest).userId = userId;
  });

  restServer.get('/docs', async (_request, reply) => {
    reply.type('text/html; charset=utf-8');
    return swaggerUIDocsHTML;
  });

  restServer.get('/docs/', async (_request, reply) => {
    reply.type('text/html; charset=utf-8');
    return swaggerUIDocsHTML;
  });

  // Serve the service-owned OpenAPI document next to the REST endpoints.
  restServer.get('/openapi.json', async (_request, reply) => {
    reply.type('application/json');
    return openapiSpec;
  });

  restServer.route({
    method: 'GET',
    url: '/hls/:uid/:boxId/:streamId/playlist.m3u8',
    handler: async function (request, reply) {
      reply.header('Content-Type', 'application/vnd.apple.mpegurl');
      const playlist = await streamModel.generateHlsPlaylist(
        //@ts-ignore
        request.params.uid,
        //@ts-ignore
        request.params.boxId,
        //@ts-ignore
        request.params.streamId
      );
      reply.send(playlist);
    }
  });

  restServer.post('/api/entrance-live/device/status', async (request, reply) => {
    const userId = (request as unknown as AuthenticatedRestRequest).userId;
    if (!userId) {
      reply.code(401);
      return { error: 'Unauthorized' };
    }

    const body = (request.body || {}) as any;
    if (!body.boxId) {
      reply.code(400);
      return { error: 'boxId is required' };
    }

    await entranceLiveModel.upsertDeviceStatus(userId, {
      boxId: body.boxId,
      deviceId: body.deviceId,
      appVersion: body.appVersion,
      cameraStatus: body.cameraStatus,
      publisherState: body.publisherState,
      status: body.status,
      lastErrorCode: body.lastErrorCode,
      lastErrorMessage: body.lastErrorMessage,
    });

    return { ok: true };
  });

  restServer.post('/api/entrance-live/device/poll', async (request, reply) => {
    const userId = (request as unknown as AuthenticatedRestRequest).userId;
    if (!userId) {
      reply.code(401);
      return { error: 'Unauthorized' };
    }

    const body = (request.body || {}) as any;
    if (!body.boxId) {
      reply.code(400);
      return { error: 'boxId is required' };
    }

    await entranceLiveModel.upsertDeviceStatus(userId, {
      boxId: body.boxId,
      deviceId: body.deviceId,
      appVersion: body.appVersion,
      cameraStatus: body.cameraStatus,
      publisherState: body.publisherState,
      status: body.status,
      lastErrorCode: body.lastErrorCode,
      lastErrorMessage: body.lastErrorMessage,
    });

    const commands = await entranceLiveModel.claimPendingCommands(userId, body.boxId, body.limit || 10);
    return { commands };
  });

  restServer.post('/api/entrance-live/device/command-ack', async (request, reply) => {
    const userId = (request as unknown as AuthenticatedRestRequest).userId;
    if (!userId) {
      reply.code(401);
      return { error: 'Unauthorized' };
    }

    const body = (request.body || {}) as any;
    if (!body.boxId || !body.commandId || !body.status) {
      reply.code(400);
      return { error: 'boxId, commandId, and status are required' };
    }

    await entranceLiveModel.acknowledgeCommand(userId, body.boxId, body.commandId, body.status, body.payload);
    return { ok: true };
  });
  restServer.post('/api/entrance-live/device/event', async (request, reply) => {
    const userId = (request as unknown as AuthenticatedRestRequest).userId;
    if (!userId) {
      reply.code(401);
      return { error: 'Unauthorized' };
    }

    const body = (request.body || {}) as any;
    if (!body.boxId || !body.eventType) {
      reply.code(400);
      return { error: 'boxId and eventType are required' };
    }

    await entranceLiveModel.recordDeviceEvent(userId, body.boxId, {
      sessionId: body.sessionId,
      eventType: body.eventType,
      payload: body.payload,
    });
    return { ok: true };
  });

  restServer.post('/live/publish/:sessionId/frame', async (request, reply) => {
    const userId = await resolveRequestUserId(request.raw.headers as Record<string, unknown>);
    if (!userId) {
      reply.code(401);
      return { error: 'Unauthorized' };
    }

    const sessionId = String((request.params as any)?.sessionId || '');
    if (!sessionId) {
      reply.code(400);
      return { error: 'sessionId is required' };
    }

    const session = await entranceLiveModel.getSessionByIdForUser(userId, sessionId);
    if (!session) {
      reply.code(404);
      return { error: 'Session not found' };
    }

    const bearerHeader = request.raw.headers['authorization'];
    const bearerToken = typeof bearerHeader === 'string' && bearerHeader.startsWith('Bearer ')
      ? bearerHeader.split(' ')[1]
      : undefined;
    const publishToken = request.headers['x-publish-token'];

    if (!publishToken || String(publishToken) !== String(session.publishToken || session.relayCredentials?.publishToken || bearerToken || '')) {
      reply.code(403);
      return { error: 'Invalid publish token' };
    }

    const parsedBody = request.body;
    const frameBuffer = Buffer.isBuffer(parsedBody)
      ? parsedBody
      : Buffer.concat([]);
    if (frameBuffer.length === 0) {
      reply.code(400);
      return { error: 'Frame body is required' };
    }

    const contentType = String(request.headers['content-type'] || 'image/jpeg').split(';')[0];
    if (!['image/jpeg', 'image/jpg'].includes(contentType)) {
      reply.code(415);
      return { error: 'Only image/jpeg is supported' };
    }

    const storedFrame = storeLiveFrame(sessionId, frameBuffer, 'image/jpeg');
    return {
      ok: true,
      sessionId,
      frameSequence: storedFrame.sequence,
      frameTimestamp: new Date(storedFrame.updatedAt).toISOString(),
      bytes: storedFrame.buffer.length,
    };
  });

  restServer.get('/live/playback/:sessionId.mjpeg', async (request, reply) => {
    const userId = await resolveRequestUserId(request.raw.headers as Record<string, unknown>);
    if (!userId) {
      reply.code(401);
      return { error: 'Unauthorized' };
    }

    const sessionId = String((request.params as any)?.sessionId || '');
    if (!sessionId) {
      reply.code(400);
      return { error: 'sessionId is required' };
    }

    const session = await entranceLiveModel.getSessionByIdForUser(userId, sessionId);
    if (!session) {
      reply.code(404);
      return { error: 'Session not found' };
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Connection: 'keep-alive',
      Pragma: 'no-cache',
      Expires: '0',
      'X-Accel-Buffering': 'no',
    });

    let closed = false;
    request.raw.on('close', () => {
      closed = true;
    });

    let lastSequence = 0;
    while (!closed) {
      const frame = getLiveFrame(sessionId);
      if (frame && frame.sequence !== lastSequence) {
        reply.raw.write(buildMultipartFrameChunk(frame));
        lastSequence = frame.sequence;
      }

      await new Promise((resolve) => setTimeout(resolve, frame ? 200 : 500));
    }
  });

  await restServer.listen(8950, "0.0.0.0");
}
