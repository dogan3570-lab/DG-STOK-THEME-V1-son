/**
 * CATEGORY SAFETY GATE — Deterministic taxonomy validation
 *
 * P0 GUVENLIK KATMANI: AI verifier gecmeden once/kesinlikle sonrada
 * bagimsiz calisir. Verifier'in goremeyecegi taxonomy sinyallerini
 * dogrular. Verifier YES dese bile bu gate FAIL verirse AUTO yazilmaz.
 *
 * FIX(30): Her gate independent — bir gate bypass edilse bile digerleri calisir.
 * FIX(30): getFamily() yerine taxonomy root kullanimi — keyword ambiguitesi onlenir.
 * FAIL-CLOSED: herhangi bir belirsizlik → MANUAL_REVIEW.
 */

import type { LeafInfo, TreeIndex } from './categoryMatchEngine.ts';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface SafetyGateInput {
  productId: string;
  title: string | null;
  supplierCategory: string | null;
  currentCategoryId: string | null;
  currentCategoryName: string | null;
  currentCategoryPath: string | null;
  selectedCategoryId: string;
  selectedCategoryName: string;
  selectedCategoryPath: string;
  selectedCategoryExternalId: number;
  candidates: { id: string; name: string; fullPath: string; score: number }[];
  aiConfidence: number;
  verifierVerdict: boolean;
  verifierConfidence: number;
  margin: number;
  tree: TreeIndex;
  isDeterministic?: boolean;
  decisionMethod?: string;
}

/**
 * Audit-specific input for buildCategoryAuditMeta.
 * Callers only provide audit-relevant fields, not full safety gate input.
 */
export interface AuditMetaInput {
  productId: string;
  decisionMethod: string;
  decisionScope?: string;
  oldCategoryId?: string | null;
  newCategoryId?: string | null;
  supplierCategory?: string | null;
  selectedCategory?: string | null;
  candidate?: string | null;
  aiConfidence?: number;
  verifierResult?: string;
  verifierConfidence?: number;
  margin?: number;
  safetyGateResult?: string;
  reason?: string;
  model?: string;
}

export interface SafetyGateResult {
  passed: boolean;
  gates: GateResult[];
  reason: string;
}

export interface GateResult {
  gate: string;
  passed: boolean;
  detail: string;
}

// ═══════════════════════════════════════════════════════════════
// FAMILY DEFINITIONS — Taxonomy Root Based (NOT keyword-based)
// ═══════════════════════════════════════════════════════════════

/**
 * Taxonomy root families — actual tree structure, NOT keyword matching.
 * Source: Category table with externalId IS NOT NULL, parentId NULL.
 */
const ROOT_FAMILY_MAP: Record<string, string> = {
  'Elektronik': 'electronics',
  'Banyo Yapı & Hırdavat': 'hardware',
  'Otomobil & Motosiklet': 'auto',
  'Kozmetik & Kişisel Bakım': 'cosmetics',
  'Spor & Outdoor': 'sport',
  'Ev & Mobilya': 'home',
  'Aksesuar': 'textile',
  'Anne & Bebek & Çocuk': 'kids',
  'Oyuncak': 'toys',
  'Bahçe & Elektrikli El Aletleri': 'garden',
  'Süpermarket': 'food',
  'Kırtasiye & Ofis Malzemeleri': 'office',
  'Fotoğraf & Kamera': 'photography',
  'Oyun & Konsol': 'gaming',
  'Güvenlik Sistemleri': 'security',
  'Hırdavat': 'hardware',
  'Petshop': 'pet',
  'Sağlık': 'health',
};

/**
 * Get taxonomy root name from full path.
 * Example: "Elektronik > Elektrikli Ev Aletleri > Süpürge" → "Elektronik"
 */
export function getTaxonomyRoot(fullPath: string): string {
  const segments = fullPath.split('>').map(s => s.trim()).filter(Boolean);
  return segments.length > 0 ? segments[0] : '';
}

