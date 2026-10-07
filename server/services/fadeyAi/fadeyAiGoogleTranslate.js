/**
 * Español → inglés con el traductor público de Google (sin clave).
 * Si no hay internet, devuelve null y el chat usa el diccionario local.
 */
const CACHE = new Map();
const CACHE_MAX = 400;

function remember(key, value) {
  if (CACHE.has(key)) CACHE.delete(key);
  CACHE.set(key, value);
  while (CACHE.size > CACHE_MAX) {
    const oldest = CACHE.keys().next().value;
    CACHE.delete(oldest);
  }
}

function splitChunks(text, max) {
  const raw = String(text || '');
  if (raw.length <= max) return [raw];
  const blocks = raw.split(/(\n{2,})/);
  const out = [];
  let buf = '';
  const push = () => {
    if (buf) out.push(buf);
    buf = '';
  };
  for (const block of blocks) {
    if ((buf + block).length <= max) {
      buf += block;
      continue;
    }
    push();
    if (block.length <= max) {
      buf = block;
      continue;
    }
    let rest = block;
    while (rest.length > max) {
      let cut = rest.lastIndexOf('\n', max);
      if (cut < max * 0.4) cut = rest.lastIndexOf(' ', max);
      if (cut < max * 0.4) cut = max;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    buf = rest;
  }
  push();
  return out.filter((p) => p.length);
}

async function translateChunk(text) {
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', 'es');
  url.searchParams.set('tl', 'en');
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', text);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data?.[0])) return null;
    const out = data[0].map((row) => (Array.isArray(row) ? row[0] : '')).join('');
    return out ? out : null;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Traduce un texto. null = Google no respondió. */
async function translateEsToEn(text) {
  const raw = String(text ?? '');
  if (!raw.trim()) return raw;
  if (CACHE.has(raw)) return CACHE.get(raw);
  const parts = splitChunks(raw, 1200);
  const done = [];
  for (const part of parts) {
    const hit = CACHE.get(part);
    const out = hit != null ? hit : await translateChunk(part);
    if (out == null) return null;
    remember(part, out);
    done.push(out);
  }
  const joined = done.join('');
  remember(raw, joined);
  return joined;
}

const BATCH_SEP = '\n⟦⟧\n';

/**
 * Traduce varias frases en pocas llamadas.
 * Devuelve un Map español → inglés, o null si Google no respondió.
 */
async function translateManyEsToEn(texts) {
  const list = [...new Set((texts || []).map((t) => String(t ?? '')).filter((t) => t.trim()))];
  const map = new Map();
  const pending = [];
  for (const text of list) {
    if (CACHE.has(text)) map.set(text, CACHE.get(text));
    else pending.push(text);
  }
  if (!pending.length) return map;

  const groups = [];
  let bucket = [];
  let len = 0;
  for (const text of pending) {
    const extra = text.length + BATCH_SEP.length;
    if (bucket.length && len + extra > 1200) {
      groups.push(bucket);
      bucket = [];
      len = 0;
    }
    bucket.push(text);
    len += extra;
  }
  if (bucket.length) groups.push(bucket);

  for (const group of groups) {
    if (group.length === 1) {
      const out = await translateEsToEn(group[0]);
      if (out == null) return null;
      map.set(group[0], out);
      continue;
    }
    const joined = group.join(BATCH_SEP);
    const translated = await translateChunk(joined);
    const parts = translated ? translated.split(/\n\s*⟦⟧\s*\n/) : [];
    if (!translated || parts.length !== group.length) {
      for (const text of group) {
        const out = await translateEsToEn(text);
        if (out == null) return null;
        map.set(text, out);
      }
      continue;
    }
    group.forEach((text, i) => {
      remember(text, parts[i]);
      map.set(text, parts[i]);
    });
  }
  return map;
}

module.exports = {
  translateEsToEn,
  translateManyEsToEn,
};
