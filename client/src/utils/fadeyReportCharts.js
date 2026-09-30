/**
 * Gráficos SVG autocontenidos para informes IA Fadey (PDF imprimible e imágenes para Excel).
 */
export const REPORT_PALETTE = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#64748b'];

export function formatReportValue(v, format) {
  const n = Number(v || 0);
  if (format === 'money') return `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (format === 'pct') return `${n.toFixed(1)}%`;
  if (format === 'int') return Math.round(n).toLocaleString('es-PE');
  if (format === 'number') return n.toLocaleString('es-PE', { maximumFractionDigits: 2 });
  return String(v ?? '');
}

function shortValue(v, format) {
  const n = Number(v || 0);
  const abs = Math.abs(n);
  const prefix = format === 'money' ? 'S/ ' : '';
  if (format === 'pct') return `${n.toFixed(0)}%`;
  if (abs >= 1_000_000) return `${prefix}${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${prefix}${(n / 1_000).toFixed(1)}k`;
  return `${prefix}${format === 'money' ? n.toFixed(0) : Math.round(n)}`;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function clip(s, max) {
  const t = String(s ?? '');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function niceMax(v) {
  if (!(v > 0)) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * exp;
}

function wrapSvg(width, height, title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Segoe UI, Arial, sans-serif">
<rect width="${width}" height="${height}" fill="#ffffff"/>
<text x="16" y="26" font-size="15" font-weight="700" fill="#0f172a">${esc(title)}</text>
${body}
</svg>`;
}

function verticalBars(chart, width, height) {
  const data = chart.data || [];
  const hasSecond = data.some((d) => d.value2 != null);
  const left = 64;
  const right = 16;
  const top = hasSecond ? 58 : 44;
  const bottom = 64;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const max = niceMax(Math.max(...data.map((d) => Math.max(Number(d.value || 0), Number(d.value2 || 0))), 0));
  const parts = [];
  for (let i = 0; i <= 4; i += 1) {
    const y = top + plotH - (plotH * i) / 4;
    parts.push(`<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="#e2e8f0"/>`);
    parts.push(`<text x="${left - 6}" y="${y + 4}" font-size="10" text-anchor="end" fill="#64748b">${esc(shortValue((max * i) / 4, chart.format))}</text>`);
  }
  const slot = plotW / Math.max(data.length, 1);
  const groupW = Math.min(slot * 0.7, 56);
  const barW = hasSecond ? groupW / 2 : groupW;
  const labelEvery = Math.ceil(data.length / 16);
  data.forEach((d, i) => {
    const x0 = left + slot * i + (slot - groupW) / 2;
    const h1 = (plotH * Number(d.value || 0)) / max;
    parts.push(`<rect x="${x0}" y="${top + plotH - h1}" width="${barW}" height="${Math.max(h1, 0)}" rx="3" fill="${REPORT_PALETTE[0]}"/>`);
    if (hasSecond) {
      const h2 = (plotH * Number(d.value2 || 0)) / max;
      parts.push(`<rect x="${x0 + barW}" y="${top + plotH - h2}" width="${barW}" height="${Math.max(h2, 0)}" rx="3" fill="${REPORT_PALETTE[3]}"/>`);
    }
    if (data.length <= 14) {
      parts.push(`<text x="${x0 + groupW / 2}" y="${top + plotH - h1 - 5}" font-size="9" text-anchor="middle" fill="#334155">${esc(shortValue(d.value, chart.format))}</text>`);
    }
    if (i % labelEvery === 0) {
      const lx = left + slot * i + slot / 2;
      const ly = top + plotH + 14;
      parts.push(`<text x="${lx}" y="${ly}" font-size="10" fill="#475569" text-anchor="end" transform="rotate(-35 ${lx} ${ly})">${esc(clip(d.name, 16))}</text>`);
    }
  });
  if (hasSecond) {
    const labels = chart.series || [{ label: 'Valor' }, { label: 'Referencia' }];
    parts.push(`<rect x="${left}" y="36" width="10" height="10" fill="${REPORT_PALETTE[0]}"/><text x="${left + 14}" y="45" font-size="11" fill="#334155">${esc(labels[0]?.label)}</text>`);
    parts.push(`<rect x="${left + 110}" y="36" width="10" height="10" fill="${REPORT_PALETTE[3]}"/><text x="${left + 124}" y="45" font-size="11" fill="#334155">${esc(labels[1]?.label)}</text>`);
  }
  return parts.join('\n');
}

function horizontalBars(chart, width, height) {
  const data = chart.data || [];
  const left = 170;
  const right = 80;
  const top = 44;
  const bottom = 12;
  const plotW = width - left - right;
  const rowH = (height - top - bottom) / Math.max(data.length, 1);
  const max = Math.max(...data.map((d) => Number(d.value || 0)), 0) || 1;
  const parts = [];
  data.forEach((d, i) => {
    const y = top + rowH * i;
    const w = (plotW * Number(d.value || 0)) / max;
    const barH = Math.min(rowH * 0.65, 26);
    parts.push(`<text x="${left - 8}" y="${y + rowH / 2 + 4}" font-size="11" text-anchor="end" fill="#334155">${esc(clip(d.name, 24))}</text>`);
    parts.push(`<rect x="${left}" y="${y + (rowH - barH) / 2}" width="${Math.max(w, 1)}" height="${barH}" rx="3" fill="${REPORT_PALETTE[i % REPORT_PALETTE.length]}"/>`);
    parts.push(`<text x="${left + w + 6}" y="${y + rowH / 2 + 4}" font-size="11" fill="#0f172a">${esc(formatReportValue(d.value, chart.format))}</text>`);
  });
  return parts.join('\n');
}

function lineChart(chart, width, height) {
  const data = chart.data || [];
  const left = 64;
  const right = 16;
  const top = 44;
  const bottom = 56;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const max = niceMax(Math.max(...data.map((d) => Number(d.value || 0)), 0));
  const parts = [];
  for (let i = 0; i <= 4; i += 1) {
    const y = top + plotH - (plotH * i) / 4;
    parts.push(`<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="#e2e8f0"/>`);
    parts.push(`<text x="${left - 6}" y="${y + 4}" font-size="10" text-anchor="end" fill="#64748b">${esc(shortValue((max * i) / 4, chart.format))}</text>`);
  }
  const step = data.length > 1 ? plotW / (data.length - 1) : 0;
  const pts = data.map((d, i) => [left + step * i, top + plotH - (plotH * Number(d.value || 0)) / max]);
  if (pts.length) {
    const area = `M${pts[0][0]},${top + plotH} ${pts.map((p) => `L${p[0]},${p[1]}`).join(' ')} L${pts[pts.length - 1][0]},${top + plotH} Z`;
    parts.push(`<path d="${area}" fill="${REPORT_PALETTE[0]}" fill-opacity="0.12"/>`);
    parts.push(`<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${REPORT_PALETTE[0]}" stroke-width="2.5"/>`);
    if (pts.length <= 40) pts.forEach((p) => parts.push(`<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="${REPORT_PALETTE[0]}"/>`));
  }
  const labelEvery = Math.ceil(data.length / 14);
  data.forEach((d, i) => {
    if (i % labelEvery !== 0) return;
    const lx = left + step * i;
    const ly = top + plotH + 14;
    parts.push(`<text x="${lx}" y="${ly}" font-size="10" fill="#475569" text-anchor="end" transform="rotate(-35 ${lx} ${ly})">${esc(clip(d.name, 12))}</text>`);
  });
  return parts.join('\n');
}

function pieChart(chart, width, height) {
  const data = (chart.data || []).filter((d) => Number(d.value) > 0);
  const total = data.reduce((s, d) => s + Number(d.value || 0), 0) || 1;
  const r = Math.min(height - 70, width * 0.4) / 2;
  const cx = 24 + r;
  const cy = 44 + r + 4;
  const parts = [];
  let angle = -Math.PI / 2;
  data.forEach((d, i) => {
    const frac = Number(d.value || 0) / total;
    const end = angle + frac * Math.PI * 2;
    const color = REPORT_PALETTE[i % REPORT_PALETTE.length];
    if (frac >= 0.9999) {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`);
    } else {
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(end);
      const y2 = cy + r * Math.sin(end);
      parts.push(`<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${x2},${y2} Z" fill="${color}" stroke="#fff" stroke-width="1.5"/>`);
    }
    angle = end;
  });
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${r * 0.5}" fill="#fff"/>`);
  const lx = cx + r + 28;
  data.slice(0, 10).forEach((d, i) => {
    const y = 56 + i * 22;
    const share = ((Number(d.value || 0) / total) * 100).toFixed(1);
    parts.push(`<rect x="${lx}" y="${y - 10}" width="12" height="12" rx="2" fill="${REPORT_PALETTE[i % REPORT_PALETTE.length]}"/>`);
    parts.push(`<text x="${lx + 18}" y="${y}" font-size="11" fill="#334155">${esc(clip(d.name, 22))} — ${esc(formatReportValue(d.value, chart.format))} (${share}%)</text>`);
  });
  return parts.join('\n');
}

export function chartSize(chart) {
  if (chart.type === 'hbar') return { width: 760, height: Math.max(180, 56 + (chart.data?.length || 1) * 30) };
  if (chart.type === 'pie') return { width: 760, height: Math.max(260, 70 + Math.min(chart.data?.length || 1, 10) * 22) };
  return { width: 760, height: 320 };
}

export function chartToSvg(chart) {
  const { width, height } = chartSize(chart);
  let body = '';
  if (chart.type === 'hbar') body = horizontalBars(chart, width, height);
  else if (chart.type === 'line') body = lineChart(chart, width, height);
  else if (chart.type === 'pie') body = pieChart(chart, width, height);
  else body = verticalBars(chart, width, height);
  return wrapSvg(width, height, chart.title, body);
}

/** SVG → PNG base64 (sin prefijo data:) para incrustar en Excel. */
export function svgToPngBase64(svg, scale = 2) {
  return new Promise((resolve, reject) => {
    const sizeMatch = svg.match(/width="(\d+)" height="(\d+)"/);
    const width = Number(sizeMatch?.[1] || 760);
    const height = Number(sizeMatch?.[2] || 320);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      resolve({ base64: canvas.toDataURL('image/png').split(',')[1], width, height });
    };
    img.onerror = reject;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}
