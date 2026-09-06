/**
 * Expansión PCB abierta (sin tronco): trazas espaciadas con codos a 45°.
 * Aparece y desaparece segmento a segmento (como circuito), sin scale/desliz.
 * BR = misma red invertida.
 */

import { useEffect, useMemo, useState } from 'react';

const STROKE = '#C9A227';

function round(n) {
  return Math.round(n * 100) / 100;
}

function pickNodeKind(tipKind, waypointIndex, isTip) {
  if (isTip) return tipKind;
  // Vías / pads en codos: variar como en la referencia
  const cycle = (waypointIndex + (tipKind === 'hollow' ? 1 : 0)) % 5;
  if (cycle === 1) return 'hollow';
  if (cycle === 3) return 'large';
  return 'filled';
}

function routePcb(points, aspect, genBase, tipKind) {
  const segs = [];
  let gen = genBase;
  let [cx, cy] = points[0];
  const ratio = 1 / Math.max(aspect, 0.55);
  let waypoint = 0;

  // Nodo de origen (pad de entrada)
  segs.push({
    d: `M ${round(cx)} ${round(cy)} L ${round(cx)} ${round(cy)}`,
    nx: round(cx),
    ny: round(cy),
    showNode: true,
    nodeKind: tipKind === 'large' ? 'large' : 'filled',
    isPadOnly: true,
    gen,
  });
  gen += 1;

  for (let i = 1; i < points.length; i += 1) {
    const [tx, ty] = points[i];
    const dx = tx - cx;
    const dy = ty - cy;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const sx = Math.sign(dx) || 1;
    const sy = Math.sign(dy) || 1;
    const steps = [];

    if (adx < 0.08 || ady < 0.08) {
      steps.push([tx, ty]);
    } else if (Math.abs(ady - adx * ratio) < 0.35) {
      steps.push([tx, ty]);
    } else {
      const diag = Math.min(adx, ady / ratio) * 0.62;
      const mx = cx + sx * diag;
      const my = cy + sy * diag * ratio;
      steps.push([mx, my]);
      if (Math.abs(tx - mx) >= Math.abs(ty - my)) {
        steps.push([tx, my], [tx, ty]);
      } else {
        steps.push([mx, ty], [tx, ty]);
      }
    }

    steps.forEach(([nx, ny], si) => {
      const isTip = i === points.length - 1 && si === steps.length - 1;
      const isWaypointEnd = si === steps.length - 1;
      // Nodo en cada waypoint de la polilínea + en algunos codos 45°
      const atBend = si === 0 && steps.length > 1;
      const showNode = isTip || isWaypointEnd || atBend;
      waypoint += 1;
      segs.push({
        d: `M ${round(cx)} ${round(cy)} L ${round(nx)} ${round(ny)}`,
        nx: round(nx),
        ny: round(ny),
        showNode,
        nodeKind: showNode ? pickNodeKind(tipKind, waypoint, isTip) : 'none',
        gen,
      });
      cx = nx;
      cy = ny;
      gen += 1;
    });
  }
  return segs;
}

/** Pocas pistas bien separadas; expansión abierta hacia el logo. */
function buildCircuitFan(aspect) {
  const traces = [
    { kind: 'filled', pts: [[6, 0], [18, 8], [32, 14], [44, 26], [52, 38]] },
    { kind: 'large', pts: [[18, 0], [30, 6], [42, 14], [52, 26], [58, 36]] },
    { kind: 'hollow', pts: [[32, 0], [42, 6], [52, 16], [60, 28]] },
    { kind: 'filled', pts: [[0, 8], [10, 18], [22, 28], [34, 40], [44, 50]] },
    { kind: 'large', pts: [[0, 20], [10, 30], [20, 42], [32, 52], [40, 60]] },
    { kind: 'hollow', pts: [[0, 34], [8, 44], [18, 54], [28, 62]] },
    { kind: 'filled', pts: [[0, 2], [12, 12], [26, 20], [40, 32], [50, 44]] },
    { kind: 'filled', pts: [[10, 0], [22, 10], [36, 18], [48, 30], [56, 42]] },
    { kind: 'large', pts: [[0, 14], [12, 24], [24, 36], [36, 46], [46, 54]] },
    { kind: 'hollow', pts: [[24, 0], [36, 8], [48, 18], [56, 30]] },
  ];

  const stubs = [
    { kind: 'filled', pts: [[32, 14], [40, 8]] },
    { kind: 'hollow', pts: [[44, 26], [52, 20]] },
    { kind: 'large', pts: [[22, 28], [30, 22]] },
    { kind: 'filled', pts: [[34, 40], [42, 36]] },
    { kind: 'filled', pts: [[10, 30], [4, 38]] },
    { kind: 'hollow', pts: [[20, 42], [14, 50]] },
    { kind: 'filled', pts: [[26, 20], [34, 14]] },
    { kind: 'large', pts: [[40, 32], [48, 28]] },
    { kind: 'filled', pts: [[42, 14], [50, 10]] },
    { kind: 'filled', pts: [[24, 36], [30, 42]] },
    { kind: 'hollow', pts: [[18, 8], [26, 4]] },
    { kind: 'large', pts: [[52, 26], [58, 22]] },
    { kind: 'filled', pts: [[12, 24], [6, 28]] },
    { kind: 'filled', pts: [[36, 46], [42, 50]] },
    { kind: 'hollow', pts: [[48, 18], [54, 14]] },
    { kind: 'large', pts: [[30, 6], [36, 2]] },
  ];

  const segs = [];
  traces.forEach((tr, i) => {
    segs.push(...routePcb(tr.pts, aspect, i * 4, tr.kind));
  });
  stubs.forEach((st, i) => {
    segs.push(...routePcb(st.pts, aspect, 80 + i, st.kind));
  });
  return segs;
}

