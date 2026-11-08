/** Static data hall infrastructure: raised floor, aisles, trays, busway, CRAH units, CDU and coolant lines. */
import { useMemo } from 'react';
import type { Rack } from '@/types/simulation';
import { TextSprite } from './TextSprite';
import { floorTileTexture, perforatedTileTexture } from './textures';
import { RACK_D, RACK_W } from './RackModel';

const TILE = 0.6;

function Label({ position, children, tone = 'muted' }: { position: [number, number, number]; children: string; tone?: 'muted' | 'cold' | 'hot' }) {
  const color = tone === 'cold' ? '#86c2ee' : tone === 'hot' ? '#f0a09b' : '#9aa3a9';
  const border = tone === 'cold' ? '#2a4a66' : tone === 'hot' ? '#5a2b29' : '#30373c';
  return <TextSprite text={children} position={position} color={color} border={border} height={0.18} />;
}

export function Infrastructure({ width, depth, racks, cdu, light = false }: { width: number; depth: number; racks: Rack[]; cdu?: { x: number; z: number; ok: boolean }; light?: boolean }) {
  const floor = useMemo(() => {
    const t = floorTileTexture(light);
    t.repeat.set(width / TILE, depth / TILE);
    return t;
  }, [width, depth, light]);
  const xs = racks.map((r) => r.position.x);
  const minX = Math.min(...xs) - RACK_W / 2 - 0.6;
  const maxX = Math.max(...xs) + RACK_W / 2 + 0.6;
  const aisleLen = maxX - minX;
  const perf = useMemo(() => {
    const t = perforatedTileTexture(light);
    t.repeat.set(aisleLen / TILE, 3);
    return t;
  }, [aisleLen, light]);
  const cx = (minX + maxX) / 2;
  const rowZ = [...new Set(racks.map((r) => r.position.z))];

  return (
    <group>
      {/* Raised floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial map={floor} roughness={0.9} metalness={0.1} />
      </mesh>
      {/* Cold aisle: perforated tiles */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.002, 0]}>
        <planeGeometry args={[aisleLen, 1.8]} />
        <meshStandardMaterial map={perf} color={light ? '#dbe3f7' : '#9cc8ff'} roughness={0.8} />
      </mesh>
      {/* Hot aisles: tinted */}
      {rowZ.map((z) => {
        const hz = z + Math.sign(z) * (RACK_D / 2 + 0.6);
        return (
          <mesh key={z} rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.002, hz]}>
            <planeGeometry args={[aisleLen, 1.2]} />
            <meshBasicMaterial color="#e5534b" transparent opacity={0.07} depthWrite={false} />
          </mesh>
        );
      })}
      <Label position={[minX + 0.3, 0.25, 0]} tone="cold">
        COLD AISLE
      </Label>
      {rowZ.map((z) => (
        <Label key={z} position={[minX + 0.3, 0.25, z + Math.sign(z) * (RACK_D / 2 + 0.6)]} tone="hot">
          {`HOT AISLE ${z < 0 ? 'A' : 'B'}`}
        </Label>
      ))}

      {/* Overhead cable trays per row: yellow fibre runway + black copper ladder rack */}
      {rowZ.map((z) => (
        <group key={`tray-${z}`}>
          <mesh position={[cx, 2.62, z + Math.sign(z) * 0.15]}>
            <boxGeometry args={[aisleLen, 0.07, 0.3]} />
            <meshStandardMaterial color="#c9a227" roughness={0.6} />
          </mesh>
          <mesh position={[cx, 2.82, z - Math.sign(z) * 0.2]}>
            <boxGeometry args={[aisleLen, 0.05, 0.45]} />
            <meshStandardMaterial color="#202427" metalness={0.6} roughness={0.5} wireframe />
          </mesh>
        </group>
      ))}
      {/* Cross-aisle fibre tray to the network core */}
      <mesh position={[maxX - 0.9, 2.62, 0]}>
        <boxGeometry args={[0.3, 0.07, 3]} />
        <meshStandardMaterial color="#c9a227" roughness={0.6} />
      </mesh>
      <Label position={[cx, 3.0, rowZ[0] ?? 0]}>OVERHEAD FIBRE & COPPER TRAYS</Label>

      {/* Busway A/B above the hot aisles with tap-off boxes */}
      {rowZ.map((z) =>
        [-0.12, 0.12].map((dz, i) => (
          <group key={`bus-${z}-${i}`}>
            <mesh position={[cx, 3.05, z + Math.sign(z) * (RACK_D / 2 + 0.3) + dz]}>
              <boxGeometry args={[aisleLen, 0.12, 0.12]} />
              <meshStandardMaterial color={i === 0 ? '#6b7a86' : '#4d5862'} metalness={0.6} roughness={0.4} />
            </mesh>
          </group>
        )),
      )}
      {racks.map((r) => (
        <mesh key={`tap-${r.id}`} position={[r.position.x, 2.95, r.position.z + Math.sign(r.position.z) * (RACK_D / 2 + 0.3)]}>
          <boxGeometry args={[0.18, 0.12, 0.22]} />
          <meshStandardMaterial color="#8a6d1f" />
        </mesh>
      ))}

      {/* Perimeter CRAH units */}
      {[-1, 1].map((side) => (
        <group key={`crah-${side}`} position={[side * (width / 2 - 0.7), 0, 0]}>
          <mesh position={[0, 1.0, 0]}>
            <boxGeometry args={[0.9, 2.0, 2.4]} />
            <meshStandardMaterial color="#4b545a" roughness={0.7} metalness={0.2} />
          </mesh>
          <mesh position={[-side * 0.46, 1.4, 0]}>
            <boxGeometry args={[0.01, 0.9, 2.0]} />
            <meshStandardMaterial color="#2a2f33" />
          </mesh>
          <Label position={[0, 2.25, 0]}>{side < 0 ? 'CRAH-01' : 'CRAH-02'}</Label>
        </group>
      ))}

      {/* CDU and coolant supply/return lines to the liquid-cooled racks */}
      {cdu && (
        <group>
          <mesh position={[cdu.x, 1.0, cdu.z]}>
            <boxGeometry args={[0.8, 2.0, RACK_D]} />
            <meshStandardMaterial color="#3a4a5a" roughness={0.6} metalness={0.3} />
          </mesh>
          <mesh position={[cdu.x, 1.6, cdu.z - Math.sign(cdu.z) * 0.61]}>
            <boxGeometry args={[0.5, 0.25, 0.01]} />
            <meshBasicMaterial color={cdu.ok ? '#1f3a26' : '#4a1d1b'} />
          </mesh>
          {racks
            .filter((r) => r.cooling === 'liquid')
            .map((r) =>
              [
                ['#3b82f6', 0.1],
                ['#ef4444', -0.1],
              ].map(([color, dz]) => {
                const len = Math.abs(cdu.x - r.position.x);
                return (
                  <mesh key={`${r.id}-${color}`} position={[(cdu.x + r.position.x) / 2, 2.45, r.position.z + Number(dz) + Math.sign(r.position.z) * 0.35]} rotation={[0, 0, Math.PI / 2]}>
                    <cylinderGeometry args={[0.035, 0.035, len, 10]} />
                    <meshStandardMaterial color={String(color)} roughness={0.4} />
                  </mesh>
                );
              }),
            )}
          <Label position={[cdu.x, 2.3, cdu.z]}>CDU-01</Label>
        </group>
      )}
    </group>
  );
}
