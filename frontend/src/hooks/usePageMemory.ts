import { useCallback } from 'react';
import { type PageMemory, useUiStore } from '@/stores/uiStore';

/** A page's remembered value (last open ticket, filter, tab...) with its setter. */
export function usePageMemory<K extends keyof PageMemory>(key: K): [PageMemory[K], (value: PageMemory[K]) => void] {
  const value = useUiStore((s) => s.page[key]);
  const setPage = useUiStore((s) => s.setPage);
  const set = useCallback((v: PageMemory[K]) => setPage({ [key]: v } as Partial<PageMemory>), [key, setPage]);
  return [value, set];
}