/**
 * Get family from taxonomy path using root mapping.
 * Deterministic — no keyword matching, no ambiguity.
 */
export function getTaxonomyRootFamily(fullPath: string): string {
  const root = getTaxonomyRoot(fullPath);
  return ROOT_FAMILY_MAP[root] || 'other';
}

/**
 * Get taxonomy root family from supplierCategory path.
 */
export function getSupplierRootFamily(supplierCategory: string | null): string {
  if (!supplierCategory) return 'other';
  const root = supplierCategory.split('>')[0].trim();
  return ROOT_FAMILY_MAP[root] || 'other';
}

// ═══════════════════════════════════════════════════════════════
// MAIN SAFETY GATE
// ═══════════════════════════════════════════════════════════════

const GATE_ORDER = [
  'category_exists',
  'is_leaf',
  'supplier_family',
  'current_family',
  'candidate_membership',
  'ai_confidence',
  'verifier_verdict',
  'verifier_confidence',
  'margin',
  'ambiguity',
] as const;

export function verifyCategorySafety(input: SafetyGateInput): SafetyGateResult {
  const gates: GateResult[] = [];

  // GATE 1: CATEGORY EXISTS
  const selectedExists = input.tree.leafById.has(input.selectedCategoryId);
  gates.push({
    gate: 'category_exists',
    passed: selectedExists,
    detail: selectedExists
      ? `Category ${input.selectedCategoryName} exists in taxonomy`
      : `Category ${input.selectedCategoryId} NOT FOUND in taxonomy`,
  });
  if (!selectedExists) return fail(gates, 'Category does not exist in taxonomy');

  // GATE 2: IS LEAF
  const selectedNode = input.tree.leafById.get(input.selectedCategoryId);
  const isLeaf = selectedNode !== undefined; // leafById only contains leaves
  gates.push({
    gate: 'is_leaf',
    passed: isLeaf,
    detail: isLeaf
      ? `${input.selectedCategoryName} is a leaf category`
      : `${input.selectedCategoryName} is NOT a leaf (parent category)`,
  });
  if (!isLeaf) return fail(gates, 'Selected category is a parent, not a leaf');

  // GATE 3: SUPPLIER FAMILY COMPATIBILITY
  const supplierFamily = getSupplierRootFamily(input.supplierCategory);
  const selectedFamily = getTaxonomyRootFamily(input.selectedCategoryPath);
  const supplierFamilyOk = supplierFamily === selectedFamily;
  gates.push({
    gate: 'supplier_family',
    passed: supplierFamilyOk,
    detail: supplierFamilyOk
      ? `Supplier family (${supplierFamily}) matches selected family (${selectedFamily})`
      : `FAMILY MISMATCH: supplier=${supplierFamily} vs selected=${selectedFamily}`,
  });
  if (!supplierFamilyOk) return fail(gates, `Supplier family mismatch: ${supplierFamily} != ${selectedFamily}`);

  // GATE 4: CURRENT CATEGORY FAMILY COMPATIBILITY
  let currentFamilyOk = true;
  let currentFamilyDetail = 'No current category';
  if (input.currentCategoryId && input.currentCategoryPath) {
    const currentFamily = getTaxonomyRootFamily(input.currentCategoryPath);
    currentFamilyOk = currentFamily === selectedFamily;
    currentFamilyDetail = currentFamilyOk
      ? `Current family (${currentFamily}) matches selected family (${selectedFamily})`
      : `CURRENT FAMILY MISMATCH: current=${currentFamily} vs selected=${selectedFamily}`;
  }
  gates.push({
    gate: 'current_family',
    passed: currentFamilyOk,
    detail: currentFamilyDetail,
  });
  if (!currentFamilyOk) return fail(gates, `Current family mismatch: ${getTaxonomyRootFamily(input.currentCategoryPath!)} != ${selectedFamily}`);

  // GATE 5: CANDIDATE MEMBERSHIP
  const inCandidates = input.candidates.some(c => c.id === input.selectedCategoryId);
  gates.push({
    gate: 'candidate_membership',
    passed: inCandidates,
    detail: inCandidates
      ? `Category ${input.selectedCategoryName} is in candidate list`
      : `Category ${input.selectedCategoryName} is NOT in candidate list (possible hallucination)`,
  });
  if (!inCandidates) return fail(gates, 'Selected category not in candidate list');

  // GATE 6: AI CONFIDENCE
  const confidenceOk = input.aiConfidence >= 0.95;
  gates.push({
    gate: 'ai_confidence',
    passed: confidenceOk,
    detail: confidenceOk
      ? `AI confidence ${input.aiConfidence.toFixed(2)} >= 0.95`
      : `AI confidence ${input.aiConfidence.toFixed(2)} < 0.95`,
  });
  if (!confidenceOk) return fail(gates, `AI confidence too low: ${input.aiConfidence}`);

  // GATE 7: VERIFIER VERDICT
  const verdictOk = input.verifierVerdict === true;
  gates.push({
    gate: 'verifier_verdict',
    passed: verdictOk,
    detail: verdictOk
      ? 'Verifier verdict = YES'
      : 'Verifier verdict = NO',
  });
  if (!verdictOk) return fail(gates, 'Verifier rejected the match');

  // GATE 8: VERIFIER CONFIDENCE
  const vConfOk = input.verifierConfidence >= 0.9;
  gates.push({
    gate: 'verifier_confidence',
    passed: vConfOk,
    detail: vConfOk
      ? `Verifier confidence ${input.verifierConfidence.toFixed(2)} >= 0.90`
      : `Verifier confidence ${input.verifierConfidence.toFixed(2)} < 0.90`,
  });
  if (!vConfOk) return fail(gates, `Verifier confidence too low: ${input.verifierConfidence}`);

  // GATE 9: MARGIN (AMBIGUITY)
  const marginOk = input.margin >= 0.05;
  gates.push({
    gate: 'margin',
    passed: marginOk,
    detail: marginOk
      ? `Margin ${input.margin.toFixed(2)} >= 0.05 (unambiguous)`
      : `Margin ${input.margin.toFixed(2)} < 0.05 (ambiguous)`,
  });
  if (!marginOk) return fail(gates, `Margin too low: ${input.margin}`);

  // ALL GATES PASSED
  return {
    passed: true,
    gates,
    reason: `ALL GATES PASSED: ${gates.map(g => g.gate).join(', ')}`,
  };
}

