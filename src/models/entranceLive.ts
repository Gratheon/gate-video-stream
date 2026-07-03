import crypto from "crypto";
import { sql } from "@databases/mysql";

import { storage } from "./storage";
import { clearLiveFrame } from "./entranceLiveMedia";

const SESSION_TTL_MINUTES = 10;
const DEVICE_ONLINE_GRACE_SECONDS = 120;

export type EntranceLiveSessionStatus =
  | "REQUESTED"
  | "DEVICE_OFFLINE"
  | "STARTING"
  | "ACTIVE"
  | "STOPPING"
  | "STOPPED"
  | "FAILED";

export type EntranceLiveCommandType =
  | "START_STREAM"
  | "STOP_STREAM"
  | "UPDATE_QUALITY"
  | "HEALTH_CHECK";

export type DeviceStatusInput = {
  boxId: string | number;
  deviceId?: string | null;
  appVersion?: string | null;
  cameraStatus?: string | null;
  publisherState?: string | null;
  status?: Record<string, unknown>;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
};

export type DeviceEventInput = {
  sessionId?: string | null;
  eventType: string;
  payload?: Record<string, unknown>;
};

type StartSessionInput = {
  userId: string | number;
  boxId: string | number;
  qualityProfile?: string | null;
  recordingMode?: string | null;
};

function toNullableJson(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  return JSON.stringify(value);
}

function parseJsonValue(value: unknown) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function normalizeSessionRow(row: any) {
  if (!row) {
    return null;
  }

  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId ?? ""),
    boxId: String(row.box_id ?? row.boxId),
    status: row.status,
    qualityProfile: row.quality_profile ?? row.qualityProfile,
    recordingMode: row.recording_mode ?? row.recordingMode,
    relayProtocol: row.relay_protocol ?? row.relayProtocol,
    playbackUrl: row.playback_url ?? row.playbackUrl,
    publisherUrl: row.publisher_url ?? row.publisherUrl,
    signalingToken: row.signaling_token ?? row.signalingToken,
    publishToken: row.publish_token ?? row.publishToken,
    relayCredentials: parseJsonValue(row.relay_credentials ?? row.relayCredentials),
    clipHandoffEnabled: Boolean(row.clip_handoff_enabled ?? row.clipHandoffEnabled),
    handoffStreamId: row.handoff_stream_id ?? row.handoffStreamId ?? null,
    requestedAt: row.requested_at ?? row.requestedAt ?? null,
    activatedAt: row.activated_at ?? row.activatedAt ?? null,
    stoppedAt: row.stopped_at ?? row.stoppedAt ?? null,
    lastKeepaliveAt: row.last_keepalive_at ?? row.lastKeepaliveAt ?? null,
    lastDeviceSeenAt: row.last_device_seen_at ?? row.lastDeviceSeenAt ?? null,
    expiresAt: row.expires_at ?? row.expiresAt,
    lastErrorCode: row.last_error_code ?? row.lastErrorCode ?? null,
    lastErrorMessage: row.last_error_message ?? row.lastErrorMessage ?? null,
  };
}

function buildRelayDetails(sessionId: string, userId: string | number, boxId: string | number) {
  const publishToken = crypto.randomBytes(12).toString("hex");
  const signalingToken = crypto.randomBytes(12).toString("hex");
  const relayProtocol = process.env.ENTRANCE_LIVE_RELAY_PROTOCOL || "http-jpeg-push";
  const playbackBaseUrl = process.env.ENTRANCE_LIVE_PLAYBACK_BASE_URL || "https://video.gratheon.com/live/playback";
  const publishBaseUrl = process.env.ENTRANCE_LIVE_PUBLISH_BASE_URL || "https://video.gratheon.com/live/publish";
  const playbackUrl = `${playbackBaseUrl}/${sessionId}.mjpeg`;
  const publisherUrl = `${publishBaseUrl}/${sessionId}/frame`;

  return {
    relayProtocol,
    playbackUrl,
    publisherUrl,
    signalingToken,
    publishToken,
    relayCredentials: {
      relayProtocol,
      sessionId,
      boxId: String(boxId),
      userId: String(userId),
      publishToken,
      signalingToken,
      publisherUrl,
      playbackUrl,
      frameContentType: "image/jpeg",
      playbackContentType: "multipart/x-mixed-replace; boundary=frame",
      framePushPath: `/live/publish/${sessionId}/frame`,
      // WHY: The service still owns all playback URLs so the browser never learns a device-private address.
      // WHAT: The device only gets a short-lived outbound publish endpoint and token for JPEG frame push.
      placeholder: false,
    },
  };
}

