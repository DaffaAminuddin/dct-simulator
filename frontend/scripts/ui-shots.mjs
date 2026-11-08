// Dev helper: screenshots of key pages in light/dark at several widths.
// Usage: node scripts/ui-shots.mjs <outDir> [baseUrl]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'ui-shots';
const base = process.argv[3] ?? 'http://localhost:5173';
mkdirSync(out, { recursive: true });

const pages = (process.env.PAGES ?? '/,/racks,/hardware,/network,/gpu,/cooling,/work-orders,/learning,/settings,/datacenter').split(',');
const widths = (process.env.WIDTHS ?? '1440').split(',').map(Number);
const themes = (process.env.THEMES ?? 'light,dark').split(',');

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' });
for (const theme of themes) {
  for (const w of widths) {
    const ctx = await browser.newContext({ viewport: { width: w, height: Number(process.env.HEIGHT || (w < 768 ? 844 : 912)) } });
    // UISTATE='{"selectedEquipmentId":"srv-r01-02"}' preloads UI selections (persisted ui store).
    const extra = JSON.parse(process.env.UISTATE || '{}');
    await ctx.addInitScript(
      ([t, more]) => {
        try {
          const raw = localStorage.getItem('dct-sim-ui');
          const v = raw ? JSON.parse(raw) : { state: {}, version: 0 };
          v.state = { ...(v.state ?? {}), ...more, theme: t };
          localStorage.setItem('dct-sim-ui', JSON.stringify(v));
        } catch {
          /* ignore */
        }
      },
      [theme, extra],
    );
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    for (const p of pages) {
      await page.goto(base + p, { waitUntil: 'networkidle' });
      await page.waitForTimeout(p === '/datacenter' ? 2500 : 600);
      // SKIP=n advances the sim clock n×30 s first so charts have data.
      for (let i = 0; i < Number(process.env.SKIP ?? 0); i++) await page.getByRole('button', { name: 'Skip 30 seconds' }).click();
      if (process.env.HOVER && p === '/') await page.getByRole('img', { name: /Feed A/ }).hover({ position: { x: 300, y: 60 } }).catch(() => {});
      const name = `${theme}-${w}${p.replace(/\//g, '_') || '_'}.png`;
      await page.screenshot({ path: join(out, name), fullPage: process.env.FULL === '1' });
    }
    if (errors.length) console.log(`[${theme} ${w}] console errors:`, [...new Set(errors)].slice(0, 5));
    await ctx.close();
  }
}
await browser.close();
console.log('done');
