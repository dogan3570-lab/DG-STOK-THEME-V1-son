import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
const FILE_NAME = 'learning-state.json';

/**
 * Persistans dosya yolu.
 * Test/izolasyon için DG_LEARNING_STATE_FILE env ile override edilebilir.
 */
function resolveFilePath(): string {
  const override = process.env.DG_LEARNING_STATE_FILE;
  if (override && override.trim()) return override;
  return path.join(DEFAULT_DATA_DIR, FILE_NAME);
}

/** Geri canlandırılacak (revive) tarih alanları */
const DATE_KEYS = new Set(['timestamp', 'firstSeen', 'lastSeen', 'lastSaved']);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/;

function dateReviver(key: string, value: unknown): unknown {
  if (typeof value === 'string' && DATE_KEYS.has(key) && ISO_DATE_RE.test(value)) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d;
  }
  return value;
}

export interface PersistedLearningState {
  observations: any[];
  deviations: any[];
  insights: [string, any][];
  alerts: any[];
  lastSaved: string;
  version: number;
}

function ensureDirFor(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function isPersistedShape(parsed: any): boolean {
  return (
    parsed &&
    typeof parsed === 'object' &&
    parsed.version === 1 &&
    Array.isArray(parsed.observations) &&
    Array.isArray(parsed.deviations) &&
    Array.isArray(parsed.insights) &&
    Array.isArray(parsed.alerts)
  );
}

/**
 * Atomik yazma: önce temp dosyaya yaz, sonra rename ile üzerine taşı.
 * Böylece yazma sırasında process çökerse mevcut sağlam dosya bozulmaz.
 */
export function saveLearningState(state: PersistedLearningState): boolean {
  const filePath = resolveFilePath();
  const tmpPath = filePath + '.tmp';
  try {
    ensureDirFor(filePath);
    const payload: PersistedLearningState = {
      observations: state.observations || [],
      deviations: state.deviations || [],
      insights: state.insights || [],
      alerts: state.alerts || [],
      lastSaved: new Date().toISOString(),
      version: 1,
    };
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch (err) {
    console.error('[learning-persistence] save failed:', err);
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    return false;
  }
}

/**
 * Yükleme: bozuk JSON'da uygulama ÇÖKMEZ.
 * Bozuk dosya quarantine edilir (.corrupt-<ts>) ve null döner.
 */
export function loadLearningState(): PersistedLearningState | null {
  const filePath = resolveFilePath();
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw, dateReviver);
    if (!isPersistedShape(parsed)) {
      quarantine(filePath, 'invalid-shape');
      return null;
    }
    return parsed as PersistedLearningState;
  } catch (err) {
    console.error('[learning-persistence] load failed, quarantining:', err);
    try { quarantine(filePath, 'parse-error'); } catch { /* ignore */ }
    return null;
  }
}

function quarantine(filePath: string, reason: string): void {
  try {
    const q = `${filePath}.corrupt-${Date.now()}-${reason}`;
    fs.renameSync(filePath, q);
    console.warn('[learning-persistence] quarantined corrupt state ->', q);
  } catch (err) {
    console.error('[learning-persistence] quarantine failed:', err);
  }
}

export function learningFileExists(): boolean {
  return fs.existsSync(resolveFilePath());
}

export function deleteLearningState(): boolean {
  const filePath = resolveFilePath();
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  } catch (err) {
    console.error('[learning-persistence] delete failed:', err);
    return false;
  }
}

export function getLearningFilePath(): string {
  return resolveFilePath();
}