function invertSegments(tlSegs) {
  const inv = (v) => round(100 - v);
  return [...tlSegs]
    .reverse()
    .map((seg) => {
      const m = seg.d.match(/M\s+([-\d.]+)\s+([-\d.]+)\s+L\s+([-\d.]+)\s+([-\d.]+)/i);
      if (!m) return null;
      const x1 = Number(m[1]);
      const y1 = Number(m[2]);
      const x2 = Number(m[3]);
      const y2 = Number(m[4]);
      return {
        d: `M ${inv(x2)} ${inv(y2)} L ${inv(x1)} ${inv(y1)}`,
        nx: inv(x1),
        ny: inv(y1),
        showNode: seg.showNode,
        nodeKind: seg.nodeKind,
        gen: seg.gen,
      };
    })
    .filter(Boolean);
}

function nodeRadius(kind) {
  if (kind === 'large') return 0.85;
  if (kind === 'hollow') return 0.68;
  return 0.45;
}

function Segment({ seg, index, zone, total }) {
  const kind = seg.nodeKind || 'filled';
  const segRev = Math.max(0, total - 1 - index);
  return (
    <g
      className={`rf-entry-splash__seg rf-entry-splash__seg--${zone}`}
      style={{ '--seg': index, '--seg-rev': segRev, '--gen': seg.gen ?? 0 }}
    >
      {seg.isPadOnly ? null : (
        <path d={seg.d} pathLength="100" className="rf-entry-splash__seg-wire" />
      )}
      {seg.showNode && kind !== 'none' ? (
        <circle
          className={`rf-entry-splash__seg-node${
            kind === 'hollow' ? '' : ' rf-entry-splash__seg-node--filled'
          }`}
          cx={seg.nx}
          cy={seg.ny}
          r={nodeRadius(kind)}
        />
      ) : null}
    </g>
  );
}

function Network({ segments, zone }) {
  const total = segments.length;
  return (
    <g
      className={`rf-entry-splash__circuits-${zone}`}
      fill="none"
      stroke={STROKE}
      strokeWidth="0.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {segments.map((seg, i) => (
        <Segment key={`${zone}-${i}`} seg={seg} index={i} zone={zone} total={total} />
      ))}
    </g>
  );
}

export default function EntrySplashCircuits() {
  const [aspect, setAspect] = useState(16 / 9);

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth || 1600;
      const h = window.innerHeight || 900;
      setAspect(Math.max(0.6, Math.min(2.4, w / h)));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const { tl, br } = useMemo(() => {
    const raw = buildCircuitFan(aspect);
    const tlSegs = [...raw]
      .sort((a, b) => a.nx * a.nx + a.ny * a.ny - (b.nx * b.nx + b.ny * b.ny))
      .map((seg, i) => ({ ...seg, gen: Math.floor(i / 4) }));
    const brSegs = invertSegments(tlSegs).map((seg, i) => ({
      ...seg,
      gen: Math.floor(i / 4),
    }));
    return { tl: tlSegs, br: brSegs };
  }, [aspect]);

  return (
    <svg
      className="rf-entry-splash__circuits"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <Network segments={tl} zone="tl" />
      <g className="rf-entry-splash__circuits-br">
        <Network segments={br} zone="br" />
      </g>
    </svg>
  );
}
