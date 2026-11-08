import type { LedColor } from '@/simulation/diagnostics/DiagnosticEngine';
import { cn } from '@/utils/cn';

const LED_CLASS: Record<LedColor, string> = {
  off: 'bg-[#2a3034]',
  green: 'bg-ok shadow-[0_0_4px_var(--color-ok)]',
  amber: 'bg-warn shadow-[0_0_4px_var(--color-warn)]',
  blue: 'bg-uid shadow-[0_0_5px_var(--color-uid)]',
  'blink-green': 'bg-ok shadow-[0_0_4px_var(--color-ok)] animate-blink',
  'blink-amber': 'bg-warn shadow-[0_0_4px_var(--color-warn)] animate-blink',
};

export function Led({ color, className, title }: { color: LedColor; className?: string; title?: string }) {
  return <span title={title} className={cn('inline-block size-[5px] shrink-0 rounded-full', LED_CLASS[color], className)} />;
}