function fail(gates: GateResult[], reason: string): SafetyGateResult {
  return { passed: false, gates, reason: `GATE FAIL: ${reason}` };
}

/**
 * Quick check: does this input pass all gates?
 * Returns boolean for fast path checks.
 */
export function isCategoryAutoSafe(input: SafetyGateInput): boolean {
  return verifyCategorySafety(input).passed;
}

/**
 * Build audit metadata for category matching operations.
 * Used by prepCategories.ts for logging category match decisions.
 * Accepts AuditMetaInput — callers only need audit-relevant fields.
 */
export function buildCategoryAuditMeta(input: AuditMetaInput): Record<string, any> {
  return {
    productId: input.productId,
    decisionMethod: input.decisionMethod,
    decisionScope: input.decisionScope ?? null,
    oldCategoryId: input.oldCategoryId ?? null,
    newCategoryId: input.newCategoryId ?? null,
    supplierCategory: input.supplierCategory ?? null,
    selectedCategory: input.selectedCategory ?? null,
    candidate: input.candidate ?? null,
    aiConfidence: input.aiConfidence ?? null,
    verifierResult: input.verifierResult ?? null,
    verifierConfidence: input.verifierConfidence ?? null,
    margin: input.margin ?? null,
    safetyGateResult: input.safetyGateResult ?? null,
    reason: input.reason ?? null,
    model: input.model ?? null,
  };
}
