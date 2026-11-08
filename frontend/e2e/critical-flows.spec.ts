import { expect, type Page, test } from '@playwright/test';

/** Fail the test on any uncaught page error. */
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

test('every sidebar section renders without errors', async ({ page }) => {
  const errors = watchErrors(page);
  await freshSession(page);
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  for (const label of ['Dashboard', 'Virtual Data Center', 'Rack Explorer', 'Hardware Lab', 'Network Lab', 'GPU Diagnostics', 'Cooling & Power', 'Terminal', 'Work Orders', 'Learning Center', 'Inventory', 'Progress & Achievements', 'Settings']) {
    await nav.getByRole('link', { name: label }).click();
    await expect(page.getByRole('heading', { level: 1, name: label })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

/**
 * Brief, test 1 (Phase 1 form): the technician laptop and SSH arrive in
 * Phases 2–3, so remote BMC reachability is the observable that must follow
 * the physical management cable.
 */
test('disconnecting the management cable makes the BMC unreachable; reconnecting restores it', async ({ page }) => {
  const errors = watchErrors(page);
  await freshSession(page);
  await page.getByRole('link', { name: 'Virtual Data Center' }).click();
  await page.getByRole('list', { name: 'Racks' }).getByRole('button', { name: /R01/ }).click();
  await page.getByRole('button', { name: 'Open in Rack Explorer' }).click();
  await expect(page).toHaveURL(/\/racks\/R01/);

  await page.getByRole('button', { name: /dh1-r01-n01, RS-1100/ }).click();
  await expect(page.getByText('BMC reachable', { exact: true })).toBeVisible();

  await page.getByRole('radio', { name: 'Rear (hot aisle)' }).click();
  await page.locator('[data-port="srv-r01-01:bmc"]').click();
  await page.getByRole('button', { name: 'Unplug this end' }).click();
  await expect(page.getByText('BMC unreachable', { exact: true })).toBeVisible();
  await expect(page.getByText(/Management port disconnected/).first()).toBeVisible();

  // The cable is now in hand: plug it back into the same port.
  await page.getByRole('button', { name: 'Plug in here' }).click();
  await expect(page.getByText('BMC reachable', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

/** Brief, test 2 (Phase 1 form): an injected GPU detection failure is visible only from the driver side. */
test('a GPU-off-the-bus work order shows a missing GPU in the driver view while the BMC looks healthy', async ({ page }) => {
  const errors = watchErrors(page);
  await freshSession(page);
  await page.goto('/workorders/DCT-0001');
  await page.getByRole('button', { name: /Accept & start/ }).click();
  await expect(page.getByText('In progress').first()).toBeVisible();

  await page.getByRole('link', { name: 'GPU Diagnostics' }).click();
  await page.getByRole('combobox', { name: 'GPU node' }).selectOption('ct-r05-07');
  await expect(page.getByText('Driver reports 3 of 4 GPUs')).toBeVisible();

  // The BMC view of the tray still reports healthy: the root cause is hidden from it.
  await page.goto('/racks/R05');
  await page.getByRole('button', { name: /dh1-r05-gb200-ct07, GB200 tray/ }).click();
  await expect(page.getByText('Health: OK')).toBeVisible();
  await expect(page.getByText('Degraded').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('simulation state survives a page reload in the same tab', async ({ page }) => {
  await freshSession(page);
  await page.goto('/racks/R01');
  await page.getByRole('button', { name: /dh1-r01-n05, RS-1100/ }).click();
  await page.getByRole('button', { name: /^Power off$/ }).click();
  await expect(page.getByText('Standby').first()).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /dh1-r01-n05, RS-1100/ }).click();
  await expect(page.getByText('Standby').first()).toBeVisible();
});
