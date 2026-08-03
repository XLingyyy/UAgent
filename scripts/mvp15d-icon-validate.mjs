#!/usr/bin/env node
/* global console, process */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

const REQUIRED_SIZES = [16, 24, 32, 48, 64, 128, 256];

class IconValidationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new IconValidationError(code);
}

function dimension(byte) {
  return byte === 0 ? 256 : byte;
}

function parseDib(bytes, offset, length, expectedWidth, expectedHeight) {
  if (length < 40 || bytes.readUInt32LE(offset) !== 40) fail("ICON_DIB_INVALID");
  const width = bytes.readInt32LE(offset + 4);
  const doubledHeight = bytes.readInt32LE(offset + 8);
  const planes = bytes.readUInt16LE(offset + 12);
  const bitsPerPixel = bytes.readUInt16LE(offset + 14);
  const compression = bytes.readUInt32LE(offset + 16);
  if (
    width !== expectedWidth ||
    doubledHeight !== expectedHeight * 2 ||
    planes !== 1 ||
    bitsPerPixel !== 32 ||
    compression !== 0
  ) {
    fail("ICON_DIB_INVALID");
  }
  const pixelOffset = offset + 40;
  const pixelBytes = expectedWidth * expectedHeight * 4;
  if (pixelOffset + pixelBytes > offset + length) fail("ICON_DIB_TRUNCATED");
  let opaqueCount = 0;
  const colors = new Set();
  for (let cursor = pixelOffset; cursor < pixelOffset + pixelBytes; cursor += 4) {
    const blue = bytes[cursor];
    const green = bytes[cursor + 1];
    const red = bytes[cursor + 2];
    const alpha = bytes[cursor + 3];
    if (alpha > 0) {
      opaqueCount += 1;
      colors.add(`${red},${green},${blue},${alpha}`);
    }
  }
  if (
    opaqueCount < Math.max(4, Math.floor(expectedWidth * expectedHeight * 0.5)) ||
    colors.size < 8
  ) {
    fail("ICON_BLANK_OR_TRANSPARENT");
  }
}

export function validateIcon(path) {
  const bytes = readFileSync(resolve(path));
  if (
    bytes.length < 22 ||
    bytes.readUInt16LE(0) !== 0 ||
    bytes.readUInt16LE(2) !== 1
  ) {
    fail("ICON_FORMAT_INVALID");
  }
  const count = bytes.readUInt16LE(4);
  if (count < REQUIRED_SIZES.length || 6 + count * 16 > bytes.length) {
    fail("ICON_DIRECTORY_INVALID");
  }
  const seen = new Set();
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16;
    const width = dimension(bytes[entry]);
    const height = dimension(bytes[entry + 1]);
    const planes = bytes.readUInt16LE(entry + 4);
    const bitsPerPixel = bytes.readUInt16LE(entry + 6);
    const length = bytes.readUInt32LE(entry + 8);
    const offset = bytes.readUInt32LE(entry + 12);
    if (
      width !== height ||
      planes !== 1 ||
      bitsPerPixel !== 32 ||
      length === 0 ||
      offset < 6 + count * 16 ||
      offset + length > bytes.length
    ) {
      fail("ICON_DIRECTORY_INVALID");
    }
    parseDib(bytes, offset, length, width, height);
    seen.add(width);
  }
  if (REQUIRED_SIZES.some((size) => !seen.has(size))) fail("ICON_SIZE_SET_INVALID");
  return {
    status: "icon_verified",
    format: "ico",
    sizes: [...seen].sort((left, right) => left - right),
    byteLength: bytes.length,
  };
}

function main() {
  const repository = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const result = validateIcon(resolve(repository, "apps", "desktop", "src-tauri", "icons", "icon.ico"));
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    const reason =
      error instanceof IconValidationError ? error.code : (error?.code ?? "ICON_VALIDATION_FAILED");
    console.error(JSON.stringify({ status: "icon_rejected", reason }));
    process.exitCode = 2;
  }
}

export { IconValidationError, REQUIRED_SIZES };
