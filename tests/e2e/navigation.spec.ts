import { expect, test } from '@playwright/test';

test.describe('application shell', () => {
  test('boots, navigates every section, switches language/RTL and theme', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('main-content')).toBeVisible();
    await expect(page.getByTestId('status-bridge')).toContainText(/Browser mode|وضع المتصفح/);
    const sections = ['editor', 'creator', 'projects', 'media', 'models', 'templates', 'export', 'settings', 'system', 'diagnostics', 'home'];
    for (const s of sections) {
      await page.locator(`[data-action="nav.${s}"]`).click();
      await expect(page.locator(`[data-action="nav.${s}"]`)).toHaveAttribute('aria-current', 'page');
    }
    await page.locator('[data-action="nav.settings"]').click();
    await page.locator('[data-action="tab.language"]').click();
    await page.getByTestId('settings-language-select').selectOption('ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('[data-action="nav.home"]')).toContainText('الرئيسية');
    await page.locator('[data-action="tab.appearance"]').click();
    await page.getByTestId('settings-theme-select').selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByTestId('settings-theme-select').selectOption('dark');
    await page.locator('[data-action="tab.language"]').click();
    await page.getByTestId('settings-language-select').selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  test('creates a project, edits it with undo/redo, saves versions and searches it', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-action="home.newProject"]').click();
    await page.getByTestId('project-name-input').fill('إعلان غسيل السيارات');
    await page.getByTestId('project-platform-select').selectOption('tiktok');
    await page.locator('[data-action="projects.create.submit"]').click();
    await expect(page).toHaveURL(/#\/editor\//);
    await expect(page.getByTestId('topbar-project-name')).toHaveText('إعلان غسيل السيارات');
    await expect(page.getByTestId('editor-resolution')).toContainText('1080×1920');
    await expect(page.locator('[data-action="nav.editor"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-action="nav.home"]')).not.toHaveAttribute('aria-current', 'page');
    await page.locator('[data-action="tasks.open"]').click();
    await expect(page.getByTestId('tasks-panel')).toBeVisible();
    await page.locator('[data-action="app.assistant"]').click();
    await expect(page.getByTestId('assistant-panel')).toBeVisible();
    await page.locator('[data-action="tasks.close"]').click();
    await page.locator('[data-action="assistant.close"]').click();
    await page.locator('[data-action="editor.addTrack.video"]').click();
    await expect(page.getByTestId('timeline-track-header')).toHaveCount(4);
    await page.locator('[data-action="edit.undo"]').click();
    await expect(page.getByTestId('timeline-track-header')).toHaveCount(3);
    await page.locator('[data-action="edit.redo"]').click();
    await expect(page.getByTestId('timeline-track-header')).toHaveCount(4);
    await page.locator('[data-action="project.save"]').click();
    await expect(page.locator('header')).toContainText(/Saved|محفوظ/);
    await page.locator('[data-action="editor.validate"]').click();
    await expect(page.getByTestId('editor-validation')).toBeVisible();
    await page.locator('[data-action="app.search"]').click();
    await page.getByTestId('search-input').fill('غسيل');
    await expect(page.getByTestId('search-results')).toContainText('إعلان غسيل السيارات');
    await page.keyboard.press('Escape');
    await page.locator('[data-action="nav.projects"]').click();
    // other specs create projects in the same user-data directory: assert on this test's project only
    const row = page.getByTestId('project-row').filter({ hasText: 'إعلان غسيل السيارات' });
    await expect(row).toHaveCount(1);
    await row.locator('[data-action="projects.menu"]').click();
    await page.locator('[data-action="projects.menu.versions"]').click();
    await expect(page.getByTestId('versions-list').locator('li')).toHaveCount(2);
  });

  test('templates create projects with their settings and the diagnostics bundle exports', async ({ page }) => {
    await page.goto('/#/templates');
    await expect(page.getByTestId('template-card').first()).toBeVisible();
    await page.locator('[data-action="templates.use"][data-template="tpl-shorts"]').click();
    await page.getByTestId('project-name-input').fill('Shorts from template');
    await page.locator('[data-action="projects.create.submit"]').click();
    await expect(page.getByTestId('editor-resolution')).toContainText('1080×1920');
    await page.locator('[data-action="nav.diagnostics"]').click();
    await page.locator('[data-action="diagnostics.exportBundle"]').click();
    await expect(page.getByTestId('diagnostics-bundle-path')).toContainText('.zip');
    await page.locator('[data-action="tab.errors"]').click();
    await page.locator('[data-action="tab.tasks"]').click();
    await page.locator('[data-action="tab.network"]').click();
  });
});
