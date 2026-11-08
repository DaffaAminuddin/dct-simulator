import { useMemo } from 'react';

/** Detect WebGL support once; the data hall falls back to a 2D plan without it. */
export function useWebGLAvailable(): boolean {
  return useMemo(() => {
    try {
      const canvas = document.createElement('canvas');
      return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
    } catch {
      return false;
    }
  }, []);
}
