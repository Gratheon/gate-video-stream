export type LiveFrame = {
  contentType: string;
  buffer: Buffer;
  updatedAt: number;
  sequence: number;
};

const liveFrames = new Map<string, LiveFrame>();

export function storeLiveFrame(sessionId: string, buffer: Buffer, contentType = "image/jpeg") {
  const previous = liveFrames.get(sessionId);
  const frame: LiveFrame = {
    contentType,
    buffer: Buffer.from(buffer),
    updatedAt: Date.now(),
    sequence: (previous?.sequence || 0) + 1,
  };

  liveFrames.set(sessionId, frame);
  return frame;
}

export function getLiveFrame(sessionId: string) {
  return liveFrames.get(sessionId) || null;
}

export function clearLiveFrame(sessionId: string) {
  liveFrames.delete(sessionId);
}

export function buildMultipartFrameChunk(frame: LiveFrame) {
  return Buffer.concat([
    Buffer.from(`--frame\r\nContent-Type: ${frame.contentType}\r\nContent-Length: ${frame.buffer.length}\r\nX-Frame-Sequence: ${frame.sequence}\r\nX-Frame-Timestamp: ${new Date(frame.updatedAt).toISOString()}\r\n\r\n`),
    frame.buffer,
    Buffer.from("\r\n"),
  ]);
}
