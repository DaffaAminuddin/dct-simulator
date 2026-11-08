/**
 * Camera-facing text label drawn into a canvas texture. Avoids per-label React
 * roots (drei <Html>) and remote font downloads (troika text).
 */
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';

interface Props {
  text: string;
  position: [number, number, number];
  color?: string;
  background?: string;
  border?: string;
  /** Label height in metres. */
  height?: number;
  mono?: boolean;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  onDoubleClick?: (e: ThreeEvent<MouseEvent>) => void;
}

export function TextSprite({ text, position, color = '#c9d0d5', background = 'rgba(17,20,22,0.88)', border = '#353c41', height = 0.16, mono = false, onClick, onDoubleClick }: Props) {
  const texture = useMemo(() => {
    const px = 40;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = `600 ${px}px ${mono ? 'ui-monospace, Consolas, monospace' : 'ui-sans-serif, "Segoe UI", sans-serif'}`;
    let w = text.length * px * 0.62;
    if (ctx) {
      ctx.font = font;
      w = ctx.measureText(text).width;
    }
    canvas.width = Math.ceil(w + px * 0.9);
    canvas.height = Math.ceil(px * 1.6);
    if (ctx) {
      ctx.font = font;
      ctx.fillStyle = background;
      ctx.strokeStyle = border;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(1.5, 1.5, canvas.width - 3, canvas.height - 3, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, px * 0.45, canvas.height / 2 + 1);
    }
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    return tex;
  }, [text, color, background, border, mono]);

  useEffect(() => () => texture.dispose(), [texture]);

  const aspect = texture.image.width / texture.image.height;
  return (
    <sprite position={position} scale={[height * aspect, height, 1]} renderOrder={10} onClick={onClick} onDoubleClick={onDoubleClick}>
      <spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} toneMapped={false} />
    </sprite>
  );
}
