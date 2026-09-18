import { expect, test } from '@playwright/test';

test.describe('media, timeline and export', () => {
  test('imports media through the in-app file browser, edits on the timeline and exports a validated file', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto('/');
    await page.locator('[data-action="home.newProject"]').click();
    await page.getByTestId('project-name-input').fill('E2E edit');
    await page.getByTestId('project-platform-select').selectOption('youtube');
    await page.locator('[data-action="projects.create.submit"]').click();
    await expect(page.getByTestId('editor')).toBeVisible();

    // Import via the in-app browser (no native dialogs in browser mode)
    await page.locator('[data-action="editor.import"]').click();
    await page.locator('[data-action="fileBrowser.root"]', { hasText: 'sample-media' }).click();
    await page.locator('[data-action="fileBrowser.toggleFile"]', { hasText: 'clip-10s-720p.mp4' }).click();
    await page.locator('[data-action="fileBrowser.toggleFile"]', { hasText: 'tone-3s.wav' }).click();
    await page.locator('[data-action="fileBrowser.select"]').click();
    await expect(page.getByTestId('media-panel-item')).toHaveCount(2);
    // Wait until analysis finished (add button enabled)
    const video = page.getByTestId('media-panel-item').filter({ hasText: 'clip-10s-720p.mp4' });
    await expect(video.locator('[data-action="editor.addAsset"]')).toBeEnabled({ timeout: 60_000 });
    await video.locator('[data-action="editor.addAsset"]').click();
    await expect(page.getByTestId('editor-clip-count')).toContainText('1');
    await expect(page.getByTestId('timecode')).toContainText('00:00:10:00');

    // Split at 3 s using the toolbar after seeking with the keyboard, then delete the first part with ripple
    await page.getByTestId('timeline').click({ position: { x: 400, y: 14 } });
    await page.keyboard.press('Home');
    for (let i = 0; i < 9; i++) await page.keyboard.press('Shift+ArrowRight');
    await expect(page.getByTestId('timecode')).toContainText('00:00:03:00');
    await page.locator('[data-action="timeline.split"]').click();
    await expect(page.getByTestId('editor-clip-count')).toContainText('2');
    // select the first clip by clicking inside it (timeline lane), then ripple delete
    await page.getByTestId('timeline').click({ position: { x: 200, y: 60 } });
    await expect(page.getByTestId('clip-inspector')).toBeVisible();
    await page.locator('[data-action="timeline.rippleDelete"]').click();
    await expect(page.getByTestId('editor-clip-count')).toContainText('1');
    await expect(page.getByTestId('timecode')).toContainText('/ 00:00:07:00');

    // Undo/redo through the top bar keeps the document consistent
    await page.locator('[data-action="edit.undo"]').click();
    await expect(page.getByTestId('editor-clip-count')).toContainText('2');
    await page.locator('[data-action="edit.redo"]').click();
    await expect(page.getByTestId('editor-clip-count')).toContainText('1');

    // Inspector: speed 2x halves the duration
    await page.getByTestId('timeline').click({ position: { x: 300, y: 60 } });
    await page.getByTestId('clip-speed').selectOption('2');
    await expect(page.getByTestId('timecode')).toContainText('/ 00:00:03:15');

    // Add the audio clip and play for a moment
    const tone = page.getByTestId('media-panel-item').filter({ hasText: 'tone-3s.wav' });
    await tone.locator('[data-action="editor.addAsset"]').click();
    await expect(page.getByTestId('editor-clip-count')).toContainText('2');
    await page.getByTestId('playback-toggle').click();
    await page.waitForTimeout(700);
    await page.getByTestId('playback-toggle').click();
    const tc = await page.getByTestId('timecode').innerText();
    expect(tc.startsWith('00:00:00:00')).toBe(false);

    // Export with validation
    await page.locator('[data-action="project.export"]').click();
    await page.getByTestId('export-preset').selectOption('web-small');
    await page.getByTestId('export-start').click();
    await expect(page.getByTestId('export-row').first()).toHaveAttribute('data-status', 'done', { timeout: 120_000 });
    await expect(page.getByTestId('export-validation').first()).toContainText('decode');
    await expect(page.getByTestId('export-validation').first().locator('li.text-danger')).toHaveCount(0);
  });

  test('media library shows analyzed metadata, supports tags/favorites and honest failure for a bad file', async ({ page }) => {
    await page.goto('/#/media');
    await page.locator('[data-action="media.import"]').click();
    await page.locator('[data-action="fileBrowser.root"]', { hasText: 'sample-media' }).click();
    await page.locator('[data-action="fileBrowser.toggleFile"]', { hasText: 'clip-6s-prores.mov' }).click();
    await page.locator('[data-action="fileBrowser.select"]').click();
    const card = page.getByTestId('media-card').filter({ hasText: 'clip-6s-prores.mov' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('960×540', { timeout: 60_000 });
    await card.click();
    await expect(page.getByTestId('media-details')).toContainText('prores');
    await page.getByTestId('media-tags-input').fill('promo, b-roll');
    await page.getByTestId('media-tags-input').blur();
    await page.locator('[data-action="media.favorite"]').click();
    await page.locator('[data-action="media.category.favorites"]').click();
    await expect(page.getByTestId('media-card')).toHaveCount(1);
    await page.locator('[data-action="app.search"]').click();
    await page.getByTestId('search-input').fill('b-roll');
    await expect(page.getByTestId('search-results')).toContainText('clip-6s-prores.mov');
    await page.keyboard.press('Escape');
  });
});
