const asBuffer = (payload) => {
  if (Buffer.isBuffer(payload)) return payload;
  if (typeof payload === "string") return Buffer.from(payload, "utf8");
  if (payload == null) return Buffer.alloc(0);
  return Buffer.from(String(payload), "utf8");
};

export const encodeWsFrame = (opcode, payload = Buffer.alloc(0)) => {
  const normalizedPayload = asBuffer(payload);
  let header = null;

  if (normalizedPayload.length < 126) {
    header = Buffer.from([0x80 | (opcode & 0x0f), normalizedPayload.length]);
  } else if (normalizedPayload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 126;
    header.writeUInt16BE(normalizedPayload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(normalizedPayload.length, 6);
  }

  return Buffer.concat([header, normalizedPayload]);
};

export const encodeWsTextFrame = (data) => encodeWsFrame(0x1, asBuffer(data));
export const encodeWsPongFrame = (payload = Buffer.alloc(0)) => encodeWsFrame(0xa, asBuffer(payload));

export const decodeWsFrames = (buffer, options = {}) => {
  const requireMasked = options.requireMasked !== false;
  const maxPayloadBytes = Number.isFinite(Number(options.maxPayloadBytes))
    ? Math.max(1, Number(options.maxPayloadBytes))
    : 1_000_000;

  let remaining = Buffer.isBuffer(buffer) ? buffer : Buffer.alloc(0);
  const frames = [];

  while (remaining.length >= 2) {
    const first = remaining[0];
    const second = remaining[1];
    const fin = (first & 0x80) === 0x80;
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let length = second & 0x7f;
    let offset = 2;

    if (!fin) {
      return { frames, remaining, protocolError: "fragmented_frames_unsupported" };
    }

    if (length === 126) {
      if (remaining.length < offset + 2) return { frames, remaining };
      length = remaining.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (remaining.length < offset + 8) return { frames, remaining };
      const high = remaining.readUInt32BE(offset);
      const low = remaining.readUInt32BE(offset + 4);
      if (high !== 0) {
        return { frames, remaining, protocolError: "payload_too_large" };
      }
      length = low;
      offset += 8;
    }

    if (length > maxPayloadBytes) {
      return { frames, remaining, protocolError: "payload_too_large" };
    }

    if (requireMasked && !masked) {
      return { frames, remaining, protocolError: "unmasked_client_frame" };
    }

    const maskLength = masked ? 4 : 0;
    if (remaining.length < offset + maskLength + length) return { frames, remaining };

    let mask = null;
    if (masked) {
      mask = remaining.subarray(offset, offset + 4);
      offset += 4;
    }

    const payload = Buffer.from(remaining.subarray(offset, offset + length));
    if (mask) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }

    remaining = remaining.subarray(offset + length);
    frames.push({ opcode, payload, masked });
  }

  return { frames, remaining };
};
