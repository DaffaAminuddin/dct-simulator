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

async function ssh(page: Page, host: string): Promise<string> {
  await page.getByRole('button', { name: 'Laptop', exact: true }).click();
  const laptop = page.getByRole('dialog', { name: 'Technician laptop' });
  await laptop.getByRole('button', { name: 'Open SSH client' }).click();
  await laptop.getByLabel('SSH host').fill(host);
  await laptop.getByRole('button', { name: 'Connect' }).click();
  const out = (await page.getByTestId('laptop-output').textContent()) ?? '';
  await page.getByRole('button', { name: 'Close laptop' }).click();
  return out;
}

/**
 * Brief, test 1: open the data center, select R01 / S01, disconnect the
 * management cable, SSH from the technician laptop fails, reconnect, SSH works.
 * The laptop is patched with drag-and-drop from the cable tray.
 */
test('management cable vs SSH from the technician laptop', async ({ page }) => {
  const errors = watchErrors(page);
  await freshSession(page);
  await page.getByRole('link', { name: 'Virtual Data Center' }).click();
  await page.getByRole('list', { name: 'Racks' }).getByRole('button', { name: /R01/ }).click();
  await page.getByRole('button', { name: 'Open in Rack Explorer' }).click();
  await page.getByRole('radio', { name: 'Rear (hot aisle)' }).click();
  await page.getByRole('button', { name: /dh1-r01-n01, RS-1100/ }).click();
  await expect(page.getByText('BMC reachable', { exact: true })).toBeVisible();

  // Drag a Cat6 cable from the tray to the laptop, then the free end to an OOB switch port.
  await page.locator('[data-cable-model="cat6-2m"]').dragTo(page.locator('[data-port="laptop-01:eth0"]'));
  await expect(page.getByTestId('cable-in-hand')).toContainText('RJ45 plug free');
  await page.getByTestId('cable-in-hand').dragTo(page.locator('[data-port="oob-r01:ge48"]'));
  await expect(page.getByTestId('cable-in-hand')).toHaveCount(0);

  expect(await ssh(page, '10.10.1.11')).toMatch(/Authenticated to 10\.10\.1\.11/);

  // Disconnect the management cable at the server.
  await page.locator('[data-port="srv-r01-01:bmc"]').click();
  await page.getByRole('button', { name: 'Unplug this end' }).click();
  expect(await ssh(page, '10.10.1.11')).toMatch(/No route to host/);

  // Reconnect it.
  await page.locator('[data-port="srv-r01-01:bmc"]').click();
  await page.getByRole('button', { name: 'Plug in here' }).click();
  expect(await ssh(page, '10.10.1.11')).toMatch(/Authenticated to 10\.10\.1\.11/);
  expect(errors).toEqual([]);
});

test('an incompatible drop is refused by the engine', async ({ page }) => {
  await freshSession(page);
  await page.goto('/racks/R01');
  await page.getByRole('radio', { name: 'Rear (hot aisle)' }).click();
  await page.locator('[data-cable-model="pwr-c13c14-2m"]').dragTo(page.locator('[data-port="laptop-01:eth0"]'));
  await expect(page.getByText(/does not fit this RJ45 port/)).toBeVisible();
});

test('drag a server from inventory onto a free U to mount it', async ({ page }) => {
  const errors = watchErrors(page);
  await freshSession(page);
  await page.goto('/racks/R01');
  await page.locator('[data-inventory-equipment="spare-srv-1u-01"]').dragTo(page.getByRole('button', { name: 'Empty U18' }));
  await expect(page.getByRole('button', { name: /dh1-new-n01, RS-1100/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Empty U18' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
