/**
 * CATEGORY KNOWLEDGE V2 — ADAPTIVE LEARNING + GROUP MATCH
 * ========================================================
 *
 * Bu modül V1 pipeline'a entegre edilir:
 *
 *   PRODUCT
 *      │
 *      ▼
 *   NORMALIZE SUPPLIER CATEGORY
 *      │
 *      ▼
 *   L1 KNOWLEDGE LOOKUP (V2)
 *      │
 *      ├── HIT ─────────────────────────────┐
 *      ▼                                   │
 *   L2 GROUP EVIDENCE LOOKUP (V2)          │
 *      │                                   │
 *      ├── HIT ─────────────────────────────┤
 *      ▼                                   │
 *   SAFETY GATE (V1)                       │
 *      │                                   │
 *      ├── PASS ────────────────────────────┤
 *      ▼                                   ▼
 *   WRITE GATE (V1)
 *      │
 *      ▼
 *   LEARNING ENGINE (V2)
 *
 *
 * KRITIK KURALLAR:
 * - confidence < 0.95 → OGRENME YOK
 * - 0.95 → güvenli doğrulama varsa OGREN
 * - CONFLICT → AUTO APPLY YOK
 * - STALE taxonomy → HIT YOK
 * - NON_LEAF → OGRENME YOK
 * - FAMILY contamination → GROUP HIT BLOCK
 * - V2 sadece file-backed state'e yazar (DB'ye YAZMAZ)
 *
 */

import fs from 'node:fs';
import path from 'node:path';

// ==================== TYPES ====================

export interface KnowledgeEntryV2 {
  key: string;
  rawSupplierCategory: string;
  targetCategoryId: string;
  targetCategoryName: string;
  targetCategoryPath: string;
  targetExternalId: number;
  categoryFamily: string;
  taxonomyVersion: string;
  decisionMethod: 'EXACT_TAXONOMY_MATCH' | 'RULE_CANONICAL_SAFE' | 'AI_PRODUCT_VERIFIED' | 'GROUP_MATCH';
  confidence: number;
  successCount: number;
  conflictCount: number;
  manualCorrectionCount: number;
  usageCount: number;
  lastValidatedAt: string;
  createdAt: string;
  status: 'ACTIVE' | 'STALE' | 'CONFLICT' | 'INVALID';
}

export interface GroupEvidence {
  key: string;
  rawSupplierCategory: string;
  targetCategoryId: string;
  targetCategoryName: string;
  targetCategoryPath: string;
  categoryFamily: string;
  count: number;
  total: number;
  ratio: number;
  taxonomyVersion: string;
  lastUpdated: string;
  familyCounts: Record<string, number>;
  familySet: string[];
}

export interface V2Benchmark {
  timestamp: string;
  totalProducts: number;
  knowledgeHits: number;
  groupHits: number;
  aiCalls: number;
  aiAuto: number;
  aiSuggestion: number;
  manual: number;
  noSafeMatch: number;
  processingTimeMs: number;
  knowledgeCount: number;
  groupEvidenceCount: number;
  conflicts: number;
}

interface V2State {
  processedIds: string[];
  benchmark: V2Benchmark[];
  knowledgeV2: Record<string, KnowledgeEntryV2>;
  groupEvidence: Record<string, GroupEvidence>;
}

// ==================== CONFIG ====================

const MIN_GROUP_MATCHED = 3;
const MIN_GROUP_RATIO = 0.80;
const MAX_CONFLICT_RATIO = 0.15;
const KNOWLEDGE_V2_FILE = path.join(process.cwd(), '_cat-knowledge-v2.json');
const GROUP_EVIDENCE_FILE = path.join(process.cwd(), '_cat-group-evidence.json');
const STATE_FILE = path.join(process.cwd(), '_cat-v2-state.json');

// ==================== NORMALIZATION ====================

const CHAR_MAP: Record<string, string> = {
  'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u',
  'Ç': 'c', 'Ğ': 'g', 'İ': 'i', 'I': 'i', 'Ö': 'o', 'Ş': 's', 'Ü': 'u',
};

const PATH_SEPARATORS = ['>>>', '>>', '/', '\\', '>'];

