import { expect, type Page, test } from '@playwright/test';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

async function freshSession(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  await page.goto('/');
}

type Dct = {
  engine: { dispatch: (a: unknown) => { ok: boolean; message?: string }; getState: () => { cables: Record<string, { id: string; modelId: string; ends: { portId: string | null }[] }>; equipment: Record<string, { slots: Record<string, string | null> }> } };
  store: { getState: () => { skip: (ms: number) => void } };
  terminal: { getState: () => { chunks: { text: string }[] } };
};

/** Patch the laptop's eth0 into the R01 OOB switch (the Phase 2 suite covers doing this by drag-and-drop). */
async function patchLaptop(page: Page) {
  await page.evaluate(() => {
    const { engine } = (window as unknown as { __dct: Dct }).__dct;
    const c = Object.values(engine.getState().cables).find((x) => x.modelId === 'cat6-2m' && !x.ends[0].portId && !x.ends[1].portId);
    if (!c) throw new Error('no spare cable');
    engine.dispatch({ type: 'cable/connect', cableId: c.id, end: 0, portId: 'laptop-01:eth0' });
    engine.dispatch({ type: 'cable/connect', cableId: c.id, end: 1, portId: 'oob-r01:ge48' });
  });
}

/** Full terminal transcript (ANSI stripped). */
async function transcript(page: Page): Promise<string> {
  return page.evaluate(() =>
    (window as unknown as { __dct: Dct }).__dct.terminal
      .getState()
      .chunks.map((c) => c.text)
      .join('')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/\r/g, ''),
  );
}

/** Type a command into the focused xterm and wait until its output is in the transcript. */
async function run(page: Page, cmd: string): Promise<string> {
  const before = (await transcript(page)).length;
  await page.keyboard.type(cmd);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await transcript(page)).length).toBeGreaterThan(before);
  return (await transcript(page)).slice(before);
}

async function engineDo(page: Page, actions: unknown[]) {
  const results = await page.evaluate((list) => list.map((a) => (window as unknown as { __dct: Dct }).__dct.engine.dispatch(a)), actions);
  for (const r of results) expect(r.ok, r.message).toBe(true);
}

/**
 * Brief, test 2: GPU detection failure on a GPU server → terminal shows the
 * missing GPU (nvidia-smi, lspci, kernel log) → repair → GPUs back.
 */
test('a GPU that falls off the bus is diagnosed from the terminal and recovers after replacement', async ({ page }) => {
  const errors = watchErrors(page);
  await freshSession(page);
  await patchLaptop(page);
  const gpu0 = await page.evaluate(() => (window as unknown as { __dct: Dct }).__dct.engine.getState().equipment['srv-r03-g01'].slots.gpu0 as string);
  await engineDo(page, [{ type: 'fault/inject', faultType: 'gpu_fallen_off_bus', targetId: gpu0, hidden: true, source: 'scenario' }]);

  await page.getByRole('link', { name: /^Terminal/ }).click();
  await page.getByTestId('terminal').click();

  expect(await run(page, 'ssh admin@dh1-r03-g01-bmc')).toMatch(/BMC CLI \(reference\)/);
  expect(await run(page, 'sol activate')).toMatch(/dh1-r03-g01 login: dct/);
  await expect(page.getByRole('list', { name: 'Terminal session' })).toContainText('dct@dh1-r03-g01');

  expect(await run(page, 'nvidia-smi | head -3')).toMatch(/Unable to determine the device handle for GPU00000000:18:00\.0: Unknown Error/);
  expect(await run(page, 'nvidia-smi -L | wc -l')).toMatch(/^.*\n8\n/);
  expect(await run(page, 'lspci | grep -i nvidia')).toMatch(/18:00\.0 3D controller: .*\(rev ff\)/);
  expect(await run(page, 'sudo dmesg | grep -i xid')).toMatch(/NVRM: Xid \(PCI:0000:18:00\): 79/);
  // The visible terminal shows the same thing as the transcript.
  await expect(page.locator('.xterm-rows')).toContainText('Xid (PCI:0000:18:00): 79');

  // Repair: leave the OS, power off from the BMC, swap the GPU, power on.
  expect(await run(page, 'exit')).toMatch(/SOL session closed/);
  expect(await run(page, 'power off')).toMatch(/Chassis Power Control: Down\/Off/);
  await engineDo(page, [
    { type: 'equipment/setChassisOpen', equipmentId: 'srv-r03-g01', open: true },
    { type: 'component/remove', componentId: gpu0 },
    { type: 'component/install', componentId: 'spare-gpu-sxm-01', equipmentId: 'srv-r03-g01', slotId: 'gpu0' },
    { type: 'equipment/setChassisOpen', equipmentId: 'srv-r03-g01', open: false },
  ]);
  expect(await run(page, 'power on')).toMatch(/Chassis Power Control: Up\/On/);
  expect(await run(page, 'sol activate')).toMatch(/no login prompt yet/);
  await page.evaluate(() => (window as unknown as { __dct: Dct }).__dct.store.getState().skip(60_000));

  expect(await run(page, 'sol activate')).toMatch(/login: dct/);
  const smi = await run(page, 'nvidia-smi -L');
  expect(smi.match(/^GPU \d: /gm)).toHaveLength(8);
  expect(smi).not.toMatch(/Unable to determine/);
  expect(await run(page, 'lspci | grep -c "rev ff"')).toMatch(/\n0\n/);
  expect(errors).toEqual([]);
});

