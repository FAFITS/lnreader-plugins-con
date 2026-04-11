
const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const decodeBase64ToBytes = (encoded: string): number[] => {
  const normalized = encoded
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/\s+/g, '');
  const padded =
    normalized.length % 4 === 0
      ? normalized
      : normalized + '='.repeat(4 - (normalized.length % 4));
  const bytes: number[] = [];

  for (let i = 0; i < padded.length; i += 4) {
    const c1 = BASE64_ALPHABET.indexOf(padded.charAt(i));
    const c2 = BASE64_ALPHABET.indexOf(padded.charAt(i + 1));
    const c3Char = padded.charAt(i + 2);
    const c4Char = padded.charAt(i + 3);
    const c3 = c3Char === '=' ? 0 : BASE64_ALPHABET.indexOf(c3Char);
    const c4 = c4Char === '=' ? 0 : BASE64_ALPHABET.indexOf(c4Char);

    if (
      c1 < 0 ||
      c2 < 0 ||
      (c3Char !== '=' && c3 < 0) ||
      (c4Char !== '=' && c4 < 0)
    ) {
      continue;
    }

    const bitStream = (c1 << 18) | (c2 << 12) | (c3 << 6) | c4;
    bytes.push((bitStream >> 16) & 255);
    if (c3Char !== '=') {
      bytes.push((bitStream >> 8) & 255);
    }
    if (c4Char !== '=') {
      bytes.push(bitStream & 255);
    }
  }

  return bytes;
};

const utf8BytesToString = (bytes: number[]): string => {
  let out = '';
  let i = 0;

  while (i < bytes.length) {
    const c = bytes[i++];

    if (c < 128) {
      out += String.fromCharCode(c);
    } else if (c < 224) {
      out += String.fromCharCode(((c & 31) << 6) | (bytes[i++] & 63));
    } else if (c < 240) {
      out += String.fromCharCode(
        ((c & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63),
      );
    } else {
      let codePoint =
        ((c & 7) << 18) |
        ((bytes[i++] & 63) << 12) |
        ((bytes[i++] & 63) << 6) |
        (bytes[i++] & 63);
      codePoint -= 65536;
      out += String.fromCharCode(
        55296 + (codePoint >> 10),
        56320 + (codePoint & 1023),
      );
    }
  }

  return out;
};

const decodeBase64Utf8 = (encoded: string) =>
  utf8BytesToString(decodeBase64ToBytes(encoded));

const decodeXorChunk = (encoded: string, key: string): string => {
  const input = decodeBase64ToBytes(encoded);
  if (!key) {
    return utf8BytesToString(input);
  }

  const output: number[] = [];
  for (let i = 0; i < input.length; i++) {
    output.push(input[i] ^ key.charCodeAt(i % key.length));
  }
  return utf8BytesToString(output);
};

const parseProtectedChunks = (raw: string): string[] => {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    // fallback to single-chunk payload
  }

  return [raw];
};

const decodeProtectedContent = (
  mode: string,
  key: string,
  chunks: string[],
): string => {
  if (!chunks.length) {
    return '';
  }

  const sortedChunks = [...chunks].sort((a, b) => {
    const ai = Number.parseInt(a.substring(0, 4), 10);
    const bi = Number.parseInt(b.substring(0, 4), 10);
    if (Number.isNaN(ai) || Number.isNaN(bi)) {
      return 0;
    }
    return ai - bi;
  });

  let content = '';

  for (const chunk of sortedChunks) {
    const payload = /^\d{4}/.test(chunk) ? chunk.substring(4) : chunk;

    if (mode === 'xor_shuffle') {
      content += decodeXorChunk(payload, key);
    } else if (mode === 'base64_reverse') {
      content += decodeBase64Utf8(payload.split('').reverse().join(''));
    } else {
      content += decodeBase64Utf8(payload);
    }
  }

  return content.replace(
    /\[note(\d+)]/gi,
    '<span id="anchor-note$1" class="note-icon none-print inline note-tooltip" data-tooltip-content="#note$1 .note-content" data-note-id="note$1"><i class="fas fa-sticky-note"></i></span><a id="anchor-note$1" class="inline-print none" href="#note$1">[note]</a>',
  );
};

const parseDmyToIso = (value: string): string | undefined => {
  const matched = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!matched) {
    return undefined;
  }

  const day = Number(matched[1]);
  const month = Number(matched[2]) - 1;
  const year = Number(matched[3]);
  const date = new Date(year, month, day);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
};

export { parseDmyToIso, parseProtectedChunks, decodeProtectedContent };