export function normalizeSC(sc: string | null): string {
  if (!sc) return '';
  let result = sc;

  result = result.replace(/&amp;/g, '&');
  result = result.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  result = result.replace(/&quot;/g, '"').replace(/&#39;/g, "'");

  for (const [from, to] of Object.entries(CHAR_MAP)) {
    result = result.split(from).join(to);
  }
  result = result.toLowerCase();

  for (const sep of PATH_SEPARATORS) {
    result = result.split(sep).join('>');
  }

  result = result.replace(/[^a-z0-9\s>]/g, ' ');
  result = result.replace(/\s*>\s*/g, '>');
  result = result.replace(/>\s*>/g, '>');
  result = result.replace(/\s+/g, ' ').trim();
  result = result.replace(/^>+|>+$/g, '').trim();

  const parts = result.split('>').map(p => p.trim()).filter(Boolean);
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const part of parts) {
    if (!seen.has(part)) {
      seen.add(part);
      deduped.push(part);
    }
  }

  return deduped.join('>');
}

// ==================== STATE MANAGEMENT ====================

export function loadState(): V2State {
  try {
    const data = fs.readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return { processedIds: [], benchmark: [], knowledgeV2: {}, groupEvidence: {} };
  }
}

export function saveState(state: V2State): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ==================== KNOWLEDGE LOOKUP ====================

export function lookupKnowledgeV2(
  supplierCategory: string | null,
  tree: { leafById: Map<string, any>; leaves: any[] }
): { hit: boolean; entry: KnowledgeEntryV2 | null; reason: string } {
  if (!supplierCategory) {
    return { hit: false, entry: null, reason: 'null supplierCategory' };
  }

  const norm = normalizeSC(supplierCategory);
  const state = loadState();
  const entry = state.knowledgeV2[norm];

  if (!entry) {
    return { hit: false, entry: null, reason: `no knowledge for key: ${norm.slice(0, 50)}` };
  }

  if (entry.status !== 'ACTIVE') {
    return { hit: false, entry, reason: `knowledge status: ${entry.status}` };
  }

  const leaf = tree.leafById.get(entry.targetCategoryId);
  if (!leaf) {
    return { hit: false, entry, reason: 'target category not in taxonomy' };
  }

  const conflictRatio = entry.conflictCount / Math.max(1, entry.usageCount);
  if (conflictRatio > MAX_CONFLICT_RATIO) {
    return { hit: false, entry, reason: `conflict ratio too high: ${conflictRatio.toFixed(2)}` };
  }

  const currentTaxVersion = `tt-leaves-${tree.leaves.length}`;
  if (entry.taxonomyVersion !== currentTaxVersion) {
    return { hit: false, entry, reason: `taxonomy version mismatch: ${entry.taxonomyVersion} vs ${currentTaxVersion}` };
  }

  return { hit: true, entry, reason: 'knowledge hit' };
}

// ==================== GROUP LOOKUP ====================

export function lookupGroupEvidence(
  supplierCategory: string | null,
  tree: { leafById: Map<string, any>; leaves: any[] }
): { hit: boolean; evidence: GroupEvidence | null; reason: string } {
  if (!supplierCategory) {
    return { hit: false, evidence: null, reason: 'null supplierCategory' };
  }

  const norm = normalizeSC(supplierCategory);
  const state = loadState();
  const evidence = state.groupEvidence[norm];

  if (!evidence) {
    return { hit: false, evidence: null, reason: 'no group evidence' };
  }

  if (evidence.count < MIN_GROUP_MATCHED || evidence.ratio < MIN_GROUP_RATIO) {
    return { hit: false, evidence, reason: `insufficient group evidence: ${evidence.count}/${evidence.total} (${evidence.ratio.toFixed(2)})` };
  }

  if (evidence.familySet && evidence.familySet.length > 1) {
    return { hit: false, evidence, reason: `family contamination detected: ${evidence.familySet.length} families` };
  }

  const leaf = tree.leafById.get(evidence.targetCategoryId);
  if (!leaf) {
    return { hit: false, evidence, reason: 'target category not in taxonomy' };
  }

  return { hit: true, evidence, reason: 'group evidence hit' };
}

// ==================== LEARNING ====================

