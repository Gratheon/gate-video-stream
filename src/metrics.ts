import client from "prom-client";

const register = new client.Registry();

register.setDefaultLabels({
  service: "gate-video-stream",
});

client.collectDefaultMetrics({ register });

export const httpRequestDurationSeconds = new client.Histogram({
  name: "gate_video_stream_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [register],
});

export const httpRequestsTotal = new client.Counter({
  name: "gate_video_stream_http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [register],
});

export const graphqlResolverDurationSeconds = new client.Histogram({
  name: "gate_video_stream_graphql_resolver_duration_seconds",
  help: "GraphQL resolver duration in seconds",
  labelNames: ["operation_type", "resolver_name", "status", "user_id"] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [register],
});

export const graphqlResolverCallsTotal = new client.Counter({
  name: "gate_video_stream_graphql_resolver_calls_total",
  help: "Total number of GraphQL resolver calls",
  labelNames: ["operation_type", "resolver_name", "status", "user_id"] as const,
  registers: [register],
});

export const dbQueryDurationSeconds = new client.Histogram({
  name: "gate_video_stream_db_query_duration_seconds",
  help: "Database query duration in seconds",
  labelNames: ["operation", "query_shape", "status"] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [register],
});

export const dbQueriesTotal = new client.Counter({
  name: "gate_video_stream_db_queries_total",
  help: "Total number of database queries",
  labelNames: ["operation", "query_shape", "status"] as const,
  registers: [register],
});

function normalizeUserId(userId: unknown): string {
  if (typeof userId === "string" && userId.trim().length > 0) {
    return userId.slice(0, 128);
  }

  if (typeof userId === "number" || typeof userId === "bigint") {
    return String(userId);
  }

  return "anonymous";
}

export function recordHttpRequest(input: {
  method: string;
  route: string;
  statusCode: number;
  durationSeconds: number;
}) {
  const labels = {
    method: input.method,
    route: input.route,
    status_code: String(input.statusCode),
  };

  httpRequestsTotal.inc(labels);
  httpRequestDurationSeconds.observe(labels, input.durationSeconds);
}

export function recordGraphqlResolverCall(input: {
  operationType: string;
  resolverName: string;
  status: "success" | "error";
  durationSeconds: number;
  userId: unknown;
}) {
  const labels = {
    operation_type: input.operationType,
    resolver_name: input.resolverName,
    status: input.status,
    user_id: normalizeUserId(input.userId),
  };

  graphqlResolverCallsTotal.inc(labels);
  graphqlResolverDurationSeconds.observe(labels, input.durationSeconds);
}

export function recordDbQuery(input: {
  operation: string;
  queryShape: string;
  status: "success" | "error";
  durationSeconds: number;
}) {
  const labels = {
    operation: input.operation,
    query_shape: input.queryShape,
    status: input.status,
  };

  dbQueriesTotal.inc(labels);
  dbQueryDurationSeconds.observe(labels, input.durationSeconds);
}

type ResolverMap = Record<string, any>;
type ResolverFunction = (...args: any[]) => any;

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return !!value && typeof (value as { then?: unknown }).then === "function";
}

export function wrapGraphqlResolversWithMetrics<T extends ResolverMap>(resolverMap: T): T {
  const wrapped = { ...resolverMap } as ResolverMap;

  for (const [operationType, operationResolvers] of Object.entries(resolverMap)) {
    if (!operationResolvers || typeof operationResolvers !== "object" || Array.isArray(operationResolvers)) {
      continue;
    }

    const wrappedOperationResolvers = { ...operationResolvers } as ResolverMap;

    for (const [resolverName, resolver] of Object.entries(operationResolvers as ResolverMap)) {
      if (typeof resolver !== "function") {
        continue;
      }

      const originalResolver = resolver as ResolverFunction;

      wrappedOperationResolvers[resolverName] = function wrappedResolver(this: unknown, ...args: any[]) {
        const start = process.hrtime.bigint();
        const resolverContext = (args[2] as { uid?: unknown } | undefined) || {};
        const userId = resolverContext.uid;

        const observe = (status: "success" | "error") => {
          const elapsedNanoseconds = Number(process.hrtime.bigint() - start);
          const durationSeconds = elapsedNanoseconds / 1_000_000_000;

          recordGraphqlResolverCall({
            operationType,
            resolverName,
            status,
            durationSeconds,
            userId,
          });
        };

        try {
          const result = originalResolver.apply(this, args);

          if (isPromiseLike(result)) {
            return result.then((value) => {
              observe("success");
              return value;
            }).catch((error) => {
              observe("error");
              throw error;
            });
          }

          observe("success");
          return result;
        } catch (error) {
          observe("error");
          throw error;
        }
      };
    }

    wrapped[operationType] = wrappedOperationResolvers;
  }

  return wrapped as T;
}

export async function renderMetrics(): Promise<string> {
  return register.metrics();
}

export const metricsContentType = register.contentType;
