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
import cors from "fastify-cors"

import { schema } from "./graphql/schema";
import { resolvers } from "./graphql/resolvers";
import { initStorage } from "./models/storage";
import { registerSchema } from "./graphql/schema-registry";
import config from "./config/index";
import { logger } from "./logger";
import './sentry';
import streamModel from './models/stream'

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

    plugins: [
      fastifyAppClosePlugin(app),
      ApolloServerPluginLandingPageGraphQLPlayground(),
      ApolloServerPluginDrainHttpServer({ httpServer: app.server }),
    ],
    // @ts-ignore
    uploads: {
      maxFileSize: 50000000, // 50 MB
      maxFiles: 1,
    },
    context: async (req) => {
      let uid;
      let signature = req.request.raw.headers["internal-router-signature"];

      // signature sent by router so that it cannot be faked
      if (signature === config.routerSignature) {
        uid = req.request.raw.headers["internal-userid"];
      }

      // allow direct access in case of upload
      else {
        const token = req.request.raw.headers.token;
        const decoded = await new Promise((resolve, reject) =>
          jwt.verify(token, config.jwt.privateKey, function (err, decoded) {
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
    },
  });

  await server.start();
  app.register(server.createHandler());

  return server.graphqlPath;
}

(async function main() {
  logger.info('Starting service...');

  await initStorage(logger);

  const app = fastify({
    logger,
  });

  try {
    const version = fs.readFileSync(path.resolve(".version"), "utf8");
    await registerSchema(schema, version);
    const relPath = await startApolloServer(app, schema, resolvers);

    // @ts-ignore
    await app.listen(process.env.PORT, "0.0.0.0");
    logger.info(`Graphql server ready at http://localhost:${process.env.PORT}${relPath}`);


    // REST server
    const app2 = fastify({
      logger,
    });
  
    app2.register(cors, {
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE']
    });
  
    app2.route({
      method: 'GET',
      url: '/hls/:boxId/:streamId/playlist.m3u8',
      handler: async function (request, reply) {
        reply.header('Content-Type', 'application/vnd.apple.mpegurl');
        const playlist = await streamModel.generateHlsPlaylist(
          4,
          //@ts-ignore
          request.params.boxId,
          //@ts-ignore
          request.params.streamId
        )
        reply.send(playlist)
      }
    })
    await app2.listen(8950, "0.0.0.0");

    logger.info(`Server ready at http://localhost:8950`);
  } catch (e) {
    console.error(e);
  }
})();
