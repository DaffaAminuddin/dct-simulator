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

const nav = (page: Page, label: string) => page.getByRole('complementary', { name: 'Sidebar' }).getByRole('link', { name: new RegExp(`^${label}`) }).click();

test('every section reopens where the learner left it, also after a reload', async ({ page }) => {
  const errors = watchErrors(page);
  await freshSession(page);

  // Work orders: the queue starts with the easiest ticket; the opened ticket is remembered.
  await nav(page, 'Work Orders');
  const queue = page.getByRole('heading', { name: 'Ticket queue' }).locator('xpath=ancestor::section[1]');
  await expect(queue.getByRole('button').first()).toContainText('DCT-0002');
  await queue.getByRole('button', { name: /DCT-0005/ }).click();
  await expect(page.getByRole('heading', { name: 'Work order #DCT-0005' })).toBeVisible();

  // Rack Explorer: rack and unit stay selected.
  await nav(page, 'Rack Explorer');
  await page.getByRole('tab', { name: /R03/ }).click();
  await page.getByRole('button', { name: /dh1-r03-g01, GX-4800/ }).click();
  await expect(page.getByTestId('device-info')).toContainText('10.10.3.11/16');

  // Hardware Lab: the inspected chassis stays.
  await nav(page, 'Hardware Lab');
  await page.getByRole('combobox', { name: 'Equipment to inspect' }).selectOption('srv-r02-s01');

  // Data hall: rack and unit stay selected.
  await nav(page, 'Virtual Data Center');
  await page.getByRole('list', { name: 'Racks' }).getByRole('button', { name: /R05/ }).click();
  await page.getByRole('list', { name: 'Units in R05' }).getByRole('button', { name: /dh1-r05-gb200-ct07/ }).click();
  await expect(page.getByTestId('device-info')).toContainText('dh1-r05-gb200-ct07');

  // Leave and come back to each section.
  await nav(page, 'Dashboard');
  await nav(page, 'Work Orders');
  await expect(page.getByRole('heading', { name: 'Work order #DCT-0005' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Affected device' })).toContainText('dh1-r02-s03');
  await nav(page, 'Hardware Lab');
  await expect(page.getByRole('combobox', { name: 'Equipment to inspect' })).toHaveValue('srv-r02-s01');
  await nav(page, 'Virtual Data Center');
  await expect(page.getByTestId('device-info')).toContainText('dh1-r05-gb200-ct07');

  // A reload keeps the selections too.
  await page.reload();
  await expect(page.getByTestId('device-info')).toContainText('dh1-r05-gb200-ct07');
  await nav(page, 'Work Orders');
  await expect(page.getByRole('heading', { name: 'Work order #DCT-0005' })).toBeVisible();
  // Rack Explorer kept its own rack and unit: choosing R05 in the data hall did not move it.
  await nav(page, 'Rack Explorer');
  await expect(page.getByRole('tab', { name: /R03/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('device-info')).toContainText('10.10.3.11/16');
  expect(errors).toEqual([]);
});
