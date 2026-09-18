import fs from 'node:fs';
import path from 'node:path';
import type { ApiHandlers } from '@sevenvid/ipc';
import type { AppSettings, DeepPartial } from '@sevenvid/core';
import type { EngineServices } from './createEngine';
import { ZipWriter } from '../diagnostics/zip';
import { isExternalUrlAllowed } from './host';

/** Builds the phase-1 API handlers on top of the engine services. Later phases extend this object. */
export function createCoreHandlers(s: EngineServices): Pick<ApiHandlers, CoreChannel> {
  return {
    'app.info': () => ({
      name: '7vid',
      version: s.host.appVersion,
      platform: process.platform,
      arch: process.arch,
      electron: s.host.electronVersion,
      node: process.versions.node,
      mode: s.host.mode,
      paths: { userData: s.paths.userData, projects: s.paths.projects, cache: s.paths.cache, logs: s.paths.logs, models: s.paths.models, exports: s.paths.exports, resources: s.paths.resources },
      isDev: s.host.isDev,
    }),
    'app.ping': () => ({ pong: true as const, at: new Date().toISOString() }),
    'settings.get': () => s.settings.get(),
    'settings.update': ({ patch }) => s.settings.update(patch as DeepPartial<AppSettings>),
    'settings.reset': ({ section }) => s.settings.reset((section as keyof AppSettings | null) ?? null),
    'hardware.snapshot': (input) => s.hardware.snapshot(Boolean(input?.refresh)),
    'capabilities.get': () => s.capabilities.get(),
    'capabilities.refresh': () => s.capabilities.refresh(),
    'projects.list': (input) => s.projects.list(Boolean(input?.includeDeleted)),
    'projects.recent': (input) => s.projects.recent(input?.limit ?? 8),
    'projects.create': (input) => s.projects.create(input).summary,
    'projects.get': ({ projectId }) => s.projects.summary(projectId),
    'projects.open': ({ projectId }) => s.sessions.open(projectId),
    'projects.close': ({ projectId }) => ({ closed: s.sessions.close(projectId) }),
    'projects.rename': ({ projectId, name }) => {
      const summary = s.projects.rename(projectId, name);
      if (s.sessions.isOpen(projectId)) s.sessions.get(projectId).execute({ type: 'project.rename', name }, 'external');
      return summary;
    },
    'projects.duplicate': ({ projectId, name }) => s.projects.duplicate(projectId, name).summary,
    'projects.delete': ({ projectId, permanent }) => {
      s.sessions.close(projectId);
      if (permanent) s.projects.deletePermanently(projectId);
      else s.projects.softDelete(projectId);
      return { deleted: true };
    },
    'projects.restoreDeleted': ({ projectId }) => s.projects.restoreDeleted(projectId),
    'projects.versions.list': ({ projectId }) => s.projects.listVersions(projectId),
    'projects.versions.create': ({ projectId, label }) => {
      s.sessions.get(projectId).save('manual', label);
      return s.projects.listVersions(projectId)[0]!;
    },
    'projects.versions.restore': ({ projectId, versionId }) => s.sessions.restoreVersion(projectId, versionId),
    'projects.recovery.check': () => s.sessions.checkRecovery(false),
    'projects.recovery.apply': ({ projectId, discard }) => s.sessions.applyRecovery(projectId, Boolean(discard)),
    'session.state': ({ projectId }) => s.sessions.get(projectId).state(),
    'session.command': ({ projectId, command }) => s.sessions.get(projectId).execute(command),
    'session.undo': ({ projectId }) => s.sessions.get(projectId).undo(),
    'session.redo': ({ projectId }) => s.sessions.get(projectId).redo(),
    'session.save': ({ projectId, label }) => s.sessions.get(projectId).save('manual', label ?? null),
    'session.validate': ({ projectId }) => s.sessions.get(projectId).validate() as never,
    'tasks.list': (input) => s.tasks.list({ projectId: input?.projectId ?? undefined, includeFinished: input?.includeFinished, limit: input?.limit }),
    'tasks.get': ({ taskId }) => s.tasks.get(taskId) ?? null,
    'tasks.cancel': ({ taskId }) => s.tasks.cancel(taskId),
    'tasks.pause': ({ taskId }) => s.tasks.pause(taskId),
    'tasks.resume': ({ taskId }) => s.tasks.resume(taskId),
    'tasks.retry': ({ taskId }) => s.tasks.retry(taskId),
    'tasks.setPriority': ({ taskId, priority }) => s.tasks.setPriority(taskId, priority),
    'tasks.clearFinished': () => ({ removed: s.tasks.clearFinished() }),
    'search.query': ({ q, types, limit }) => s.search.query(q, { types, limit }),
    'logs.tail': (input) => s.logs.tail({ limit: input?.limit, level: input?.level, module: input?.module, errorId: input?.errorId }),
    'diagnostics.exportBundle': async (input) => {
      const zip = new ZipWriter();
      const hardware = await s.hardware.snapshot(true);
      zip.addFile('system.json', JSON.stringify({ app: { version: s.host.appVersion, mode: s.host.mode, node: process.versions.node, electron: s.host.electronVersion }, hardware }, null, 2));
      const settings = s.settings.get();
      zip.addFile('settings.json', JSON.stringify(settings, null, 2));
      zip.addFile('capabilities.json', JSON.stringify(s.capabilities.get(), null, 2));
      zip.addFile('tasks.json', JSON.stringify(s.tasks.list({ includeFinished: true, limit: 500 }), null, 2));
      zip.addFile('errors.json', JSON.stringify(s.errors.recent(200), null, 2));
      zip.addFile('network-log.json', JSON.stringify(s.db.networkLog.recent(500), null, 2));
      for (const f of fs.readdirSync(s.paths.logs)) {
        if (f.startsWith('sevenvid.log')) zip.addFile(`logs/${f}`, fs.readFileSync(path.join(s.paths.logs, f)));
      }
      const dir = input?.targetDir ?? s.paths.exports;
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `7vid-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`);
      const buf = zip.toBuffer();
      fs.writeFileSync(file, buf);
      return { path: file, sizeBytes: buf.length };
    },
    'errors.recent': (input) => s.errors.recent(input?.limit ?? 50),
    'notifications.recent': (input) => s.notifications.recent(input?.limit ?? 50),
    'fs.listDir': ({ path: dir, mediaOnly }) => s.fs.listDir(dir, Boolean(mediaOnly)),
    'fs.roots': () => s.fs.roots(),
    'fs.exists': ({ path: p }) => s.fs.exists(p),
    'dialog.pickFiles': (input) => s.host.dialogs.pickFiles(input),
    'dialog.pickDirectory': (input) => s.host.dialogs.pickDirectory(input),
    'dialog.saveFile': (input) => s.host.dialogs.saveFile(input),
    'shell.openPath': async ({ path: p }) => {
      if (!fs.existsSync(p)) return { ok: false, error: 'not-found' };
      const error = await s.host.shell.openPath(p);
      return { ok: !error, error: error || null };
    },
    'shell.showInFolder': ({ path: p }) => {
      if (!fs.existsSync(p)) return { ok: false };
      s.host.shell.showInFolder(p);
      return { ok: true };
    },
    'shell.openExternal': async ({ url }) => {
      if (!isExternalUrlAllowed(url)) {
        s.logger.warn({ module: 'privacy', operation: 'openExternal', url }, 'blocked external url');
        return { ok: false, blocked: true };
      }
      await s.host.shell.openExternal(url);
      return { ok: true, blocked: false };
    },
    'app.quit': () => {
      setTimeout(() => s.host.quit(), 50);
      return { ok: true };
    },
    'templates.list': () => s.templates.list(),
    'templates.delete': ({ templateId }) => ({ deleted: s.templates.delete(templateId) }),
    'templates.saveFromProject': ({ projectId, name, category }) => s.templates.saveFromProject(projectId, name, category),
    'exports.list': (input) => s.db.exports.list({ projectId: input?.projectId, limit: input?.limit }),
    'network.recent': (input) => s.db.networkLog.recent(input?.limit ?? 200),
    'media.import': ({ paths, projectId }) => s.media.import(paths, projectId),
    'media.list': (input) => s.media.list({ projectId: input?.projectId, includeLibrary: input?.includeLibrary, kind: input?.kind, favorite: input?.favorite, query: input?.query }),
    'media.get': ({ assetId }) => s.media.get(assetId),
    'media.update': ({ assetId, patch }) => s.media.update(assetId, patch),
    'media.remove': ({ assetId, deleteCache }) => ({ removed: s.media.remove(assetId, deleteCache ?? true) }),
    'media.relink': ({ assetId, path: p }) => s.media.relink(assetId, p),
    'media.reanalyze': ({ assetId }) => s.media.reanalyze(assetId),
    'media.waveform': ({ assetId }) => s.media.waveform(assetId),
    'media.url': ({ path: p }) => ({ url: s.media.isPathAllowed(p) ? s.host.mediaUrl(p) : null }),
    'media.setPlaybackCapabilities': (caps) => {
      s.media.setPlaybackCapabilities(caps);
      return { ok: true };
    },
    'media.addToTimeline': ({ projectId, assetId, trackId, atMs, mode, durationMs }) => s.media.addToTimeline(projectId, assetId, { trackId, atMs, mode, durationMs }),
    'export.start': ({ projectId, settings, outputPath, fileName }) => s.exports.start({ projectId, settings: settings as never, outputPath, fileName }),
    'export.get': ({ exportId }) => s.exports.get(exportId) ?? null,
    'export.encoders': (input) => ({ available: s.ffmpeg.encoders.filter((e) => /^(lib(x264|x265|vpx-vp9|svtav1|aom-av1))$|_(nvenc|qsv|amf|videotoolbox|vaapi)$/.test(e)), hardware: s.ffmpeg.hwEncoders, verified: input?.verify ? s.exports.encoderProbe.verifyAllHardware() : s.exports.encoderProbe.results() }),
    'render.previewRange': ({ projectId, startMs, endMs }) => s.previews.renderRange(projectId, startMs, endMs),
    'render.extractFrame': ({ projectId, tMs }) => s.previews.extractFrameTask(projectId, tMs),
  };
}

