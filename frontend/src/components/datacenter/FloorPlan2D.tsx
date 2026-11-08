/**
 * 2D floor plan: same navigation as the 3D hall, used when WebGL is
 * unavailable or when the learner prefers a plan view.
 */
import { displayedHealth } from '@/simulation/diagnostics/DiagnosticEngine';
import { worstHealth } from '@/simulation/core/util';
import { useSim } from '@/stores/simulationStore';
import type { Health } from '@/types/simulation';

const HEALTH_FILL: Record<Health, string> = { ok: '#24361f', warning: '#3d3218', critical: '#40201e', unknown: '#262b30' };
const HEALTH_STROKE: Record<Health, string> = { ok: '#67bd45', warning: '#e2a72e', critical: '#e5534b', unknown: '#6b7480' };

export function FloorPlan2D({ selectedRackId, devMode, onSelect, onOpen }: { selectedRackId: string; devMode: boolean; onSelect: (id: string) => void; onOpen: (id: string) => void }) {
  const s = useSim((st) => st);
  const racks = Object.values(s.racks);
  const scale = 90;
  const xs = racks.map((r) => r.position.x);
  const minX = Math.min(...xs) - 1.6;
  const maxX = Math.max(...xs) + 1.6;
  const W = (maxX - minX) * scale;
  const Hm = 6.4;
  const H = Hm * scale;
  const tx = (x: number) => (x - minX) * scale;
  const tz = (z: number) => (z + Hm / 2) * scale;
  const cdu = s.equipment['cdu-01'];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="group" aria-label="Data hall floor plan">
      <defs>
        <pattern id="tiles" width={0.6 * scale} height={0.6 * scale} patternUnits="userSpaceOnUse">
          <rect width={0.6 * scale} height={0.6 * scale} fill="#14181b" stroke="#0b0d0e" strokeWidth="2" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#tiles)" />
      <rect x={tx(minX + 0.6)} y={tz(-0.9)} width={(maxX - minX - 1.2) * scale} height={1.8 * scale} fill="#3b82f6" opacity={0.12} />
      <text x={tx(minX + 0.7)} y={tz(0) + 4} fill="#86c2ee" fontSize={12} letterSpacing={3}>
        COLD AISLE
      </text>
      {[-2.7, 2.7].map((z) => (
        <g key={z}>
          <rect x={tx(minX + 0.6)} y={tz(z) - 0.6 * scale} width={(maxX - minX - 1.2) * scale} height={1.2 * scale} fill="#e5534b" opacity={0.08} />
          <text x={tx(minX + 0.7)} y={tz(z) + 4} fill="#f0a09b" fontSize={12} letterSpacing={3}>
            {z < 0 ? 'HOT AISLE A' : 'HOT AISLE B'}
          </text>
        </g>
      ))}
      {racks.map((r) => {
        const health = worstHealth(Object.values(s.equipment).filter((e) => e.location.kind === 'rack' && e.location.rackId === r.id).map((e) => displayedHealth(s, e, devMode)));
        const selected = r.id === selectedRackId;
        const x = tx(r.position.x - 0.3);
        const y = tz(r.position.z - 0.6);
        return (
          <g
            key={r.id}
            role="button"
            tabIndex={0}
            aria-label={`Rack ${r.id}`}
            className="cursor-pointer outline-none"
            onClick={() => onSelect(r.id)}
            onDoubleClick={() => onOpen(r.id)}
            onKeyDown={(e) => e.key === 'Enter' && onOpen(r.id)}
          >
            <rect x={x} y={y} width={0.6 * scale} height={1.2 * scale} rx={3} fill={HEALTH_FILL[health]} stroke={selected ? '#93d65a' : HEALTH_STROKE[health]} strokeWidth={selected ? 3 : 1.5} />
            <rect x={x + 3} y={r.facing > 0 ? y + 1.2 * scale - 8 : y + 3} width={0.6 * scale - 6} height={5} fill="#7cc33f" opacity={0.5} />
            <text x={x + 0.3 * scale} y={y + 0.6 * scale + 4} textAnchor="middle" fill="#e3e6e8" fontSize={13} fontFamily="monospace">
              {r.id}
            </text>
          </g>
        );
      })}
      {cdu && cdu.location.kind === 'floor' && (
        <g>
          <rect x={tx(cdu.location.x - 0.4)} y={tz(cdu.location.z - 0.6)} width={0.8 * scale} height={1.2 * scale} rx={3} fill="#1c2733" stroke="#3b82f6" />
          <text x={tx(cdu.location.x)} y={tz(cdu.location.z) + 4} textAnchor="middle" fill="#86c2ee" fontSize={12}>
            CDU-01
          </text>
        </g>
      )}
      <text x={10} y={H - 10} fill="#5f686e" fontSize={11}>
        Green bar = rack front. Click to select, double-click to open.
      </text>
    </svg>
  );
}
