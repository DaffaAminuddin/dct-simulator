/**
 * Lightweight SVG charts (DESIGN.md §6.3–6.5): monotone curves, sparkline
 * areas, a dual-series line chart with dashed second series and a hover
 * crosshair + tooltip. No chart library dependency.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '@/utils/cn';

type Pt = { x: number; y: number };

/** Monotone cubic (Fritsch–Carlson) path through points sorted by x. */
export function monotonePath(pts: Pt[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  const n = pts.length;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x || 1e-6;
    m[i] = (pts[i + 1].y - pts[i].y) / dx[i];
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  t[n - 1] = m[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const h = a * a + b * b;
    if (h > 9) {
      const k = 3 / Math.sqrt(h);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const c1x = pts[i].x + dx[i] / 3;
    const c1y = pts[i].y + (t[i] * dx[i]) / 3;
    const c2x = pts[i + 1].x - dx[i] / 3;
    const c2y = pts[i + 1].y - (t[i + 1] * dx[i]) / 3;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${pts[i + 1].x} ${pts[i + 1].y}`;
  }
  return d;
}

function scale(values: number[], w: number, h: number, pad = 2, min?: number, max?: number): Pt[] {
  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values);
  const span = hi - lo;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  // A flat series sits mid-height instead of hugging the bottom edge.
  return values.map((v, i) => ({ x: i * step, y: span === 0 ? h / 2 : pad + (h - 2 * pad) * (1 - (v - lo) / span) }));
}

/** Small area sparkline (stat cards, hero). */
export function Sparkline({ values, color, width = 72, height = 36, className }: { values: number[]; color: string; width?: number; height?: number; className?: string }) {
  const id = useId();
  const data = values.length >= 2 ? values : [values[0] ?? 0, values[0] ?? 0];
  const pts = scale(data, width, height, 3);
  const line = monotonePath(pts);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${line} L ${width} ${height} L 0 ${height} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

export interface Series {
  name: string;
  values: number[];
  color: string;
  dashed?: boolean;
}

/** Dual-series line chart with gridlines, axis labels and a hover tooltip. */
export function LineChart({ series, labels, height = 170, format, className }: { series: Series[]; labels: string[]; height?: number; format: (v: number) => string; className?: string }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [W, setW] = useState(640);
  // Draw in real pixels so axis text stays 11 px at every container width.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => el.clientWidth > 0 && setW(Math.round(el.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = height;
  const left = 46;
  const bottom = 22;
  const plotW = W - left - 8;
  const plotH = H - bottom - 8;
  const all = series.flatMap((s) => s.values);
  const maxRaw = Math.max(1, ...all);
  const step = niceStep(maxRaw / 3);
  const max = Math.ceil(maxRaw / step) * step;
  const ticks = [0, 1, 2, 3].map((i) => (max / 3) * i);
  const n = Math.max(1, ...series.map((s) => s.values.length));
  const xs = (i: number) => left + (n > 1 ? (plotW * i) / (n - 1) : plotW / 2);
  const ys = (v: number) => 8 + plotH * (1 - v / max);
  const paths = useMemo(
    () => series.map((s) => monotonePath(s.values.map((v, i) => ({ x: xs(i), y: ys(v) })))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, max, n, W],
  );
  const labelIdx = n <= 1 ? [0] : [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round((n - 1) * f)))];

  const onMove = (e: React.MouseEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const x = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((x - left) / plotW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div ref={ref} className={cn('relative w-full', className)} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={series.map((s) => s.name).join(' and ')}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-main)" stopOpacity={0.08} />
            <stop offset="100%" stopColor="var(--chart-main)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W - 8} y1={ys(t)} y2={ys(t)} stroke="var(--chart-grid)" strokeDasharray="4 4" />
            <text x={left - 8} y={ys(t) + 4} textAnchor="end" fontSize={11} fill="var(--text-secondary)">
              {format(t)}
            </text>
          </g>
        ))}
        {labelIdx.map((i) => (
          <text key={i} x={xs(i)} y={H - 4} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize={11} fill="var(--text-secondary)">
            {labels[i] ?? ''}
          </text>
        ))}
        {series[0] && paths[0] && <path d={`${paths[0]} L ${xs(n - 1)} ${ys(0)} L ${xs(0)} ${ys(0)} Z`} fill={`url(#${id})`} />}
        {series.map((s, k) => (
          <path key={s.name} d={paths[k]} fill="none" stroke={s.color} strokeWidth={s.dashed ? 1.5 : 2} strokeDasharray={s.dashed ? '4 4' : undefined} strokeLinecap="round" />
        ))}
        {hover !== null && (
          <g>
            <line x1={xs(hover)} x2={xs(hover)} y1={8} y2={8 + plotH} stroke="var(--text-subtle)" strokeWidth={1} />
            {series.map((s) => (
              <circle key={s.name} cx={xs(hover)} cy={ys(s.values[hover] ?? 0)} r={3.5} fill="var(--bg-main)" stroke={s.color} strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-full bg-hero px-3 py-1 text-[11px] font-semibold whitespace-nowrap text-hero-fg"
          style={{ left: `${(xs(hover) / W) * 100}%` }}
        >
          {series.map((s) => format(s.values[hover] ?? 0)).join(' / ')} · {labels[hover]}
        </div>
      )}
    </div>
  );
}

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