test('terminal basics: SSH needs the cable, completion, history, Ctrl+C and the laptop app share one session', async ({ page }) => {
  const errors = watchErrors(page);
  await freshSession(page);
  await page.goto('/terminal');
  await page.getByTestId('terminal').click();

  // No cable yet: the laptop has no network.
  expect(await run(page, 'ssh admin@dh1-r01-n01-bmc')).toMatch(/Network is unreachable|Temporary failure in name resolution/);
  await patchLaptop(page);
  expect(await run(page, 'ip -br a')).toMatch(/eth0\s+UP\s+10\.10\.250\.100\/16/);

  // Tab completion of a command name.
  await page.keyboard.type('hostn');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect.poll(() => transcript(page)).toMatch(/\$ hostname ?\ntech-laptop\n/);

  // History recall with the up arrow.
  const before = (await transcript(page)).length;
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await transcript(page)).slice(before)).toMatch(/hostname\ntech-laptop/);

  // Ctrl+C abandons the typed line: nothing runs.
  const beforeC = (await transcript(page)).length;
  await page.keyboard.type('sudo reboot');
  await page.keyboard.press('Control+c');
  await expect(page.locator('.xterm-rows')).toContainText('sudo reboot^C');
  expect((await transcript(page)).length).toBe(beforeC);

  // SSH, then the laptop's Terminal app shows the same session.
  expect(await run(page, 'ssh admin@dh1-r01-n01-bmc')).toMatch(/BMC CLI/);
  await page.getByRole('button', { name: 'Laptop', exact: true }).click();
  const laptop = page.getByRole('dialog', { name: 'Technician laptop' });
  await laptop.getByRole('button', { name: 'Open Terminal' }).click();
  await expect(laptop.getByRole('list', { name: 'Terminal session' })).toContainText('admin@dh1-r01-n01-bmc');

  // Pulling the management cable drops the session on the next state change.
  await page.getByRole('button', { name: 'Close laptop' }).click();
  await page.evaluate(() => {
    const { engine } = (window as unknown as { __dct: Dct }).__dct;
    const c = Object.values(engine.getState().cables).find((x) => x.ends.some((e) => e.portId === 'srv-r01-01:bmc'));
    if (!c) throw new Error('no BMC cable');
    engine.dispatch({ type: 'cable/disconnect', cableId: c.id, end: c.ends[0].portId === 'srv-r01-01:bmc' ? 0 : 1 });
  });
  await expect.poll(() => transcript(page)).toMatch(/Connection to .* closed by remote host|Broken pipe/);
  await expect(page.getByRole('list', { name: 'Terminal session' })).not.toContainText('bmc');
  expect(errors).toEqual([]);
});
