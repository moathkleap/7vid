import type { SqlDriver } from './driver';

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'init',
    sql: `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('editor','creator')),
  settings_json TEXT NOT NULL,
  data_dir TEXT NOT NULL,
  current_version_id TEXT,
  thumbnail_path TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_opened_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);

CREATE TABLE IF NOT EXISTS project_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  label TEXT,
  reason TEXT NOT NULL,
  document_json TEXT NOT NULL,
  hash TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_versions_project ON project_versions(project_id, seq DESC);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  source_path TEXT NOT NULL,
  fingerprint TEXT,
  mime TEXT,
  container TEXT,
  duration_ms INTEGER,
  width INTEGER,
  height INTEGER,
  fps_num INTEGER,
  fps_den INTEGER,
  video_codec TEXT,
  audio_codec TEXT,
  channels INTEGER,
  sample_rate INTEGER,
  bitrate INTEGER,
  size_bytes INTEGER,
  streams_json TEXT,
  thumbnail_path TEXT,
  sprite_path TEXT,
  waveform_path TEXT,
  proxy_path TEXT,
  proxy_status TEXT NOT NULL DEFAULT 'none',
  analysis_status TEXT NOT NULL DEFAULT 'pending',
  analysis_error_json TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  favorite INTEGER NOT NULL DEFAULT 0,
  missing INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL DEFAULT 'import',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind);
CREATE INDEX IF NOT EXISTS idx_assets_path ON assets(source_path);

CREATE TABLE IF NOT EXISTS transcripts (
  id TEXT PRIMARY KEY,
  asset_id TEXT REFERENCES assets(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT,
  segments_json TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  interpretation_json TEXT,
  plan_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages(conversation_id, created_at);
CREATE TABLE IF NOT EXISTS ai_plans (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  message_id TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  operations_json TEXT NOT NULL,
  status TEXT NOT NULL,
  requires_confirmation INTEGER NOT NULL DEFAULT 1,
  summary_ar TEXT,
  summary_en TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_operations (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES ai_plans(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  params_json TEXT NOT NULL,
  input_json TEXT,
  output_json TEXT,
  status TEXT NOT NULL,
  validation_json TEXT,
  error_json TEXT,
  provider_id TEXT,
  model_id TEXT,
  task_id TEXT,
  version_before TEXT,
  version_after TEXT,
  started_at TEXT,
  finished_at TEXT,
  duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ai_operations_plan ON ai_operations(plan_id, seq);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  bible_json TEXT NOT NULL,
  reference_images_json TEXT NOT NULL DEFAULT '[]',
  embedding_blob BLOB,
  generation_params_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scripts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  brief_json TEXT NOT NULL,
  script_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL,
  scene_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  storyboard_path TEXT,
  generated_asset_id TEXT,
  consistency_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scenes_project ON scenes(project_id, order_index);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  registry_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  capability TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  version TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  vram_mb INTEGER,
  ram_mb INTEGER,
  files_json TEXT NOT NULL,
  install_path TEXT,
  status TEXT NOT NULL DEFAULT 'available',
  checksum_ok INTEGER,
  license TEXT,
  installed_at TEXT,
  last_tested_at TEXT,
  last_test_json TEXT,
  error_json TEXT
);

CREATE TABLE IF NOT EXISTS providers_config (
  provider_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  project_id TEXT,
  parent_task_id TEXT,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  progress REAL NOT NULL DEFAULT 0,
  progress_message TEXT,
  eta_ms INTEGER,
  params_json TEXT NOT NULL,
  result_json TEXT,
  error_json TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  cancellable INTEGER NOT NULL DEFAULT 1,
  pausable INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  task_id TEXT,
  preset_id TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  output_path TEXT NOT NULL,
  status TEXT NOT NULL,
  validation_json TEXT,
  size_bytes INTEGER,
  duration_ms INTEGER,
  error_json TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_exports_created ON exports(created_at DESC);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0,
  template_json TEXT NOT NULL,
  thumbnail_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS network_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  provider_id TEXT,
  host TEXT NOT NULL,
  purpose TEXT NOT NULL,
  bytes_out INTEGER NOT NULL DEFAULT 0,
  bytes_in INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS global_fts USING fts5(
  entity_type UNINDEXED,
  entity_id UNINDEXED,
  project_id UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
`,
  },
];

export function migrate(driver: SqlDriver): { from: number; to: number } {
  const row = driver.prepare('PRAGMA user_version').get<{ user_version: number }>();
  const from = Number(row?.user_version ?? 0);
  let version = from;
  for (const m of MIGRATIONS) {
    if (m.id <= version) continue;
    driver.transaction(() => {
      driver.exec(m.sql);
      driver.exec(`PRAGMA user_version = ${m.id}`);
    });
    version = m.id;
  }
  return { from, to: version };
}
