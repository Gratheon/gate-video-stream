import { sql } from "@databases/mysql";
import { Readable } from "stream";

import config from "../config/index";
import { storage } from "./storage";
import upload from "./s3";
import { logger } from "../logger";

const DEFAULT_GRID_WIDTH = 96;
const DEFAULT_GRID_HEIGHT = 72;
const MAX_DIMENSION = 4096;

type TrackPoint = [number, number];

type HeatmapUpload = {
  boxId: string | number;
  timestamp?: string;
  frameDimensions?: {
    width?: number;
    height?: number;
  };
  trackHistory?: Record<string, TrackPoint[]>;
};

type HeatmapRow = {
  id: number;
  userId?: string | number;
  boxId: string | number;
  heatmapDate: string | Date;
  imageUrl?: string;
  s3Key?: string;
  width?: number;
  height?: number;
  gridWidth?: number;
  gridHeight?: number;
  heatGrid?: number[][] | string | null;
  trajectoryCount?: number;
  pointCount?: number;
  lastSampleAt?: Date | string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

function clampDimension(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(MAX_DIMENSION, Math.round(parsed));
}

function parseUploadDate(timestamp?: string) {
  const date = timestamp ? new Date(timestamp) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date();
  }
  return date;
}

function toSqlDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function createGrid(width = DEFAULT_GRID_WIDTH, height = DEFAULT_GRID_HEIGHT) {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => 0));
}

function parseGrid(raw: unknown, width: number, height: number) {
  if (!raw) {
    return createGrid(width, height);
  }

  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed) || parsed.length !== height) {
      return createGrid(width, height);
    }

    return parsed.map((row) => {
      if (!Array.isArray(row)) {
        return Array.from({ length: width }, () => 0);
      }
      return Array.from({ length: width }, (_, index) => Number(row[index]) || 0);
    });
  } catch (error) {
    logger.error('Could not parse existing heatmap grid', error);
    return createGrid(width, height);
  }
}

