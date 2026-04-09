import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeWsFrames,
  encodeWsFrame,
  encodeWsPongFrame,
  encodeWsTextFrame
} from "../server/runtime/ws-protocol.mjs";

const buildMaskedClientFrame = (opcode, text, maskBytes = Buffer.from([0x11, 0x22, 0x33, 0x44])) => {
  const payload = Buffer.from(String(text), "utf8");
  if (payload.length >= 126) throw new Error("Test helper expects small payload");

  const header = Buffer.from([0x80 | (opcode & 0x0f), 0x80 | payload.length]);
  const maskedPayload = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) {
    maskedPayload[i] = payload[i] ^ maskBytes[i % 4];
  }
  return Buffer.concat([header, maskBytes, maskedPayload]);
};

test("encodeWsTextFrame + decodeWsFrames round-trip for unmasked server frame", () => {
  const frame = encodeWsTextFrame("hello");
  const decoded = decodeWsFrames(frame, { requireMasked: false });

  assert.equal(decoded.protocolError, undefined);
  assert.equal(decoded.frames.length, 1);
  assert.equal(decoded.frames[0].opcode, 0x1);
  assert.equal(decoded.frames[0].payload.toString("utf8"), "hello");
  assert.equal(decoded.remaining.length, 0);
});

test("decodeWsFrames rejects unmasked client frame when masking is required", () => {
  const frame = encodeWsFrame(0x1, "hello");
  const decoded = decodeWsFrames(frame, { requireMasked: true });

  assert.equal(decoded.protocolError, "unmasked_client_frame");
});

test("decodeWsFrames parses masked client frame payload", () => {
  const frame = buildMaskedClientFrame(0x1, "masked-message");
  const decoded = decodeWsFrames(frame, { requireMasked: true });

  assert.equal(decoded.protocolError, undefined);
  assert.equal(decoded.frames.length, 1);
  assert.equal(decoded.frames[0].masked, true);
  assert.equal(decoded.frames[0].payload.toString("utf8"), "masked-message");
});

test("decodeWsFrames returns incomplete frame data as remaining buffer", () => {
  const frame = buildMaskedClientFrame(0x1, "short");
  const partial = frame.subarray(0, frame.length - 2);
  const decoded = decodeWsFrames(partial, { requireMasked: true });

  assert.equal(decoded.protocolError, undefined);
  assert.equal(decoded.frames.length, 0);
  assert.equal(decoded.remaining.length, partial.length);
});

test("decodeWsFrames rejects fragmented frames", () => {
  const fragmented = Buffer.from([0x01, 0x80, 0x00, 0x00, 0x00, 0x00]);
  const decoded = decodeWsFrames(fragmented, { requireMasked: true });
  assert.equal(decoded.protocolError, "fragmented_frames_unsupported");
});

test("encodeWsPongFrame emits pong opcode", () => {
  const payload = Buffer.from("abc", "utf8");
  const frame = encodeWsPongFrame(payload);
  const decoded = decodeWsFrames(frame, { requireMasked: false });
  assert.equal(decoded.frames.length, 1);
  assert.equal(decoded.frames[0].opcode, 0x0a);
  assert.equal(decoded.frames[0].payload.toString("utf8"), "abc");
});
