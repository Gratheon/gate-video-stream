CREATE TABLE IF NOT EXISTS entrance_live_devices (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  box_id INTEGER NOT NULL,
  device_id VARCHAR(191) DEFAULT NULL,
  app_version VARCHAR(191) DEFAULT NULL,
  camera_status VARCHAR(64) DEFAULT NULL,
  publisher_state VARCHAR(64) DEFAULT NULL,
  last_error_code VARCHAR(64) DEFAULT NULL,
  last_error_message TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status_payload TEXT,
  CONSTRAINT uniq_entrance_live_device_user_box UNIQUE (user_id, box_id)
);

CREATE INDEX IF NOT EXISTS idx_entrance_live_devices_last_seen ON entrance_live_devices (last_seen_at);

CREATE TABLE IF NOT EXISTS entrance_live_sessions (
  id VARCHAR(64) PRIMARY KEY,
  user_id INTEGER NOT NULL,
  box_id INTEGER NOT NULL,
  status VARCHAR(32) NOT NULL,
  quality_profile VARCHAR(64) NOT NULL,
  recording_mode VARCHAR(64) NOT NULL,
  relay_protocol VARCHAR(64) NOT NULL DEFAULT 'stored-clip-handoff',
  playback_url TEXT,
  publisher_url TEXT,
  signaling_token VARCHAR(191) DEFAULT NULL,
  publish_token VARCHAR(191) DEFAULT NULL,
  relay_credentials TEXT,
  clip_handoff_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  handoff_stream_id INTEGER DEFAULT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ DEFAULT NULL,
  stopped_at TIMESTAMPTZ DEFAULT NULL,
  last_keepalive_at TIMESTAMPTZ DEFAULT NULL,
  last_device_seen_at TIMESTAMPTZ DEFAULT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_error_code VARCHAR(64) DEFAULT NULL,
  last_error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_entrance_live_sessions_user_box ON entrance_live_sessions (user_id, box_id);
CREATE INDEX IF NOT EXISTS idx_entrance_live_sessions_status ON entrance_live_sessions (status);
CREATE INDEX IF NOT EXISTS idx_entrance_live_sessions_expires ON entrance_live_sessions (expires_at);

CREATE TABLE IF NOT EXISTS entrance_live_commands (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  user_id INTEGER NOT NULL,
  box_id INTEGER NOT NULL,
  command_type VARCHAR(32) NOT NULL,
  payload TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ DEFAULT NULL,
  acknowledged_at TIMESTAMPTZ DEFAULT NULL,
  ack_status VARCHAR(32) DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_entrance_live_commands_poll ON entrance_live_commands (user_id, box_id, acknowledged_at, created_at);
CREATE INDEX IF NOT EXISTS idx_entrance_live_commands_session ON entrance_live_commands (session_id);
