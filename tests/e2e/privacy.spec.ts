import { expect, test, type Page } from '@playwright/test';

/** Creates a project, imports one fixture through the in-app browser and adds it to the timeline. */
async function projectWithClip(page: Page, name: string, file: string, platform = 'youtube') {
  await page.goto('/');
  await page.locator('[data-action="home.newProject"]').click();
  await page.getByTestId('project-name-input').fill(name);
  await page.getByTestId('project-platform-select').selectOption(platform);
  await page.locator('[data-action="projects.create.submit"]').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.locator('[data-action="editor.import"]').click();
  await page.locator('[data-action="fileBrowser.root"]', { hasText: 'sample-media' }).click();
  await page.locator('[data-action="fileBrowser.toggleFile"]', { hasText: file }).click();
  await page.locator('[data-action="fileBrowser.select"]').click();
  const item = page.getByTestId('media-panel-item').filter({ hasText: file });
  await expect(item.locator('[data-action="editor.addAsset"]')).toBeEnabled({ timeout: 60_000 });
  await item.locator('[data-action="editor.addAsset"]').click();
  await expect(page.getByTestId('editor-clip-count')).toContainText('1');
  // select the clip on the first video lane
  await page.getByTestId('timeline').click({ position: { x: 200, y: 60 } });
  await expect(page.getByTestId('clip-inspector')).toBeVisible();
}

