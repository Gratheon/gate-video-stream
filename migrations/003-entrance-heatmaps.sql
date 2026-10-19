CREATE TABLE IF NOT EXISTS entrance_heatmaps (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  box_id INTEGER NOT NULL,
  heatmap_date DATE NOT NULL,
  image_url VARCHAR(1024) DEFAULT NULL,
  s3_key VARCHAR(512) DEFAULT NULL,
  width INTEGER DEFAULT NULL,
  height INTEGER DEFAULT NULL,
  grid_width INTEGER NOT NULL DEFAULT 96,
  grid_height INTEGER NOT NULL DEFAULT 72,
  heat_grid JSONB DEFAULT NULL,
  trajectory_count INTEGER NOT NULL DEFAULT 0,
  point_count INTEGER NOT NULL DEFAULT 0,
  last_sample_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- MySQL had ON UPDATE CURRENT_TIMESTAMP here; the only UPDATE query sets updated_at=NOW() explicitly.
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT entrance_heatmaps_user_box_date UNIQUE (user_id, box_id, heatmap_date)
);

CREATE INDEX IF NOT EXISTS entrance_heatmaps_user_box_updated ON entrance_heatmaps (user_id, box_id, updated_at);
