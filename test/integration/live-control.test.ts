import fetch from 'node-fetch';

declare const process: {
  env: Record<string, string | undefined>;
};

const graphqlEndpoint = process.env.GATE_VIDEO_STREAM_GRAPHQL_URL || 'http://localhost:8900/graphql';
const restEndpoint = process.env.GATE_VIDEO_STREAM_REST_URL || 'http://localhost:8950';
const internalUserId = process.env.GATE_VIDEO_STREAM_TEST_USER_ID || '424242';
const internalRouterSignature = process.env.GATE_VIDEO_STREAM_TEST_ROUTER_SIGNATURE || 'a239vmwoeifworg';

const graphqlHeaders = {
  'Content-Type': 'application/json',
  'internal-userid': internalUserId,
  'internal-router-signature': internalRouterSignature,
};

const restHeaders = {
  'Content-Type': 'application/json',
  'internal-userid': internalUserId,
  'internal-router-signature': internalRouterSignature,
};

async function waitForService(url: string) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(url, {
        timeout: 2000,
      });
      if (response.ok) {
        return;
      }
      lastError = new Error(`Unexpected status ${response.status} from ${url}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`gate-video-stream integration target is unavailable at ${url}: ${String(lastError)}`);
}

async function graphqlRequest<T>(query: string, variables: Record<string, unknown>) {
  const response = await fetch(graphqlEndpoint, {
    method: 'POST',
    headers: graphqlHeaders,
    body: JSON.stringify({ query, variables }),
    timeout: 10000,
  });

  const body = await response.json() as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };

  if (!response.ok || body.errors?.length) {
    throw new Error(`GraphQL request failed: ${JSON.stringify(body.errors || body)}`);
  }

  return body.data as T;
}

async function restRequest<T>(path: string, payload: Record<string, unknown>) {
  const response = await fetch(`${restEndpoint}${path}`, {
    method: 'POST',
    headers: restHeaders,
    body: JSON.stringify(payload),
  });

  const body = await response.json() as T;
  if (!response.ok) {
    throw new Error(`REST request failed for ${path}: ${JSON.stringify(body)}`);
  }

  return body;
}
async function publishFrame(path: string, publishToken: string, frameBytes: Uint8Array, contentType = 'application/octet-stream') {
  const response = await fetch(`${restEndpoint}${path}`, {
    method: 'POST',
    headers: {
      ...restHeaders,
      'Content-Type': contentType,
      'X-Publish-Token': publishToken,
    },
    body: frameBytes,
  });

  const body = await response.json() as { ok?: boolean; bytes?: number; error?: string };
  if (!response.ok) {
    throw new Error(`Frame publish failed for ${path}: ${JSON.stringify(body)}`);
  }

  return body;
}

function buildTestBoxId() {
  return String(1_000_000_000 + Math.floor(Math.random() * 100_000_000));
}

describe('Entrance Observer live control integration flow', () => {
  it('covers start, keepalive, poll, ack, stop, and device-driven state transitions', async () => {
    await waitForService(`${restEndpoint}/openapi.json`);

    const boxId = buildTestBoxId();

    await restRequest('/api/entrance-live/device/event', {
      boxId,
      eventType: 'DEVICE_ONLINE',
      payload: {
        cameraStatus: 'ok',
        publisherState: 'idle',
      },
    });

    const started = await graphqlRequest<{
      startEntranceLiveStream: {
        id: string;
        boxId: string;
        status: string;
        qualityProfile: string;
        recordingMode: string;
        relayProtocol: string;
        playbackUrl: string;
        publisherUrl: string;
        publishToken: string;
        clipHandoffEnabled: boolean;
        expiresAt: string;
        lastKeepaliveAt: string;
        relayDetails: {
          relayProtocol: string;
          placeholder: boolean;
          publisherUrl: string;
          publishToken: string;
          playbackUrl: string;
          frameContentType: string;
          playbackContentType: string;
        };
      };
    }>(`
      mutation StartEntranceLiveStream($boxId: ID!, $qualityProfile: String, $recordingMode: String) {
        startEntranceLiveStream(boxId: $boxId, qualityProfile: $qualityProfile, recordingMode: $recordingMode) {
          id
          boxId
          status
          qualityProfile
          recordingMode
          relayProtocol
          playbackUrl
          publisherUrl
          publishToken
          clipHandoffEnabled
          expiresAt
          lastKeepaliveAt
          relayDetails {
            relayProtocol
            placeholder
            publisherUrl
            publishToken
            playbackUrl
            frameContentType
            playbackContentType
          }
        }
      }
    `, {
      boxId,
      qualityProfile: 'inspect',
      recordingMode: 'manual',
    });

    expect(started.startEntranceLiveStream.boxId).toBe(boxId);
    expect(started.startEntranceLiveStream.status).toBe('REQUESTED');
    expect(started.startEntranceLiveStream.qualityProfile).toBe('inspect');
    expect(started.startEntranceLiveStream.recordingMode).toBe('manual');
    expect(started.startEntranceLiveStream.clipHandoffEnabled).toBe(true);
    expect(started.startEntranceLiveStream.playbackUrl).toContain(`${started.startEntranceLiveStream.id}.mjpeg`);
    expect(started.startEntranceLiveStream.publisherUrl).toContain(`${started.startEntranceLiveStream.id}/frame`);
    expect(started.startEntranceLiveStream.relayDetails.frameContentType).toBe('image/jpeg');
    expect(started.startEntranceLiveStream.relayDetails.playbackContentType).toBe('multipart/x-mixed-replace; boundary=frame');

    const sessionId = started.startEntranceLiveStream.id;

    const firstPoll = await restRequest<{
      commands: Array<{
        id: number;
        sessionId: string;
        commandType: string;
        payload: {
          qualityProfile: string;
          recordingMode: string;
          relayProtocol: string;
          playbackUrl: string;
          publisherUrl: string;
          publishToken: string;
          relayCredentials: {
            sessionId: string;
            boxId: string;
          };
        };
      }>;
    }>('/api/entrance-live/device/poll', {
      boxId,
      cameraStatus: 'ok',
      publisherState: 'idle',
      limit: 10,
    });

    expect(firstPoll.commands).toHaveLength(1);
    expect(firstPoll.commands[0].sessionId).toBe(sessionId);
    expect(firstPoll.commands[0].commandType).toBe('START_STREAM');
    expect(firstPoll.commands[0].payload.qualityProfile).toBe('inspect');
    expect(firstPoll.commands[0].payload.recordingMode).toBe('manual');
    expect(firstPoll.commands[0].payload.playbackUrl).toBe(started.startEntranceLiveStream.playbackUrl);
    expect(firstPoll.commands[0].payload.publisherUrl).toBe(started.startEntranceLiveStream.publisherUrl);
    expect(firstPoll.commands[0].payload.publishToken).toBe(started.startEntranceLiveStream.publishToken);
    expect(firstPoll.commands[0].payload.relayCredentials.sessionId).toBe(sessionId);
    expect(firstPoll.commands[0].payload.relayCredentials.boxId).toBe(boxId);

    await restRequest('/api/entrance-live/device/command-ack', {
      boxId,
      commandId: firstPoll.commands[0].id,
      status: 'accepted',
      payload: {
        publisherState: 'starting',
      },
    });

    const secondPoll = await restRequest<{ commands: Array<unknown> }>('/api/entrance-live/device/poll', {
      boxId,
      cameraStatus: 'ok',
      publisherState: 'starting',
      limit: 10,
    });

    expect(secondPoll.commands).toEqual([]);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const keptAlive = await graphqlRequest<{
      keepEntranceLiveStreamAlive: {
        id: string;
        status: string;
        expiresAt: string;
        lastKeepaliveAt: string;
      };
    }>(`
      mutation KeepEntranceLiveStreamAlive($sessionId: ID!) {
        keepEntranceLiveStreamAlive(sessionId: $sessionId) {
          id
          status
          expiresAt
          lastKeepaliveAt
        }
      }
    `, {
      sessionId,
    });

    expect(keptAlive.keepEntranceLiveStreamAlive.id).toBe(sessionId);
    expect(keptAlive.keepEntranceLiveStreamAlive.status).toBe('REQUESTED');
    expect(new Date(keptAlive.keepEntranceLiveStreamAlive.expiresAt).getTime()).toBeGreaterThanOrEqual(
      new Date(started.startEntranceLiveStream.expiresAt).getTime()
    );
    expect(new Date(keptAlive.keepEntranceLiveStreamAlive.lastKeepaliveAt).getTime()).toBeGreaterThanOrEqual(
      new Date(started.startEntranceLiveStream.lastKeepaliveAt).getTime()
    );

    await restRequest('/api/entrance-live/device/event', {
      boxId,
      sessionId,
      eventType: 'STREAM_STARTING',
      payload: {
        cameraStatus: 'ok',
        publisherState: 'starting',
      },
    });

    const startingSession = await graphqlRequest<{
      entranceLiveStreamSession: {
        id: string;
        status: string;
      };
    }>(`
      query EntranceLiveStreamSession($boxId: ID!) {
        entranceLiveStreamSession(boxId: $boxId) {
          id
          status
        }
      }
    `, {
      boxId,
    });

    expect(startingSession.entranceLiveStreamSession.id).toBe(sessionId);
    expect(startingSession.entranceLiveStreamSession.status).toBe('STARTING');

    await restRequest('/api/entrance-live/device/event', {
      boxId,
      sessionId,
      eventType: 'STREAM_ACTIVE',
      payload: {
        cameraStatus: 'ok',
        publisherState: 'streaming',
        fps: 15,
        bitrate: 1500,
        resolution: '1280x720',
        encoder: 'h264',
      },
    });

    const activeSession = await graphqlRequest<{
      entranceLiveStreamSession: {
        id: string;
        status: string;
        lastErrorCode: string | null;
      };
    }>(`
      query EntranceLiveStreamSession($boxId: ID!) {
        entranceLiveStreamSession(boxId: $boxId) {
          id
          status
          lastErrorCode
        }
      }
    `, {
      boxId,
    });

    expect(activeSession.entranceLiveStreamSession.id).toBe(sessionId);
    expect(activeSession.entranceLiveStreamSession.status).toBe('ACTIVE');
    expect(activeSession.entranceLiveStreamSession.lastErrorCode).toBeNull();


    const fakeJpegFrame = new Uint8Array([0xff, 0xd8, 0x01, 0x02, 0x03, 0xff, 0xd9]);
    const publishedFrame = await publishFrame(
      `/live/publish/${sessionId}/frame`,
      started.startEntranceLiveStream.publishToken,
      fakeJpegFrame,
      'application/octet-stream'
    );

    expect(publishedFrame.ok).toBe(true);
    expect(publishedFrame.bytes).toBe(fakeJpegFrame.length);
    const stopped = await graphqlRequest<{
      stopEntranceLiveStream: boolean;
    }>(`
      mutation StopEntranceLiveStream($sessionId: ID!) {
        stopEntranceLiveStream(sessionId: $sessionId)
      }
    `, {
      sessionId,
    });

    expect(stopped.stopEntranceLiveStream).toBe(true);

    const stoppingSession = await graphqlRequest<{
      entranceLiveStreamSession: {
        id: string;
        status: string;
      };
    }>(`
      query EntranceLiveStreamSession($boxId: ID!) {
        entranceLiveStreamSession(boxId: $boxId) {
          id
          status
        }
      }
    `, {
      boxId,
    });

    expect(stoppingSession.entranceLiveStreamSession.id).toBe(sessionId);
    expect(stoppingSession.entranceLiveStreamSession.status).toBe('STOPPING');

    const stopPoll = await restRequest<{
      commands: Array<{
        id: number;
        sessionId: string;
        commandType: string;
      }>;
    }>('/api/entrance-live/device/poll', {
      boxId,
      cameraStatus: 'ok',
      publisherState: 'stopping',
      limit: 10,
    });

    expect(stopPoll.commands).toHaveLength(1);
    expect(stopPoll.commands[0].sessionId).toBe(sessionId);
    expect(stopPoll.commands[0].commandType).toBe('STOP_STREAM');

    await restRequest('/api/entrance-live/device/command-ack', {
      boxId,
      commandId: stopPoll.commands[0].id,
      status: 'accepted',
      payload: {
        publisherState: 'stopping',
      },
    });

    await restRequest('/api/entrance-live/device/event', {
      boxId,
      sessionId,
      eventType: 'STREAM_STOPPED',
      payload: {
        cameraStatus: 'ok',
        publisherState: 'idle',
        reason: 'user-requested-stop',
      },
    });

    const finishedSession = await graphqlRequest<{
      entranceLiveStreamSession: {
        id: string;
        status: string;
      } | null;
    }>(`
      query EntranceLiveStreamSession($boxId: ID!) {
        entranceLiveStreamSession(boxId: $boxId) {
          id
          status
        }
      }
    `, {
      boxId,
    });

    expect(finishedSession.entranceLiveStreamSession).toBeNull();
  });
});
