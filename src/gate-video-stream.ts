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
// import { loopAnalyzeGateVideo } from './workers/video-inferencer'
import fetch from 'cross-fetch';
import { metricsContentType, recordHttpRequest, renderMetrics } from "./metrics";
import openapiSpec from "./openapi";
import { swaggerUIDocsHTML } from "./openapi-docs";

const requestStartTimes = new WeakMap<object, bigint>();

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
      let uid;
      let signature = req.request.raw.headers["internal-router-signature"];

      try {
        const bearer = req.request.raw.headers['authorization'];
        const bearerToken = typeof bearer === 'string' && bearer.startsWith('Bearer ')
          ? bearer.split(' ')[1]
          : undefined;

        // Signature sent by graphql-router so user ID forwarding cannot be faked.
        // Keep backward compatibility with the legacy local-dev signature.
        const trustedRouterSignatures = [config.routerSignature, "a239vmwoeifworg"].filter(Boolean);

        // also allow faking users in dev/test env
        if (signature && trustedRouterSignatures.includes(String(signature))) {
          uid =
            req.request.raw.headers["internal-userid"] ||
            req.request.raw.headers["internal-userId"];
        }

        // API tokens are managed by the user - https://app.gratheon.com/account
        else if (bearerToken) {
          // Define the GraphQL endpoint URL
          const endpoint = `${config.userCycleUrl}/graphql`;

          // Make a POST request with the fetch API
          const bearerTokenValidationResult = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              // You may need to include other headers like authorization if required
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

          uid = bearerTokenValidationResultJSON?.data?.validateApiToken?.id
        }

        // allow direct access in case of upload, use token from header
        // JWT token is sent by the browser, its a session token
        else {
          const token = req.request.raw.headers.token as string | undefined;
          const privateKey = config?.jwt?.privateKey;

          if (!token) {
            logger.warn('JWT token missing in request headers')
            return { uid: undefined };
          }

          if (!privateKey) {
            logger.warn('JWT private key missing in configuration')
            return { uid: undefined };
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

          uid = decoded?.user_id;
        }

        return {
          uid,
        };
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
  await restServer.listen(8950, "0.0.0.0");
}