async function getExistingActiveSession(userId: string | number, boxId: string | number) {
  const rows = await storage().query(sql`
    SELECT *
    FROM entrance_live_sessions
    WHERE user_id = ${userId}
      AND box_id = ${boxId}
      AND status IN ('REQUESTED', 'DEVICE_OFFLINE', 'STARTING', 'ACTIVE', 'STOPPING')
      AND expires_at > NOW()
    ORDER BY requested_at DESC
    LIMIT 1
  `);

  return normalizeSessionRow(rows[0]);
}

async function isDeviceOnline(userId: string | number, boxId: string | number) {
  const rows = await storage().query(sql`
    SELECT id
    FROM entrance_live_devices
    WHERE user_id = ${userId}
      AND box_id = ${boxId}
      AND last_seen_at >= DATE_SUB(NOW(), INTERVAL ${DEVICE_ONLINE_GRACE_SECONDS} SECOND)
    LIMIT 1
  `);

  return rows.length > 0;
}

async function insertCommand(
  userId: string | number,
  boxId: string | number,
  sessionId: string,
  commandType: EntranceLiveCommandType,
  payload: Record<string, unknown>
) {
  await storage().query(sql`
    INSERT INTO entrance_live_commands (
      session_id,
      user_id,
      box_id,
      command_type,
      payload
    ) VALUES (
      ${sessionId},
      ${userId},
      ${boxId},
      ${commandType},
      ${toNullableJson(payload)}
    )
  `);
}

async function getSessionById(sessionId: string) {
  const rows = await storage().query(sql`
    SELECT *
    FROM entrance_live_sessions
    WHERE id = ${sessionId}
    LIMIT 1
  `);

  return normalizeSessionRow(rows[0]);
}

