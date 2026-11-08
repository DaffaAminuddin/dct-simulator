/**
 * Top-down chassis view (front at top). Internal slots are hidden while the
 * lid is closed. Health colouring follows the physical LED channel unless
 * developer mode is on.
 */
import { getComponentModel } from '@/data/hardware/componentCatalog';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { componentLed, type LedColor } from '@/simulation/diagnostics/DiagnosticEngine';
import type { SlotDef } from '@/types/catalog';
import type { Component, Equipment, SimulationState } from '@/types/simulation';

const W = 1000;
const LED_FILL: Record<LedColor, string> = {
  off: '#2a3034',
  green: '#67bd45',
  amber: '#e2a72e',
  blue: '#3b82f6',
  'blink-green': '#67bd45',
  'blink-amber': '#e2a72e',
};

function depthFor(heightU: number, kind: string): number {
  if (kind === 'power_shelf') return 420;
  if (kind === 'cdu') return 600;
  return heightU >= 4 ? 760 : 700;
}

function Part({ slot, comp, x, y, w, h, s, devMode }: { slot: SlotDef; comp: Component; x: number; y: number; w: number; h: number; s: SimulationState; devMode: boolean }) {
  const m = getComponentModel(comp.modelId);
  const led = componentLed(s, comp);
  const blink = led.startsWith('blink');
  const truth = devMode && comp.health !== 'ok' && comp.health !== 'unknown' ? (comp.health === 'critical' ? '#e5534b' : '#e2a72e') : null;
  const liquid = m.cooling === 'liquid';
  const ledEl = (cx: number, cy: number) => (
    <circle cx={cx} cy={cy} r={Math.max(4, Math.min(7, w / 18))} fill={LED_FILL[led]} className={blink ? 'animate-blink' : undefined} />
  );
  let body: React.ReactNode;
  switch (slot.category) {
    case 'cpu':
      body = (
        <>
          <rect x={x} y={y} width={w} height={h} rx={4} fill="#20262a" stroke="#4a545b" />
          {liquid ? (
            <>
              <rect x={x + w * 0.12} y={y + h * 0.12} width={w * 0.76} height={h * 0.76} rx={3} fill="#1d2a3a" stroke="#3b6aa0" />
              <path d={`M${x + w * 0.3} ${y} v${-h * 0.15} M${x + w * 0.7} ${y} v${-h * 0.15}`} stroke="#3b82f6" strokeWidth={4} />
            </>
          ) : (
            Array.from({ length: 7 }, (_, i) => <line key={i} x1={x + 6} x2={x + w - 6} y1={y + ((i + 1) * h) / 8} y2={y + ((i + 1) * h) / 8} stroke="#3a4248" strokeWidth={2} />)
          )}
        </>
      );
      break;
    case 'gpu':
    case 'nvswitch':
    case 'asic':
      body = (
        <>
          <rect x={x} y={y} width={w} height={h} rx={4} fill={slot.category === 'gpu' ? '#1c2420' : '#1f1d26'} stroke="#4a545b" />
          {liquid ? (
            <rect x={x + w * 0.1} y={y + h * 0.1} width={w * 0.8} height={h * 0.8} rx={3} fill="#1b2838" stroke="#3b6aa0" />
          ) : (
            Array.from({ length: 10 }, (_, i) => <line key={i} x1={x + ((i + 1) * w) / 11} x2={x + ((i + 1) * w) / 11} y1={y + 5} y2={y + h - 5} stroke="#34403a" strokeWidth={2} />)
          )}
        </>
      );
      break;
    case 'dimm':
      body = (
        <>
          <rect x={x} y={y} width={w} height={h} rx={1} fill="#163020" stroke="#2d5a3b" />
          {Array.from({ length: 5 }, (_, i) => (
            <rect key={i} x={x + w * 0.2} y={y + (i + 0.5) * (h / 5.5)} width={w * 0.6} height={h / 9} fill="#0e1a12" />
          ))}
        </>
      );
      break;
    case 'fan':
      body = (
        <>
          <rect x={x} y={y} width={w} height={h} rx={3} fill="#15191c" stroke="#3a4248" />
          <circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) * 0.38} fill="none" stroke="#4a545b" strokeWidth={2} />
          <circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) * 0.1} fill="#4a545b" />
        </>
      );
      break;
    case 'psu':
      body = (
        <>
          <rect x={x} y={y} width={w} height={h} rx={3} fill="#1b1f22" stroke="#4a545b" />
          <rect x={x + 6} y={y + 6} width={w - 12} height={h * 0.5} fill="url(#grille)" />
        </>
      );
      break;
    case 'nic':
    case 'dpu':
    case 'raid':
      body = (
        <>
          <rect x={x} y={y} width={w} height={h} rx={2} fill="#14261c" stroke="#2d5a3b" />
          <rect x={x + w * 0.35} y={y + h * 0.2} width={w * 0.3} height={h * 0.45} fill="#22282c" stroke="#4a545b" />
        </>
      );
      break;
    case 'nvme':
    case 'ssd':
      body = <rect x={x} y={y} width={w} height={h} rx={2} fill="#1d2226" stroke="#4a545b" />;
      break;
    case 'riser':
      body = <rect x={x} y={y} width={w} height={h} rx={2} fill="#14261c" stroke="#2d5a3b" />;
      break;
    case 'bmc':
      body = (
        <>
          <rect x={x} y={y} width={w} height={h} rx={2} fill="#14261c" stroke="#2d5a3b" />
          <rect x={x + w * 0.3} y={y + h * 0.25} width={w * 0.4} height={h * 0.5} fill="#22282c" />
        </>
      );
      break;
    case 'pump':
      body = (
        <>
          <rect x={x} y={y} width={w} height={h} rx={6} fill="#172030" stroke="#3b6aa0" />
          <circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) * 0.32} fill="none" stroke="#3b82f6" strokeWidth={3} />
        </>
      );
      break;
    default:
      body = <rect x={x} y={y} width={w} height={h} fill="#20262a" stroke="#4a545b" />;
  }
  const showLed = ['psu', 'fan', 'nvme', 'ssd', 'dimm', 'pump', 'bmc', 'nic', 'dpu'].includes(slot.category) || led === 'amber' || led === 'blink-amber';
  return (
    <>
      {body}
      {truth && <rect x={x} y={y} width={w} height={h} rx={3} fill={truth} opacity={0.25} pointerEvents="none" />}
      {showLed && ledEl(slot.category === 'dimm' ? x + w / 2 : x + w - 9, slot.category === 'dimm' ? y - 7 : y + 9)}
    </>
  );
}