test.describe('phase 3 tools', () => {
  test('detects faces, blurs the largest one with tracking, verifies the blur and exports', async ({ page }) => {
    test.setTimeout(420_000);
    await projectWithClip(page, 'E2E privacy', 'face-pan-4s.mp4');
    await page.getByTestId('tool-tab-privacy').click();
    await expect(page.getByTestId('privacy-panel')).toBeVisible();
    // the capability gate must not be shown when the worker and the YuNet model are available
    await expect(page.getByTestId('privacy-detect')).toBeEnabled({ timeout: 60_000 });
    await page.getByTestId('privacy-detect').click();
    await expect(page.getByTestId('privacy-analysis')).toBeVisible({ timeout: 180_000 });
    await expect(page.getByTestId('privacy-analysis')).not.toContainText(/No faces|لم تُكتشف/);
    await page.locator('[data-action="privacy.selector"]').selectOption('largest');
    await page.getByTestId('privacy-blur').click();
    await expect(page.getByTestId('mask-item')).toHaveCount(1, { timeout: 180_000 });
    await expect(page.getByTestId('mask-item').first()).toContainText(/Tracked|متتبَّع/);
    await page.getByTestId('mask-verify').first().click();
    await expect(page.getByTestId('mask-verification')).toHaveAttribute('data-ok', 'true', { timeout: 180_000 });
    // the preview badge reports an approximation while masks exist
    await expect(page.getByTestId('preview')).toContainText(/approx|تقريب/i);
    // undo removes the verification record, then the mask
    await page.locator('[data-action="edit.undo"]').click();
    await page.locator('[data-action="edit.undo"]').click();
    await expect(page.getByTestId('mask-item')).toHaveCount(0);
    await page.locator('[data-action="edit.redo"]').click();
    await expect(page.getByTestId('mask-item')).toHaveCount(1);
    // export renders the mask into a validated file
    await page.locator('[data-action="project.export"]').click();
    await page.getByTestId('export-preset').selectOption('web-small');
    await page.getByTestId('export-start').click();
    await expect(page.getByTestId('export-row').first()).toHaveAttribute('data-status', 'done', { timeout: 180_000 });
    await expect(page.getByTestId('export-validation').first().locator('li.text-danger')).toHaveCount(0);
  });

  test('draws a region on the preview and tracks it through the clip', async ({ page }) => {
    test.setTimeout(300_000);
    await projectWithClip(page, 'E2E track', 'moving-box-6s.mp4');
    await page.getByTestId('tool-tab-privacy').click();
    await page.getByTestId('privacy-draw').click();
    const canvas = page.getByTestId('preview-canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    // the clip is 640x360 inside a 1920x1080 sequence (contain): the box starts at x=40..120, y=120..200 of 640x360
    const sx = box!.x + box!.width * (40 / 640) - 2;
    const sy = box!.y + box!.height * (120 / 360) - 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * (120 / 640) + 2, box!.y + box!.height * (200 / 360) + 2, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByTestId('privacy-track')).toBeEnabled();
    await page.getByTestId('privacy-track').click();
    await expect(page.getByTestId('mask-item')).toHaveCount(1, { timeout: 180_000 });
    await expect(page.getByTestId('mask-item').first()).toContainText(/Tracked|متتبَّع/);
  });

  test('detects and removes silence from the audio panel with verified duration', async ({ page }) => {
    test.setTimeout(240_000);
    await projectWithClip(page, 'E2E silence', 'tone-with-silence-12s.mp4');
    await expect(page.getByTestId('timecode')).toContainText('/ 00:00:12:00');
    await page.getByTestId('tool-tab-audio').click();
    await page.locator('[data-action="audio.method"]').selectOption('silencedetect');
    await page.getByTestId('audio-detect-silence').click();
    await expect(page.getByTestId('silence-result')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('silence-result').locator('[data-action="audio.seekSilence"]')).toHaveCount(2);
    await page.getByTestId('audio-remove-silence').click();
    await expect(page.getByTestId('task-status-done')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('timecode')).toContainText('/ 00:00:06:');
    await page.getByTestId('audio-measure').click();
    await expect(page.getByTestId('audio-panel')).toContainText('LUFS', { timeout: 60_000 });
  });

  test('reads on-screen text, masks it and manages subtitles', async ({ page }) => {
    test.setTimeout(300_000);
    await projectWithClip(page, 'E2E text', 'text-3s.mp4');
    await page.getByTestId('tool-tab-text').click();
    await expect(page.getByTestId('ocr-detect')).toBeEnabled({ timeout: 60_000 });
    await page.getByTestId('ocr-detect').click();
    await expect(page.getByTestId('ocr-tracks')).toBeVisible({ timeout: 180_000 });
    await expect(page.getByTestId('ocr-text')).toContainText('OPEN');
    await page.getByTestId('ocr-blur-all').click();
    await page.getByTestId('tool-tab-privacy').click();
    await expect(page.getByTestId('mask-item').first()).toBeVisible();
    // subtitles: add a track and a cue, then export it
    await page.getByTestId('tool-tab-subtitles').click();
    await page.locator('[data-action="subtitles.addTrack"]').click();
    await expect(page.getByTestId('subtitle-track')).toHaveCount(1);
    await page.getByTestId('subtitles-add-cue').click();
    await expect(page.getByTestId('cue-row')).toHaveCount(1);
    await page.getByTestId('subtitles-export').click();
    await expect(page.getByTestId('toast-success').filter({ hasText: '.srt' })).toBeVisible({ timeout: 30_000 });
    // no speech model here: the transcribe control is gated with an honest reason
    await expect(page.getByTestId('subtitles-panel')).toContainText(/Model required|يتطلب نموذجاً|Runtime required/);
  });

  test('models screen lists the registry, runtime status and runs a real model test', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto('/#/models');
    await expect(page.getByTestId('runtime-card')).toBeVisible();
    await expect(page.getByTestId('model-card')).not.toHaveCount(0);
    const yunet = page.locator('[data-model-id="opencv/yunet-2023mar"]');
    await expect(yunet).toHaveAttribute('data-status', 'installed', { timeout: 30_000 });
    await yunet.getByTestId('model-test').click();
    await expect(yunet.getByTestId('model-last-test')).toContainText(/face/, { timeout: 180_000 });
    const wan = page.locator('[data-model-id="wan/2.1-t2v-1.3b"]');
    await expect(wan).toContainText(/GPU|معالج/);
  });
});
