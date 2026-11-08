/**
 * Virtual data hall (React Three Fiber). Renders on demand only; every
 * visual state (LEDs, rack beacons, CDU status) comes from the engine snapshot.
 */
import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Vector3 } from 'three';

interface OrbitControlsImpl {
  target: Vector3;
  update: () => void;
}
import { displayedHealth } from '@/simulation/diagnostics/DiagnosticEngine';
import { worstHealth } from '@/simulation/core/util';
import { useSim } from '@/stores/simulationStore';
import type { Equipment, Health } from '@/types/simulation';
import { Infrastructure } from './Infrastructure';
import { RackModel } from './RackModel';
import { rearDoorTexture } from './textures';

export type CameraPreset = 'overview' | 'cold' | 'hotA' | 'hotB' | 'top';

const PRESETS: Record<CameraPreset, { pos: [number, number, number]; target: [number, number, number] }> = {
  overview: { pos: [6.4, 5.4, 1.6], target: [-0.6, 0.6, 0] },
  cold: { pos: [-4.2, 1.65, 0], target: [1.6, 1.1, 0] },
  hotA: { pos: [-4.0, 1.7, -3.0], target: [1.6, 1.1, -2.7] },
  hotB: { pos: [-4.0, 1.7, 3.0], target: [1.6, 1.1, 2.7] },
  top: { pos: [-0.2, 9.5, 0.4], target: [-0.2, 0, 0] },
};

function CameraRig({ preset, focus }: { preset: CameraPreset; focus: [number, number, number] | null }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsImpl | null;
  const invalidate = useThree((s) => s.invalidate);
  const goal = useRef<{ pos: Vector3; target: Vector3 } | null>(null);

  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  useEffect(() => {
    const p = PRESETS[preset];
    const target = new Vector3(...p.target);
    const pos = new Vector3(...p.pos);
    // Pull the camera back on narrow (portrait) canvases so the whole hall fits.
    if (preset === 'overview' || preset === 'top') pos.sub(target).multiplyScalar(Math.min(1.45, Math.max(1, 0.95 / aspect))).add(target);
    goal.current = { pos, target };
    invalidate();
  }, [preset, invalidate, aspect]);

  useEffect(() => {
    if (!focus || !controls) return;
    const t = new Vector3(...focus);
    const offset = camera.position.clone().sub(controls.target).setLength(3.2);
    goal.current = { pos: t.clone().add(offset.setY(Math.max(offset.y, 1.2))), target: t };
    invalidate();
  }, [focus, controls, camera, invalidate]);

  useFrame(() => {
    const g = goal.current;
    if (!g || !controls) return;
    camera.position.lerp(g.pos, 0.12);
    controls.target.lerp(g.target, 0.12);
    controls.update();
    if (camera.position.distanceTo(g.pos) < 0.01 && controls.target.distanceTo(g.target) < 0.01) goal.current = null;
    else invalidate();
  });
  return null;
}

/** Technician crash cart parked in front of / behind a rack, with the laptop screen lit when it is on. */
function CrashCart({ x, z, facing, poweredOn, linkUp }: { x: number; z: number; facing: number; poweredOn: boolean; linkUp: boolean }) {
  return (
    <group position={[x, 0, z]} rotation={[0, facing > 0 ? 0 : Math.PI, 0]}>
      <mesh position={[0, 0.45, 0]}>
        <boxGeometry args={[0.55, 0.04, 0.4]} />
        <meshStandardMaterial color="#5b646b" metalness={0.5} roughness={0.5} />
      </mesh>
      {[-0.24, 0.24].map((dx) =>
        [-0.17, 0.17].map((dz) => (
          <mesh key={`${dx}${dz}`} position={[dx, 0.22, dz]}>
            <cylinderGeometry args={[0.012, 0.012, 0.44, 6]} />
            <meshStandardMaterial color="#3a4248" />
          </mesh>
        )),
      )}
      <mesh position={[0, 0.48, 0.02]}>
        <boxGeometry args={[0.34, 0.015, 0.23]} />
        <meshStandardMaterial color="#1c2023" />
      </mesh>
      <mesh position={[0, 0.6, -0.1]} rotation={[-0.25, 0, 0]}>
        <boxGeometry args={[0.34, 0.22, 0.01]} />
        <meshBasicMaterial color={poweredOn ? (linkUp ? '#1d4a2a' : '#1f3346') : '#0b0d0e'} toneMapped={false} />
      </mesh>
    </group>
  );
}