export function ChassisView({ s, eq, selectedSlotId, devMode, onSelectSlot }: { s: SimulationState; eq: Equipment; selectedSlotId: string | null; devMode: boolean; onSelectSlot: (slotId: string) => void }) {
  const model = getEquipmentModel(eq.modelId);
  const D = depthFor(model.heightU, model.kind);
  const pad = 40;
  const internal = (sl: SlotDef) => sl.access === 'internal';
  const lidClosed = !eq.chassisOpen && model.slots.some(internal);
  const slots = model.slots.filter((sl) => sl.category !== 'motherboard');

  return (
    <svg viewBox={`0 0 ${W + pad * 2} ${D + pad * 2}`} className="h-auto w-full select-none" role="group" aria-label={`${eq.hostname} chassis, top view`}>
      <defs>
        <pattern id="grille" width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="4" r="1.6" fill="#3a4248" />
        </pattern>
        <pattern id="board" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M0 20h40M20 0v40" stroke="#13241a" strokeWidth="1" />
        </pattern>
      </defs>
      <text x={pad + W / 2} y={24} textAnchor="middle" fill="#8d969c" fontSize={18} letterSpacing={4}>
        FRONT · COLD AISLE
      </text>
      <text x={pad + W / 2} y={D + pad * 2 - 10} textAnchor="middle" fill="#8d969c" fontSize={18} letterSpacing={4}>
        REAR · HOT AISLE
      </text>
      <rect x={pad} y={pad} width={W} height={D} rx={10} fill="#0d1311" stroke="#3a4248" strokeWidth={3} />
      {eq.slots.mb !== undefined && <rect x={pad + 6} y={pad + 6} width={W - 12} height={D - 12} rx={6} fill="url(#board)" opacity={eq.slots.mb ? 1 : 0.2} />}
      {slots.map((sl) => {
        const x = pad + (sl.layout.x / 100) * W;
        const y = pad + (sl.layout.y / 100) * D;
        const w = (sl.layout.w / 100) * W;
        const h = (sl.layout.h / 100) * D;
        const cid = eq.slots[sl.id];
        const comp = cid ? s.components[cid] : undefined;
        const hidden = lidClosed && internal(sl);
        if (hidden) return null;
        const selected = selectedSlotId === sl.id;
        return (
          <g
            key={sl.id}
            role="button"
            tabIndex={0}
            aria-label={`${sl.label}${comp ? `: ${getComponentModel(comp.modelId).name}` : ': empty'}`}
            aria-pressed={selected}
            data-slot={sl.id}
            onClick={() => onSelectSlot(sl.id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelectSlot(sl.id)}
            className="cursor-pointer outline-none [&:focus-visible>rect.sel]:stroke-[#7cc33f]"
          >
            {comp ? <Part slot={sl} comp={comp} x={x} y={y} w={w} h={h} s={s} devMode={devMode} /> : <rect x={x} y={y} width={w} height={h} rx={3} fill="#0a0d0c" stroke="#3a4248" strokeDasharray="6 5" />}
            <rect className="sel" x={x - 3} y={y - 3} width={w + 6} height={h + 6} rx={5} fill="transparent" stroke={selected ? '#7cc33f' : 'transparent'} strokeWidth={3} />
            {w > 70 && h > 34 && (
              <text x={x + w / 2} y={y + h - 8} textAnchor="middle" fill={comp ? '#aab3b9' : '#5f686e'} fontSize={13} pointerEvents="none">
                {sl.label.replace(/^Superchip \d · /, '')}
              </text>
            )}
          </g>
        );
      })}
      {lidClosed && (
        <g>
          <rect x={pad + 10} y={pad + D * 0.13} width={W - 20} height={D * 0.72} rx={8} fill="#1a1f22" stroke="#4a545b" strokeWidth={2} />
          <text x={pad + W / 2} y={pad + D * 0.47} textAnchor="middle" fill="#8d969c" fontSize={22}>
            Lid closed
          </text>
          <text x={pad + W / 2} y={pad + D * 0.47 + 28} textAnchor="middle" fill="#5f686e" fontSize={15}>
            Open the chassis to inspect internal components (front/rear-access parts stay visible)
          </text>
        </g>
      )}
    </svg>
  );
}
