import { sql } from "@databases/mysql";
import { Readable } from "stream";
import { deflateSync } from "zlib";

import config from "../config/index";
import { storage } from "./storage";
import upload from "./s3";
import { logger } from "../logger";

const MAX_DIMENSION = 4096;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

type SparseHeatGrid = {
  version: 2;
  mode: 'sparse-pixels';
  width: number;
  height: number;
  points: Record<string, number>;
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
  heatGrid?: SparseHeatGrid | number[][] | string | null;
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

function createSparseGrid(width: number, height: number): SparseHeatGrid {
  return {
    version: 2,
    mode: 'sparse-pixels',
    width,
    height,
    points: {},
  };
}

function scalePointIndex(index: number, fromWidth: number, fromHeight: number, toWidth: number, toHeight: number) {
  const x = index % fromWidth;
  const y = Math.floor(index / fromWidth);
  const scaledX = Math.max(0, Math.min(toWidth - 1, Math.floor((x / fromWidth) * toWidth)));
  const scaledY = Math.max(0, Math.min(toHeight - 1, Math.floor((y / fromHeight) * toHeight)));
  return scaledY * toWidth + scaledX;
}

function parseSparseGrid(raw: unknown, width: number, height: number): SparseHeatGrid {
  if (!raw) {
    return createSparseGrid(width, height);
  }

  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

    if (parsed?.mode === 'sparse-pixels' && parsed?.points && typeof parsed.points === 'object') {
      const sourceWidth = clampDimension(parsed.width, width);
      const sourceHeight = clampDimension(parsed.height, height);
      const grid = createSparseGrid(width, height);

      for (const [rawIndex, rawValue] of Object.entries(parsed.points)) {
        const count = Number(rawValue) || 0;
        const index = Number(rawIndex);
        if (!Number.isFinite(index) || count <= 0) {
          continue;
        }

        const targetIndex = sourceWidth === width && sourceHeight === height
          ? index
          : scalePointIndex(index, sourceWidth, sourceHeight, width, height);
        grid.points[String(targetIndex)] = (grid.points[String(targetIndex)] || 0) + count;
      }

      return grid;
    }

    if (Array.isArray(parsed)) {
      // WHY: first implementation stored a low-resolution array. Preserve existing
      // rows by projecting each old cell to the center of the new high-resolution image.
      const sourceHeight = parsed.length;
      const sourceWidth = Array.isArray(parsed[0]) ? parsed[0].length : 0;
      const grid = createSparseGrid(width, height);
      if (!sourceWidth || !sourceHeight) {
        return grid;
      }

      for (let y = 0; y < sourceHeight; y += 1) {
        const row = parsed[y];
        if (!Array.isArray(row)) {
          continue;
        }
        for (let x = 0; x < sourceWidth; x += 1) {
          const count = Number(row[x]) || 0;
          if (count <= 0) {
            continue;
          }
          const targetX = Math.max(0, Math.min(width - 1, Math.floor(((x + 0.5) / sourceWidth) * width)));
          const targetY = Math.max(0, Math.min(height - 1, Math.floor(((y + 0.5) / sourceHeight) * height)));
          const targetIndex = targetY * width + targetX;
          grid.points[String(targetIndex)] = (grid.points[String(targetIndex)] || 0) + count;
        }
      }
      return grid;
    }
  } catch (error) {
    logger.error('Could not parse existing heatmap grid', error);
  }

  return createSparseGrid(width, height);
}

function addTracksToSparseGrid(grid: SparseHeatGrid, payload: HeatmapUpload) {
  const sourceWidth = clampDimension(payload.frameDimensions?.width, grid.width);
  const sourceHeight = clampDimension(payload.frameDimensions?.height, grid.height);
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

      const sourceX = Number(point[0]);
      const sourceY = Number(point[1]);
      if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY) || sourceX < 0 || sourceY < 0 || sourceX >= sourceWidth || sourceY >= sourceHeight) {
        continue;
      }

      const x = Math.max(0, Math.min(grid.width - 1, Math.round((sourceX / sourceWidth) * grid.width)));
      const y = Math.max(0, Math.min(grid.height - 1, Math.round((sourceY / sourceHeight) * grid.height)));
      const index = y * grid.width + x;
      grid.points[String(index)] = (grid.points[String(index)] || 0) + 1;
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
    [255, 70, 0],
    [255, 180, 0],
    [255, 255, 180],
  ];
  const scaled = clamped * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const local = scaled - index;
  const from = stops[index];
  const to = stops[index + 1];
  return from.map((channel, i) => Math.round(channel + (to[i] - channel) * local));
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function renderHeatmapPng(grid: SparseHeatGrid) {
  const maxCount = Object.values(grid.points).reduce((max, value) => Math.max(max, Number(value) || 0), 0);
  const rowBytes = 1 + grid.width * 4;
  const raw = Buffer.alloc(rowBytes * grid.height);

  for (let y = 0; y < grid.height; y += 1) {
    const rowStart = y * rowBytes;
    raw[rowStart] = 0; // PNG filter type 0
    for (let x = 0; x < grid.width; x += 1) {
      raw[rowStart + 1 + x * 4 + 3] = 255;
    }
  }

  if (maxCount > 0) {
    for (const [rawIndex, rawValue] of Object.entries(grid.points)) {
      const count = Number(rawValue) || 0;
      const index = Number(rawIndex);
      if (!Number.isFinite(index) || count <= 0 || index < 0 || index >= grid.width * grid.height) {
        continue;
      }

      // WHY: logarithmic scaling preserves faint edge/corner dwell patterns while
      // keeping very dense traffic lanes readable in the same high-resolution PNG.
      const intensity = Math.log1p(count) / Math.log1p(maxCount);
      const [r, g, b] = colorForIntensity(intensity);
      const x = index % grid.width;
      const y = Math.floor(index / grid.width);
      const offset = y * rowBytes + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(grid.width, 0);
  ihdr.writeUInt32BE(grid.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function getUploadRelPath(userId: string | number, boxId: string | number, heatmapDate: string) {
  return `${userId}/gate_heatmaps/${boxId}/${heatmapDate}.png`;
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
    const width = clampDimension(existing?.width || payload.frameDimensions?.width, 1280);
    const height = clampDimension(existing?.height || payload.frameDimensions?.height, 720);
    const grid = parseSparseGrid(existing?.heatGrid, width, height);
    const added = addTracksToSparseGrid(grid, payload);

    if (added.pointCount === 0) {
      logger.info('Heatmap trajectory upload had no valid points', { userId, boxId: payload.boxId, heatmapDate });
    }

    const png = renderHeatmapPng(grid);
    const s3Key = getUploadRelPath(userId, payload.boxId, heatmapDate);
    await upload(Readable.from([png]), s3Key);
    const imageUrl = getImageUrl(userId, payload.boxId, heatmapDate);
    const serializedGrid = JSON.stringify(grid);

    if (existing) {
      await storage().query(sql`
        UPDATE entrance_heatmaps
        SET image_url=${imageUrl},
          s3_key=${s3Key},
          width=${width},
          height=${height},
          grid_width=${width},
          grid_height=${height},
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
          ${width},
          ${height},
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
