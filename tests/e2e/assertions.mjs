/**
 * Authoritative Assertions & Verification Oracles for WASM WebP / Metal Pipeline
 */

export function assert(condition, message = 'Assertion failed') {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    const detail = message ? `${message} - ` : '';
    throw new Error(`${detail}Expected: ${JSON.stringify(expected)}, Actual: ${JSON.stringify(actual)}`);
  }
}

export function assertClose(actual, expected, tolerance = 0.05, message = '') {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    const detail = message ? `${message} - ` : '';
    throw new Error(`${detail}Expected ${actual} to be within ${tolerance} of ${expected} (diff: ${diff})`);
  }
}

export async function assertRejects(asyncFn, message = 'Expected async operation to reject') {
  let threw = false;
  let error = null;
  try {
    await asyncFn();
  } catch (err) {
    threw = true;
    error = err;
  }
  if (!threw) {
    throw new Error(message);
  }
  return error;
}

/**
 * Validates WebP Container Structure against Google RIFF/WebP Specification
 * @param {Uint8Array|number[]} bytes
 * @param {'VP8L'|'VP8'|'VP8X'|'ANY'} expectedFormat
 */
export function assertWebPHeader(bytes, expectedFormat = 'ANY') {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  assert(u8.length >= 16, `WebP buffer too short: ${u8.length} bytes (minimum 16 bytes required)`);

  // RIFF header (bytes 0-3)
  const riff = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
  assertEqual(riff, 'RIFF', `Invalid container header (got ${riff}, expected RIFF)`);

  // File size (bytes 4-7, little endian)
  const fileSize = u8[4] | (u8[5] << 8) | (u8[6] << 16) | (u8[7] << 24);
  assert(fileSize > 0, `Invalid file size in header: ${fileSize}`);

  // WEBP signature (bytes 8-11)
  const webp = String.fromCharCode(u8[8], u8[9], u8[10], u8[11]);
  assertEqual(webp, 'WEBP', `Invalid WebP signature (got ${webp}, expected WEBP)`);

  // Chunk tag (bytes 12-15)
  const tag = String.fromCharCode(u8[12], u8[13], u8[14], u8[15]);
  if (expectedFormat === 'VP8L') {
    assertEqual(tag, 'VP8L', `Expected Lossless VP8L tag, got ${tag}`);
    // Lossless signature byte is 0x2F
    if (u8.length >= 21) {
      assertEqual(u8[20], 0x2F, `Expected VP8L stream signature 0x2F, got 0x${u8[20].toString(16)}`);
    }
  } else if (expectedFormat === 'VP8') {
    assert(tag === 'VP8 ' || tag === 'VP8X', `Expected Lossy VP8 or VP8X tag, got ${tag}`);
  } else if (expectedFormat === 'VP8X') {
    assertEqual(tag, 'VP8X', `Expected Extended VP8X tag, got ${tag}`);
  } else {
    assert(tag === 'VP8 ' || tag === 'VP8L' || tag === 'VP8X', `Unrecognized WebP tag: ${tag}`);
  }

  return { riff, fileSize, webp, tag };
}

/**
 * Validates WebM EBML Container against RFC 8794 Specification
 * @param {Uint8Array|number[]} bytes
 */
export function assertEBMLHeader(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  assert(u8.length >= 31, `WebM buffer too short: ${u8.length} bytes`);

  // EBML Header Element ID: [0x1A, 0x45, 0xDF, 0xA3]
  assertEqual(u8[0], 0x1A, 'Invalid EBML ID byte 0');
  assertEqual(u8[1], 0x45, 'Invalid EBML ID byte 1');
  assertEqual(u8[2], 0xDF, 'Invalid EBML ID byte 2');
  assertEqual(u8[3], 0xA3, 'Invalid EBML ID byte 3');

  // Verify DocType contains "webm"
  const hexStr = Array.from(u8.slice(0, 64)).map(b => b.toString(16).padStart(2, '0')).join('');
  const ascii = Array.from(u8.slice(0, 64)).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
  assert(ascii.includes('webm'), `EBML header missing "webm" DocType (found: ${ascii})`);

  return true;
}

/**
 * Validates Alpha Channel Bit-Exactness or Tolerance
 */
export function assertAlphaFidelity(originalRgba, decodedRgba, maxAllowedDiff = 0) {
  assert(originalRgba.length === decodedRgba.length, 'RGBA buffer length mismatch');
  const pixelCount = originalRgba.length / 4;

  let maxDiffFound = 0;
  for (let i = 0; i < pixelCount; i++) {
    const origAlpha = originalRgba[i * 4 + 3];
    const decAlpha = decodedRgba[i * 4 + 3];
    const diff = Math.abs(origAlpha - decAlpha);
    if (diff > maxDiffFound) {
      maxDiffFound = diff;
    }
  }

  assert(maxDiffFound <= maxAllowedDiff,
    `Alpha fidelity failure: max alpha difference ${maxDiffFound} exceeds allowed tolerance ${maxAllowedDiff}`);
}