export default {
  async startSession(input: StartSessionInput) {
    const qualityProfile = input.qualityProfile || "inspect";
    const recordingMode = input.recordingMode || "off";
    const userId = input.userId;
    const boxId = input.boxId;

    const existing = await getExistingActiveSession(userId, boxId);
    if (existing) {
      return existing;
    }

    const sessionId = crypto.randomBytes(18).toString("hex");
    const relay = buildRelayDetails(sessionId, userId, boxId);
    const clipHandoffEnabled = ["manual", "event", "sampled", "always", "onDemand"].includes(recordingMode);
    const deviceOnline = await isDeviceOnline(userId, boxId);
    const status: EntranceLiveSessionStatus = deviceOnline ? "REQUESTED" : "DEVICE_OFFLINE";

    await storage().query(sql`
      INSERT INTO entrance_live_sessions (
        id,
        user_id,
        box_id,
        status,
        quality_profile,
        recording_mode,
        relay_protocol,
        playback_url,
        publisher_url,
        signaling_token,
        publish_token,
        relay_credentials,
        clip_handoff_enabled,
        expires_at,
        last_keepalive_at
      ) VALUES (
        ${sessionId},
        ${userId},
        ${boxId},
        ${status},
        ${qualityProfile},
        ${recordingMode},
        ${relay.relayProtocol},
        ${relay.playbackUrl},
        ${relay.publisherUrl},
        ${relay.signalingToken},
        ${relay.publishToken},
        ${toNullableJson(relay.relayCredentials)},
        ${clipHandoffEnabled ? 1 : 0},
        DATE_ADD(NOW(), INTERVAL ${SESSION_TTL_MINUTES} MINUTE),
        NOW()
      )
    `);

    await insertCommand(userId, boxId, sessionId, "START_STREAM", {
      sessionId,
      boxId: String(boxId),
      qualityProfile,
      recordingMode,
      relayProtocol: relay.relayProtocol,
      playbackUrl: relay.playbackUrl,
      publisherUrl: relay.publisherUrl,
      signalingToken: relay.signalingToken,
      publishToken: relay.publishToken,
      relayCredentials: relay.relayCredentials,
      clipHandoffEnabled,
    });

    return getSessionById(sessionId);
  },

  async stopSession(userId: string | number, sessionId: string) {
    const session = await getSessionById(sessionId);
    if (!session || String((session as any).userId ?? userId) !== String(userId)) {
      return false;
    }

    await storage().query(sql`
      UPDATE entrance_live_sessions
      SET status = 'STOPPING',
          stopped_at = COALESCE(stopped_at, NOW()),
          expires_at = LEAST(expires_at, DATE_ADD(NOW(), INTERVAL 30 SECOND))
      WHERE id = ${sessionId}
        AND user_id = ${userId}
    `);

    await insertCommand(userId, session.boxId, sessionId, "STOP_STREAM", {
      sessionId,
      boxId: session.boxId,
    });

    clearLiveFrame(sessionId);

    return true;
  },

  async keepAlive(userId: string | number, sessionId: string) {
    await storage().query(sql`
      UPDATE entrance_live_sessions
      SET last_keepalive_at = NOW(),
          expires_at = DATE_ADD(NOW(), INTERVAL ${SESSION_TTL_MINUTES} MINUTE)
      WHERE id = ${sessionId}
        AND user_id = ${userId}
        AND status IN ('REQUESTED', 'DEVICE_OFFLINE', 'STARTING', 'ACTIVE', 'STOPPING')
    `);

    return getSessionById(sessionId);
  },

  async getSessionForBox(userId: string | number, boxId: string | number) {
    const session = await getExistingActiveSession(userId, boxId);
    return session;
  },

  async getSessionByIdForUser(userId: string | number, sessionId: string) {
    const session = await getSessionById(sessionId);
    if (!session) {
      return null;
    }

    const sessionUserId = String((session as any).userId ?? (session as any).user_id ?? "");
    if (sessionUserId && sessionUserId !== String(userId)) {
      return null;
    }

    return session;
  },

  async upsertDeviceStatus(userId: string | number, input: DeviceStatusInput) {
    const payload = input.status || {};

    await storage().query(sql`
      INSERT INTO entrance_live_devices (
        user_id,
        box_id,
        device_id,
        app_version,
        camera_status,
        publisher_state,
        last_error_code,
        last_error_message,
        last_seen_at,
        status_payload
      ) VALUES (
        ${userId},
        ${input.boxId},
        ${input.deviceId || null},
        ${input.appVersion || null},
        ${input.cameraStatus || null},
        ${input.publisherState || null},
        ${input.lastErrorCode || null},
        ${input.lastErrorMessage || null},
        NOW(),
        ${toNullableJson(payload)}
      )
      ON DUPLICATE KEY UPDATE
        device_id = VALUES(device_id),
        app_version = VALUES(app_version),
        camera_status = VALUES(camera_status),
        publisher_state = VALUES(publisher_state),
        last_error_code = VALUES(last_error_code),
        last_error_message = VALUES(last_error_message),
        last_seen_at = NOW(),
        status_payload = VALUES(status_payload)
    `);

    await storage().query(sql`
      UPDATE entrance_live_sessions
      SET last_device_seen_at = NOW(),
          status = CASE
            WHEN status = 'DEVICE_OFFLINE' THEN 'REQUESTED'
            ELSE status
          END
      WHERE user_id = ${userId}
        AND box_id = ${input.boxId}
        AND status IN ('REQUESTED', 'DEVICE_OFFLINE', 'STARTING', 'ACTIVE', 'STOPPING')
        AND expires_at > NOW()
    `);
  },

  async claimPendingCommands(userId: string | number, boxId: string | number, limit = 10) {
    const rows = await storage().query(sql`
      SELECT *
      FROM entrance_live_commands
      WHERE user_id = ${userId}
        AND box_id = ${boxId}
        AND acknowledged_at IS NULL
      ORDER BY created_at ASC
      LIMIT ${limit}
    `);

    if (rows.length > 0) {
      const ids = rows.map((row: any) => row.id);
      await storage().query(sql`
        UPDATE entrance_live_commands
        SET delivered_at = COALESCE(delivered_at, NOW())
        WHERE id IN (${ids})
      `);
    }

    return rows.map((row: any) => ({
      id: row.id,
      sessionId: row.session_id,
      commandType: row.command_type,
      payload: parseJsonValue(row.payload) || {},
      createdAt: row.created_at,
      deliveredAt: row.delivered_at,
    }));
  },

  async acknowledgeCommand(userId: string | number, boxId: string | number, commandId: string | number, status: string, payload?: Record<string, unknown>) {
    await storage().query(sql`
      UPDATE entrance_live_commands
      SET acknowledged_at = NOW(),
          ack_status = ${status},
          payload = ${toNullableJson(payload)}
      WHERE id = ${commandId}
        AND user_id = ${userId}
        AND box_id = ${boxId}
    `);
  },

  async recordDeviceEvent(userId: string | number, boxId: string | number, input: DeviceEventInput) {
    const payload = input.payload || {};
    const sessionId = input.sessionId || String(payload.sessionId || "");

    if (sessionId) {
      if (input.eventType === "STREAM_STARTING") {
        await storage().query(sql`
          UPDATE entrance_live_sessions
          SET status = 'STARTING',
              last_device_seen_at = NOW(),
              last_error_code = NULL,
              last_error_message = NULL
          WHERE id = ${sessionId}
            AND user_id = ${userId}
            AND box_id = ${boxId}
        `);
      } else if (input.eventType === "STREAM_ACTIVE") {
        await storage().query(sql`
          UPDATE entrance_live_sessions
          SET status = 'ACTIVE',
              activated_at = COALESCE(activated_at, NOW()),
              last_device_seen_at = NOW(),
              last_error_code = NULL,
              last_error_message = NULL
          WHERE id = ${sessionId}
            AND user_id = ${userId}
            AND box_id = ${boxId}
        `);
      } else if (input.eventType === "STREAM_FAILED") {
        await storage().query(sql`
          UPDATE entrance_live_sessions
          SET status = 'FAILED',
              stopped_at = COALESCE(stopped_at, NOW()),
              last_device_seen_at = NOW(),
              last_error_code = ${String(payload.errorCode || "STREAM_FAILED")},
              last_error_message = ${String(payload.message || "Device reported stream failure")}
          WHERE id = ${sessionId}
            AND user_id = ${userId}
            AND box_id = ${boxId}
        `);
      } else if (input.eventType === "STREAM_STOPPED") {
        await storage().query(sql`
          UPDATE entrance_live_sessions
          SET status = 'STOPPED',
              stopped_at = COALESCE(stopped_at, NOW()),
              last_device_seen_at = NOW()
          WHERE id = ${sessionId}
            AND user_id = ${userId}
            AND box_id = ${boxId}
        `);
      }
    }

    await this.upsertDeviceStatus(userId, {
      boxId,
      cameraStatus: typeof payload.cameraStatus === "string" ? payload.cameraStatus : null,
      publisherState: typeof payload.publisherState === "string" ? payload.publisherState : null,
      lastErrorCode: typeof payload.errorCode === "string" ? payload.errorCode : null,
      lastErrorMessage: typeof payload.message === "string" ? payload.message : null,
      status: {
        lastEventType: input.eventType,
        ...payload,
      },
    });
  },
};
