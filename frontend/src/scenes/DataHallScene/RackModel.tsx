/** 3D rack cabinet with equipment faceplates and front-panel LEDs from the engine. */
import { Edges } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { memo, useMemo } from 'react';
import type { Texture } from 'three';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { frontLeds, type LedColor } from '@/simulation/diagnostics/DiagnosticEngine';
import { TextSprite } from './TextSprite';
import type { Equipment, Health, Rack, SimulationState } from '@/types/simulation';

export const U_M = 0.04445;
export const RACK_W = 0.6;
export const RACK_D = 1.2;
export const rackHeightM = (heightU: number) => heightU * U_M + 0.16;

const LED_HEX: Record<LedColor, string> = {
  off: '#1c2125',
  green: '#67e04a',
  amber: '#ffb52e',
  blue: '#3b82f6',
  'blink-green': '#67e04a',
  'blink-amber': '#ffb52e',
};
const HEALTH_HEX: Record<Health, string> = { ok: '#67bd45', warning: '#e2a72e', critical: '#e5534b', unknown: '#6b7480' };

const FACE_COLOR: Record<string, string> = {
  server: '#2a3035',
  compute_tray: '#262d26',
  nvlink_switch_tray: '#2a2833',
  power_shelf: '#353b40',
  switch: '#1d2125',
  blank: '#0f1113',
};

interface Props {
  s: SimulationState;
  rack: Rack;
  equipment: Equipment[];
  health: Health;
  selected: boolean;
  hovered: boolean;
  doorTexture: Texture;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onHover: (id: string | null) => void;
}

function RackInner({ s, rack, equipment, health, selected, hovered, doorTexture, onSelect, onOpen, onHover }: Props) {
  const H = rackHeightM(rack.heightU);
  const front = rack.facing; // +1 front faces +z
  const faces = useMemo(
    () =>
      equipment
        .filter((e) => e.location.kind === 'rack' && e.location.uStart !== null)
        .map((e) => {
          const m = getEquipmentModel(e.modelId);
          const u = e.location.kind === 'rack' ? (e.location.uStart ?? 1) : 1;
          return { e, h: m.heightU * U_M, y: 0.08 + (u - 1) * U_M + (m.heightU * U_M) / 2, led: e.kind === 'blank' ? null : frontLeds(s, e) };
        }),
    // Faceplates depend only on the equipment objects (stable refs between unchanged ticks).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [equipment],
  );

  const handlers = {
    onClick: (ev: ThreeEvent<MouseEvent>) => {
      ev.stopPropagation();
      onSelect(rack.id);
    },
    onDoubleClick: (ev: ThreeEvent<MouseEvent>) => {
      ev.stopPropagation();
      onOpen(rack.id);
    },
    onPointerOver: (ev: ThreeEvent<PointerEvent>) => {
      ev.stopPropagation();
      onHover(rack.id);
    },
    onPointerOut: () => onHover(null),
  };

  const zFront = (front * RACK_D) / 2;
  return (
    <group position={[rack.position.x, 0, rack.position.z]}>
      {/* Cabinet shell: sides, top, plinth, perforated rear door */}
      <mesh position={[0, H / 2, 0]} {...handlers}>
        <boxGeometry args={[RACK_W, H, RACK_D]} />
        <meshStandardMaterial color="#121517" metalness={0.4} roughness={0.7} transparent opacity={0.0} depthWrite={false} />
        {(selected || hovered) && <Edges color={selected ? '#93d65a' : '#8d969c'} lineWidth={selected ? 2 : 1} />}
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[(side * RACK_W) / 2 - side * 0.01, H / 2, 0]}>
          <boxGeometry args={[0.02, H, RACK_D]} />
          <meshStandardMaterial color="#16191c" metalness={0.5} roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, H - 0.01, 0]}>
        <boxGeometry args={[RACK_W, 0.02, RACK_D]} />
        <meshStandardMaterial color="#16191c" metalness={0.5} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.03, 0]}>
        <boxGeometry args={[RACK_W, 0.06, RACK_D]} />
        <meshStandardMaterial color="#0c0e0f" />
      </mesh>
      <mesh position={[0, H / 2, -zFront + front * 0.012]}>
        <boxGeometry args={[RACK_W - 0.04, H - 0.04, 0.01]} />
        <meshStandardMaterial map={doorTexture} color="#3a4248" metalness={0.3} roughness={0.8} />
      </mesh>
      {/* Rack interior backdrop so faceplate gaps read as dark */}
      <mesh position={[0, H / 2, zFront - front * 0.06]}>
        <boxGeometry args={[RACK_W - 0.06, H - 0.1, 0.01]} />
        <meshStandardMaterial color="#050607" />
      </mesh>
      {faces.map(({ e, h, y, led }) => (
        <group key={e.id} position={[0, y, zFront - front * 0.035]}>
          <mesh>
            <boxGeometry args={[0.482, h - 0.003, 0.02]} />
            <meshStandardMaterial color={FACE_COLOR[e.kind] ?? '#2a3035'} metalness={0.35} roughness={0.65} />
          </mesh>
          {led && (
            <>
              <mesh position={[0.205, 0, front * 0.012]}>
                <boxGeometry args={[0.008, 0.008, 0.004]} />
                <meshBasicMaterial color={LED_HEX[led.power]} toneMapped={false} />
              </mesh>
              <mesh position={[0.22, 0, front * 0.012]}>
                <boxGeometry args={[0.008, 0.008, 0.004]} />
                <meshBasicMaterial color={LED_HEX[led.health]} toneMapped={false} />
              </mesh>
              {led.uid === 'blue' && (
                <mesh position={[0.232, 0, front * 0.012]}>
                  <boxGeometry args={[0.008, 0.008, 0.004]} />
                  <meshBasicMaterial color={LED_HEX.blue} toneMapped={false} />
                </mesh>
              )}
            </>
          )}
        </group>
      ))}
      {/* Rack beacon: monitoring health */}
      <mesh position={[0, H + 0.015, zFront - front * 0.1]}>
        <boxGeometry args={[RACK_W * 0.7, 0.015, 0.04]} />
        <meshBasicMaterial color={HEALTH_HEX[health]} toneMapped={false} />
      </mesh>
      <TextSprite
        text={rack.id}
        mono
        position={[0, H + 0.2, 0]}
        height={0.22}
        color={selected ? '#a6e07a' : '#c9d0d5'}
        border={selected ? '#7cc33f' : '#353c41'}
        background={selected ? 'rgba(40,62,24,0.92)' : 'rgba(17,20,22,0.88)'}
        onClick={handlers.onClick}
        onDoubleClick={handlers.onDoubleClick}
      />
    </group>
  );
}

function sameList(a: Equipment[], b: Equipment[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export const RackModel = memo(RackInner, (a, b) => a.rack === b.rack && a.health === b.health && a.selected === b.selected && a.hovered === b.hovered && sameList(a.equipment, b.equipment));
