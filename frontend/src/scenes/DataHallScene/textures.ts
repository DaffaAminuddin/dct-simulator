/** Procedural textures (no downloads): raised-floor tiles and perforated tiles. */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

function make(draw: (ctx: CanvasRenderingContext2D, size: number) => void, size = 128): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, size);
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** One 600 mm floor tile per texture repeat. */
export function floorTileTexture(): CanvasTexture {
  return make((ctx, n) => {
    ctx.fillStyle = '#1a1e21';
    ctx.fillRect(0, 0, n, n);
    ctx.fillStyle = '#20252a';
    ctx.fillRect(3, 3, n - 6, n - 6);
    ctx.strokeStyle = '#0d0f11';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, n - 3, n - 3);
  });
}

export function perforatedTileTexture(): CanvasTexture {
  return make((ctx, n) => {
    ctx.fillStyle = '#1b232b';
    ctx.fillRect(0, 0, n, n);
    ctx.fillStyle = '#0e1318';
    const step = n / 12;
    for (let y = step / 2; y < n; y += step) for (let x = step / 2; x < n; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, step * 0.26, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#0b0e11';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, n - 3, n - 3);
  });
}

export function rearDoorTexture(): CanvasTexture {
  return make((ctx, n) => {
    ctx.fillStyle = '#121518';
    ctx.fillRect(0, 0, n, n);
    ctx.fillStyle = '#050708';
    const step = n / 16;
    for (let y = step / 2; y < n; y += step) for (let x = step / 2; x < n; x += step) ctx.fillRect(x - step * 0.2, y - step * 0.2, step * 0.4, step * 0.4);
  }, 64);
}