export type CoreChannel =
  | 'app.info' | 'app.ping' | 'settings.get' | 'settings.update' | 'settings.reset' | 'hardware.snapshot' | 'capabilities.get' | 'capabilities.refresh'
  | 'projects.list' | 'projects.recent' | 'projects.create' | 'projects.get' | 'projects.open' | 'projects.close' | 'projects.rename' | 'projects.duplicate' | 'projects.delete' | 'projects.restoreDeleted'
  | 'projects.versions.list' | 'projects.versions.create' | 'projects.versions.restore' | 'projects.recovery.check' | 'projects.recovery.apply'
  | 'session.state' | 'session.command' | 'session.undo' | 'session.redo' | 'session.save' | 'session.validate'
  | 'tasks.list' | 'tasks.get' | 'tasks.cancel' | 'tasks.pause' | 'tasks.resume' | 'tasks.retry' | 'tasks.setPriority' | 'tasks.clearFinished'
  | 'search.query' | 'logs.tail' | 'diagnostics.exportBundle' | 'errors.recent' | 'notifications.recent'
  | 'fs.listDir' | 'fs.roots' | 'fs.exists' | 'dialog.pickFiles' | 'dialog.pickDirectory' | 'dialog.saveFile'
  | 'shell.openPath' | 'shell.showInFolder' | 'shell.openExternal' | 'app.quit'
  | 'templates.list' | 'templates.delete' | 'templates.saveFromProject' | 'exports.list' | 'network.recent'
  | 'media.import' | 'media.list' | 'media.get' | 'media.update' | 'media.remove' | 'media.relink' | 'media.reanalyze' | 'media.waveform' | 'media.url' | 'media.setPlaybackCapabilities' | 'media.addToTimeline'
  | 'export.start' | 'export.get' | 'export.encoders' | 'render.previewRange' | 'render.extractFrame';