export function learnFromVerifiedDecision(input: {
  productId: string;
  supplierCategory: string;
  targetCategoryId: string;
  targetCategoryName: string;
  targetCategoryPath: string;
  targetExternalId: number;
  categoryFamily: string;
  taxonomyVersion: string;
  decisionMethod: 'AI_PRODUCT_VERIFIED' | 'GROUP_MATCH' | 'RULE_CANONICAL_SAFE' | 'EXACT_TAXONOMY_MATCH';
  confidence: number;
}, tree?: { leafById: Map<string, any>; leaves: any[] }): void {
  if (!input.supplierCategory) return;

  // KRITIK: confidence < 0.95 → OGRENME YOK
  if (input.confidence < 0.95) return;

  if (tree) {
    const leaf = tree.leafById.get(input.targetCategoryId);
    if (!leaf) return;
  }

  const norm = normalizeSC(input.supplierCategory);
  const state = loadState();

  if (!state.knowledgeV2[norm]) {
    state.knowledgeV2[norm] = {
      key: norm,
      rawSupplierCategory: input.supplierCategory,
      targetCategoryId: input.targetCategoryId,
      targetCategoryName: input.targetCategoryName,
      targetCategoryPath: input.targetCategoryPath,
      targetExternalId: input.targetExternalId,
      categoryFamily: input.categoryFamily,
      taxonomyVersion: input.taxonomyVersion,
      decisionMethod: input.decisionMethod,
      confidence: input.confidence,
      successCount: 1,
      conflictCount: 0,
      manualCorrectionCount: 0,
      usageCount: 1,
      lastValidatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      status: 'ACTIVE',
    };
  } else {
    const entry = state.knowledgeV2[norm];

    if (entry.targetCategoryId !== input.targetCategoryId) {
      entry.conflictCount++;
      entry.usageCount++;
      entry.lastValidatedAt = new Date().toISOString();
      const conflictRatio = entry.conflictCount / Math.max(1, entry.usageCount);
      if (conflictRatio > MAX_CONFLICT_RATIO) {
        entry.status = 'CONFLICT';
      }
    } else {
      entry.successCount++;
      entry.usageCount++;
      entry.lastValidatedAt = new Date().toISOString();
      entry.confidence = Math.min(0.99, entry.confidence + 0.01);
    }
  }

  saveState(state);
}

export function updateGroupEvidence(input: {
  supplierCategory: string;
  targetCategoryId: string;
  targetCategoryName: string;
  targetCategoryPath: string;
  categoryFamily: string;
  taxonomyVersion: string;
}): void {
  if (!input.supplierCategory) return;

  const norm = normalizeSC(input.supplierCategory);
  const state = loadState();

  if (!state.groupEvidence[norm]) {
    state.groupEvidence[norm] = {
      key: norm,
      rawSupplierCategory: input.supplierCategory,
      targetCategoryId: input.targetCategoryId,
      targetCategoryName: input.targetCategoryName,
      targetCategoryPath: input.targetCategoryPath,
      categoryFamily: input.categoryFamily,
      count: 1,
      total: 1,
      ratio: 1.0,
      taxonomyVersion: input.taxonomyVersion,
      lastUpdated: new Date().toISOString(),
      familyCounts: { [input.categoryFamily]: 1 },
      familySet: [input.categoryFamily],
    };
  } else {
    const evidence = state.groupEvidence[norm];
    if (evidence.targetCategoryId === input.targetCategoryId) {
      evidence.count++;
    }
    evidence.total++;
    evidence.ratio = evidence.count / evidence.total;
    evidence.lastUpdated = new Date().toISOString();

    if (!evidence.familyCounts[input.categoryFamily]) {
      evidence.familyCounts[input.categoryFamily] = 0;
      evidence.familySet.push(input.categoryFamily);
    }
    evidence.familyCounts[input.categoryFamily]++;
  }

  saveState(state);
}

// ==================== STATS ====================

export function getV2Stats(): {
  knowledgeV2Count: number;
  groupEvidenceCount: number;
  activeKnowledge: number;
  conflictKnowledge: number;
  staleKnowledge: number;
} {
  const state = loadState();
  const kv2 = state.knowledgeV2;
  return {
    knowledgeV2Count: Object.keys(kv2).length,
    groupEvidenceCount: Object.keys(state.groupEvidence).length,
    activeKnowledge: Object.values(kv2).filter(e => e.status === 'ACTIVE').length,
    conflictKnowledge: Object.values(kv2).filter(e => e.status === 'CONFLICT').length,
    staleKnowledge: Object.values(kv2).filter(e => e.status === 'STALE').length,
  };
}
