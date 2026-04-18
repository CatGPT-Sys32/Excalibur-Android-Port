export type ZipEntryInput = {
  name: string;
  data: string | Uint8Array;
};

export type ZipEntry = {
  name: string;
  data: Uint8Array;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
})();

const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
};

const toBytes = (value: string | Uint8Array) =>
  typeof value === "string" ? textEncoder.encode(value) : value;

const concatBytes = (chunks: readonly Uint8Array[]) => {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
};

const writeUint16 = (view: DataView, offset: number, value: number) => {
  view.setUint16(offset, value, true);
};

const writeUint32 = (view: DataView, offset: number, value: number) => {
  view.setUint32(offset, value >>> 0, true);
};

const dosDateTime = (date: Date) => {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();

  return { dosDate, dosTime };
};

const normalizeZipName = (name: string) =>
  name.replace(/\\/g, "/").replace(/^\/+/, "");

export const createStoreZip = (entries: readonly ZipEntryInput[]) => {
  const chunks: Uint8Array[] = [];
  const centralDirectoryChunks: Uint8Array[] = [];
  const now = dosDateTime(new Date());
  let localOffset = 0;

  for (const entry of entries) {
    const name = normalizeZipName(entry.name);
    const nameBytes = textEncoder.encode(name);
    const data = toBytes(entry.data);
    const crc = crc32(data);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0x0800);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, now.dosTime);
    writeUint16(localView, 12, now.dosDate);
    writeUint32(localView, 14, crc);
    writeUint32(localView, 18, data.length);
    writeUint32(localView, 22, data.length);
    writeUint16(localView, 26, nameBytes.length);
    writeUint16(localView, 28, 0);
    localHeader.set(nameBytes, 30);

    chunks.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0x0800);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, now.dosTime);
    writeUint16(centralView, 14, now.dosDate);
    writeUint32(centralView, 16, crc);
    writeUint32(centralView, 20, data.length);
    writeUint32(centralView, 24, data.length);
    writeUint16(centralView, 28, nameBytes.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, localOffset);
    centralHeader.set(nameBytes, 46);
    centralDirectoryChunks.push(centralHeader);

    localOffset += localHeader.length + data.length;
  }

  const centralDirectory = concatBytes(centralDirectoryChunks);
  const endOfCentralDirectory = new Uint8Array(22);
  const endView = new DataView(endOfCentralDirectory.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, entries.length);
  writeUint16(endView, 10, entries.length);
  writeUint32(endView, 12, centralDirectory.length);
  writeUint32(endView, 16, localOffset);
  writeUint16(endView, 20, 0);

  return new Blob([...chunks, centralDirectory, endOfCentralDirectory], {
    type: "application/zip",
  });
};

const findEndOfCentralDirectory = (view: DataView) => {
  const minOffset = Math.max(0, view.byteLength - 0xffff - 22);

  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      return offset;
    }
  }

  return -1;
};

export const parseStoreZip = async (file: Blob): Promise<ZipEntry[]> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndOfCentralDirectory(view);

  if (endOffset < 0) {
    throw new Error("Backup is not a valid zip file");
  }

  const entryCount = view.getUint16(endOffset + 10, true);
  let centralOffset = view.getUint32(endOffset + 16, true);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(centralOffset, true) !== 0x02014b50) {
      throw new Error("Backup zip central directory is invalid");
    }

    const method = view.getUint16(centralOffset + 10, true);
    if (method !== 0) {
      throw new Error("Backup zip uses unsupported compression");
    }

    const compressedSize = view.getUint32(centralOffset + 20, true);
    const uncompressedSize = view.getUint32(centralOffset + 24, true);
    const nameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localHeaderOffset = view.getUint32(centralOffset + 42, true);
    const nameBytes = bytes.subarray(
      centralOffset + 46,
      centralOffset + 46 + nameLength,
    );
    const name = textDecoder.decode(nameBytes);

    if (compressedSize !== uncompressedSize) {
      throw new Error("Backup zip entry sizes are inconsistent");
    }

    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
      throw new Error("Backup zip local header is invalid");
    }

    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.slice(dataOffset, dataOffset + uncompressedSize);

    if (!name.endsWith("/")) {
      entries.push({ name, data });
    }

    centralOffset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
};