export interface DataHallSceneProps {
  selectedRackId: string;
  preset: CameraPreset;
  focusSeq: number;
  devMode: boolean;
  onSelect: (rackId: string) => void;
  onOpen: (rackId: string) => void;
}

export default function DataHallScene({ selectedRackId, preset, focusSeq, devMode, onSelect, onOpen }: DataHallSceneProps) {
  const s = useSim((st) => st);
  const [hovered, setHovered] = useState<string | null>(null);
  const door = useMemo(() => rearDoorTexture(), []);

  const byRack = useMemo(() => {
    const map = new Map<string, Equipment[]>();
    for (const e of Object.values(s.equipment)) {
      if (e.location.kind !== 'rack') continue;
      const list = map.get(e.location.rackId) ?? [];
      list.push(e);
      map.set(e.location.rackId, list);
    }
    return map;
  }, [s.equipment]);

  const racks = Object.values(s.racks);
  const rackHealth = (id: string): Health => worstHealth((byRack.get(id) ?? []).map((e) => displayedHealth(s, e, devMode)));
  const cduEq = s.equipment['cdu-01'];
  const cdu = cduEq && cduEq.location.kind === 'floor' ? { x: cduEq.location.x, z: cduEq.location.z, ok: cduEq.health === 'ok' } : undefined;
  const sel = s.racks[selectedRackId];
  const laptop = s.equipment[s.workstation.equipmentId];
  const cartRack = laptop?.location.kind === 'cart' ? s.racks[laptop.location.rackId] : undefined;
  const cartSide = laptop?.location.kind === 'cart' ? laptop.location.side : 'rear';
  const eth = laptop?.portIds.map((id) => s.ports[id]).find((p) => p?.defId === 'eth0');
  const cart = cartRack
    ? {
        x: cartRack.position.x,
        z: cartRack.position.z + cartRack.facing * (cartSide === 'front' ? 1 : -1) * 1.0,
        facing: cartRack.facing * (cartSide === 'front' ? 1 : -1),
        poweredOn: s.workstation.poweredOn,
        linkUp: eth?.state === 'link_up',
      }
    : undefined;
  const focus = useMemo<[number, number, number] | null>(() => (focusSeq > 0 && sel ? [sel.position.x, 1.1, sel.position.z] : null), [focusSeq]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.body.style.cursor = hovered ? 'pointer' : '';
    return () => {
      document.body.style.cursor = '';
    };
  }, [hovered]);

  return (
    <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: PRESETS.overview.pos, fov: 45, near: 0.1, far: 80 }} gl={{ antialias: true, powerPreference: 'high-performance' }} onPointerMissed={() => setHovered(null)}>
      <color attach="background" args={['#0b0d0e']} />
      <fog attach="fog" args={['#0b0d0e', 16, 34]} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#dfe7ee', '#101315', 0.55]} />
      <directionalLight position={[4, 8, 5]} intensity={1.1} />
      <pointLight position={[-0.2, 3.2, 0]} intensity={6} distance={9} color="#cfe3ff" />
      <Infrastructure width={s.facility.dimensions.width} depth={s.facility.dimensions.depth} racks={racks} cdu={cdu} />
      {racks.map((r) => (
        <RackModel
          key={r.id}
          s={s}
          rack={r}
          equipment={byRack.get(r.id) ?? []}
          health={rackHealth(r.id)}
          selected={r.id === selectedRackId}
          hovered={r.id === hovered}
          doorTexture={door}
          onSelect={onSelect}
          onOpen={onOpen}
          onHover={setHovered}
        />
      ))}
      {cart && <CrashCart {...cart} />}
      <OrbitControls makeDefault enableDamping={false} minDistance={1.2} maxDistance={16} maxPolarAngle={Math.PI / 2.05} target={PRESETS.overview.target} />
      <CameraRig preset={preset} focus={focus} />
    </Canvas>
  );
}
