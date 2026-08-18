/**
 * Valida que un backup SQLite se haya leído completo (no truncado).
 * Cabecera: https://www.sqlite.org/fileformat.html
 */

function asBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  return Buffer.from(input || []);
}

function parseSqliteHeader(input) {
  const buf = asBuffer(input);
  if (buf.length < 100) {
    throw new Error('El archivo está incompleto (cabecera SQLite menor a 100 bytes)');
  }
  const magic = buf.subarray(0, 16).toString('utf8').replace(/\0+$/g, '');
  if (!magic.startsWith('SQLite format 3')) {
    throw new Error('El archivo no es una base SQLite (debe empezar con «SQLite format 3»)');
  }
  let pageSize = buf.readUInt16BE(16);
  if (pageSize === 1) pageSize = 65536;
  if (pageSize < 512 || (pageSize & (pageSize - 1)) !== 0) {
    throw new Error('Cabecera SQLite inválida (tamaño de página)');
  }
  const pageCount = buf.readUInt32BE(28);
  return { pageSize, pageCount, bytes: buf.length };
}

function assertCompleteSqliteBuffer(input, { expectedBytes } = {}) {
  const buf = asBuffer(input);
  if (buf.length < 512) {
    throw new Error('El archivo es demasiado pequeño para ser un backup SQLite completo');
  }
  const header = parseSqliteHeader(buf);
  const expected = Number(expectedBytes);
  if (Number.isFinite(expected) && expected > 0 && buf.length !== expected) {
    throw new Error(
      `El backup no se recibió completo (${buf.length} de ${expected} bytes). Vuelva a subir el archivo .db entero.`,
    );
  }
  if (header.pageCount > 0) {
    const declared = header.pageSize * header.pageCount;
    if (buf.length < declared) {
      throw new Error(
        `El backup está truncado (${buf.length} bytes; SQLite declara ${declared}). No use este archivo.`,
      );
    }
  }
  return header;
}

module.exports = {
  parseSqliteHeader,
  assertCompleteSqliteBuffer,
};