function addTracksToGrid(grid: number[][], payload: HeatmapUpload, width: number, height: number) {
  const sourceWidth = clampDimension(payload.frameDimensions?.width, width);
  const sourceHeight = clampDimension(payload.frameDimensions?.height, height);
  const gridHeight = grid.length;
  const gridWidth = grid[0]?.length || DEFAULT_GRID_WIDTH;
  let trajectoryCount = 0;
  let pointCount = 0;

  for (const track of Object.values(payload.trackHistory || {})) {
    if (!Array.isArray(track) || track.length === 0) {
      continue;
    }

    trajectoryCount += 1;
    for (const point of track) {
      if (!Array.isArray(point) || point.length < 2) {
        continue;
      }

      const x = Number(point[0]);
      const y = Number(point[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= sourceWidth || y >= sourceHeight) {
        continue;
      }

      const gridX = Math.max(0, Math.min(gridWidth - 1, Math.floor((x / sourceWidth) * gridWidth)));
      const gridY = Math.max(0, Math.min(gridHeight - 1, Math.floor((y / sourceHeight) * gridHeight)));
      grid[gridY][gridX] += 1;
      pointCount += 1;
    }
  }

  return { trajectoryCount, pointCount };
}

function colorForIntensity(value: number) {
  const clamped = Math.max(0, Math.min(1, value));
  const stops = [
    [0, 0, 0],
    [80, 0, 0],
    [180, 20, 0],
    [255, 120, 0],
    [255, 230, 80],
    [255, 255, 255],
  ];
  const scaled = clamped * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const local = scaled - index;
  const from = stops[index];
  const to = stops[index + 1];
  const rgb = from.map((channel, i) => Math.round(channel + (to[i] - channel) * local));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

function renderHeatmapSvg(grid: number[][], width: number, height: number, heatmapDate: string) {
  const gridHeight = grid.length;
  const gridWidth = grid[0]?.length || DEFAULT_GRID_WIDTH;
  const cellWidth = width / gridWidth;
  const cellHeight = height / gridHeight;
  const maxCount = grid.flat().reduce((max, value) => Math.max(max, Number(value) || 0), 0);

  const cells: string[] = [];
  for (let y = 0; y < gridHeight; y += 1) {
    for (let x = 0; x < gridWidth; x += 1) {
      const value = grid[y][x] || 0;
      if (value <= 0 || maxCount <= 0) {
        continue;
      }

      // WHY: log scaling keeps busy and moderately visited landing board areas visible
      // instead of letting a few dense cells dominate the entire daily heatmap.
      const intensity = Math.log1p(value) / Math.log1p(maxCount);
      const opacity = Math.max(0.18, Math.min(0.95, intensity));
      cells.push(
        `<rect x="${(x * cellWidth).toFixed(2)}" y="${(y * cellHeight).toFixed(2)}" width="${Math.ceil(cellWidth) + 1}" height="${Math.ceil(cellHeight) + 1}" fill="${colorForIntensity(intensity)}" opacity="${opacity.toFixed(3)}" />`
      );
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Entrance trajectory heatmap for ${heatmapDate}">
  <rect width="100%" height="100%" fill="#050505" />
  ${cells.join('\n  ')}
</svg>
`;
}

function getUploadRelPath(userId: string | number, boxId: string | number, heatmapDate: string) {
  return `${userId}/gate_heatmaps/${boxId}/${heatmapDate}.svg`;
}

function getImageUrl(userId: string | number, boxId: string | number, heatmapDate: string) {
  return `${config.files_base_url}${getUploadRelPath(userId, boxId, heatmapDate)}`;
}

async function findByDate(userId: string | number, boxId: string | number, heatmapDate: string): Promise<HeatmapRow | null> {
  const rows = await storage().query(sql`
    SELECT id,
      user_id as userId,
      box_id as boxId,
      heatmap_date as heatmapDate,
      image_url as imageUrl,
      s3_key as s3Key,
      width,
      height,
      grid_width as gridWidth,
      grid_height as gridHeight,
      heat_grid as heatGrid,
      trajectory_count as trajectoryCount,
      point_count as pointCount,
      last_sample_at as lastSampleAt,
      created_at as createdAt,
      updated_at as updatedAt
    FROM entrance_heatmaps
    WHERE user_id=${userId} AND box_id=${boxId} AND heatmap_date=${heatmapDate}
    LIMIT 1
  `);

  return rows[0] || null;
}

function mapRow(row: HeatmapRow | null) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    boxId: row.boxId,
    date: row.heatmapDate instanceof Date ? row.heatmapDate.toISOString().slice(0, 10) : String(row.heatmapDate),
    imageURL: row.imageUrl,
    width: row.width,
    height: row.height,
    trajectoryCount: row.trajectoryCount || 0,
    pointCount: row.pointCount || 0,
    lastSampleAt: row.lastSampleAt,
    updatedAt: row.updatedAt,
  };
}

export default {
  async ingestTrajectories(userId: string | number, payload: HeatmapUpload) {
    if (!payload.boxId) {
      throw new Error('boxId is required');
    }

    if (!payload.trackHistory || Object.keys(payload.trackHistory).length === 0) {
      throw new Error('trackHistory is required');
    }

    const sampleDate = parseUploadDate(payload.timestamp);
    const heatmapDate = toSqlDate(sampleDate);
    const existing = await findByDate(userId, payload.boxId, heatmapDate);
    const width = clampDimension(payload.frameDimensions?.width, existing?.width || 1280);
    const height = clampDimension(payload.frameDimensions?.height, existing?.height || 720);
    const gridWidth = existing?.gridWidth || DEFAULT_GRID_WIDTH;
    const gridHeight = existing?.gridHeight || DEFAULT_GRID_HEIGHT;
    const grid = parseGrid(existing?.heatGrid, gridWidth, gridHeight);
    const added = addTracksToGrid(grid, payload, width, height);

    if (added.pointCount === 0) {
      logger.info('Heatmap trajectory upload had no valid points', { userId, boxId: payload.boxId, heatmapDate });
    }

    const svg = renderHeatmapSvg(grid, width, height, heatmapDate);
    const s3Key = getUploadRelPath(userId, payload.boxId, heatmapDate);
    await upload(Readable.from([svg]), s3Key);
    const imageUrl = getImageUrl(userId, payload.boxId, heatmapDate);
    const serializedGrid = JSON.stringify(grid);

    if (existing) {
      await storage().query(sql`
        UPDATE entrance_heatmaps
        SET image_url=${imageUrl},
          s3_key=${s3Key},
          width=${width},
          height=${height},
          heat_grid=CAST(${serializedGrid} AS JSON),
          trajectory_count=trajectory_count + ${added.trajectoryCount},
          point_count=point_count + ${added.pointCount},
          last_sample_at=${sampleDate},
          updated_at=NOW()
        WHERE id=${existing.id}
      `);
    } else {
      await storage().query(sql`
        INSERT INTO entrance_heatmaps (
          user_id,
          box_id,
          heatmap_date,
          image_url,
          s3_key,
          width,
          height,
          grid_width,
          grid_height,
          heat_grid,
          trajectory_count,
          point_count,
          last_sample_at
        ) VALUES (
          ${userId},
          ${payload.boxId},
          ${heatmapDate},
          ${imageUrl},
          ${s3Key},
          ${width},
          ${height},
          ${gridWidth},
          ${gridHeight},
          CAST(${serializedGrid} AS JSON),
          ${added.trajectoryCount},
          ${added.pointCount},
          ${sampleDate}
        )
      `);
    }

    return mapRow(await findByDate(userId, payload.boxId, heatmapDate));
  },

  async list(userId: string | number, boxIds: Array<string | number>, date?: string, limit = 30) {
    if (!boxIds || boxIds.length === 0) {
      return [];
    }

    const safeLimit = Math.max(1, Math.min(120, Number(limit) || 30));
    const rows = date
      ? await storage().query(sql`
        SELECT id,
          box_id as boxId,
          heatmap_date as heatmapDate,
          image_url as imageUrl,
          width,
          height,
          trajectory_count as trajectoryCount,
          point_count as pointCount,
          last_sample_at as lastSampleAt,
          updated_at as updatedAt
        FROM entrance_heatmaps
        WHERE user_id=${userId} AND box_id IN (${boxIds}) AND heatmap_date=${date}
        ORDER BY heatmap_date DESC, updated_at DESC
        LIMIT ${safeLimit}
      `)
      : await storage().query(sql`
        SELECT id,
          box_id as boxId,
          heatmap_date as heatmapDate,
          image_url as imageUrl,
          width,
          height,
          trajectory_count as trajectoryCount,
          point_count as pointCount,
          last_sample_at as lastSampleAt,
          updated_at as updatedAt
        FROM entrance_heatmaps
        WHERE user_id=${userId} AND box_id IN (${boxIds})
        ORDER BY heatmap_date DESC, updated_at DESC
        LIMIT ${safeLimit}
      `);

    return rows.map(mapRow);
  },
};
