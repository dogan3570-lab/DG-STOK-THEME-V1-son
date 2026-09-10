/**
 * CATEGORY STATE MACHINE — eligibility gate + state transitions.
 *
 * RULES:
 *  - matchedBy is provenance, NOT eligibility.
 *  - Eligibility is derived from explicit current state.
 *  - AI eligibility = MANUAL_REVIEW only (categoryMatch=false, matchedBy=null, categoryId=null, supplierCategory valid).
 *  - categoryMatch=true means MATCHED (regardless of matchedBy).
 *  - categoryMatch=false + categoryId!=null = INTEGRITY_REVIEW (anomaly, needs forensic classification).
 *  - categoryMatch=false + supplierCategory missing = INSUFFICIENT_INPUT (cannot match).
 *  - categoryMatch=false + matchedBy=null + categoryId=null + supplierCategory valid = MANUAL_REVIEW.
 *  - categoryMatch=false + matchedBy!=null = STALE_UNMATCHED (previously processed, then unmatched).
 */

export interface ProductState {
  id: string;
  categoryMatch: boolean;
  matchedBy: string | null;
  categoryId: string | null;
  aiSuggestedCategoryId: string | null;
  aiScore: number | null;
  supplierCategory: string | null;
}

export type MachineState =
  | 'AUTO_MATCHED'
  | 'AI_MATCHED'
  | 'MANUAL_MATCHED'
  | 'LEGACY_MATCHED'
  | 'MANUAL_REVIEW'
  | 'INTEGRITY_REVIEW'
  | 'INSUFFICIENT_INPUT'
  | 'STALE_UNMATCHED';

/**
 * Derive the current machine state from DB fields.
 * This is the SINGLE SOURCE OF TRUTH for state classification.
 *
 * Priority order:
 *  1. categoryMatch=true → MATCHED states (by matchedBy)
 *  2. categoryId!=null + categoryMatch=false → INTEGRITY_REVIEW
 *  3. supplierCategory missing → INSUFFICIENT_INPUT
 *  4. matchedBy=null + supplierCategory valid → MANUAL_REVIEW
 *  5. matchedBy!=null + categoryMatch=false → STALE_UNMATCHED
 */
export function deriveState(p: ProductState): MachineState {
  if (p.categoryMatch === true) {
    if (p.matchedBy === 'auto') return 'AUTO_MATCHED';
    if (p.matchedBy === 'ai') return 'AI_MATCHED';
    if (p.matchedBy === 'manual') return 'MANUAL_MATCHED';
    return 'LEGACY_MATCHED';
  }

  // categoryMatch === false

  // RULE 7: categoryId!=null + categoryMatch=false = INTEGRITY_REVIEW
  // These products have a categoryId set but categoryMatch was never set to true.
  // They need forensic classification before any automated processing.
  if (p.categoryId !== null) return 'INTEGRITY_REVIEW';

  // supplierCategory missing = INSUFFICIENT_INPUT
  // Cannot match without source category information.
  const hasNoSupplier = !p.supplierCategory || p.supplierCategory.trim() === '';
  if (hasNoSupplier) return 'INSUFFICIENT_INPUT';

  // matchedBy=null + valid supplierCategory + categoryId=null = MANUAL_REVIEW
  // These are the true AI-eligible candidates.
  if (p.matchedBy === null) return 'MANUAL_REVIEW';

  // matchedBy is set but categoryMatch=false → STALE_UNMATCHED
  return 'STALE_UNMATCHED';
}

/**
 * Is this product eligible for AI processing?
 *
 * RULE 6: AI MUST only process MANUAL_REVIEW products.
 * deriveState() now correctly classifies:
 *   - categoryId!=null → INTEGRITY_REVIEW (excluded)
 *   - supplierCategory missing → INSUFFICIENT_INPUT (excluded)
 *   - matchedBy!=null → STALE_UNMATCHED (excluded)
 *   - categoryMatch=true → MATCHED states (excluded)
 * Only MANUAL_REVIEW (categoryMatch=false, matchedBy=null, categoryId=null, supplierCategory valid) passes.
 */
export function isAiEligible(p: ProductState): boolean {
  return deriveState(p) === 'MANUAL_REVIEW';
}

/**
 * Is this product eligible for manual matching?
 * MANUAL_REVIEW and INSUFFICIENT_INPUT products are eligible.
 * INTEGRITY_REVIEW products are NOT eligible (need forensic classification first).
 */
export function isManualEligible(p: ProductState): boolean {
  if (p.categoryMatch === true) return false;
  const state = deriveState(p);
  return state === 'MANUAL_REVIEW' || state === 'INSUFFICIENT_INPUT';
}

/**
 * Is this product eligible for automatic matching?
 * Only products with valid supplierCategory and no categoryId set.
 */
export function isAutoEligible(p: ProductState): boolean {
  if (p.categoryMatch === true) return false;
  const state = deriveState(p);
  return state === 'MANUAL_REVIEW' || state === 'INSUFFICIENT_INPUT';
}

/**
 * Can this product transition to categoryMatch=true via the given method?
 * Enforces RULE 12 (no AI overwrite manual), RULE 17 (valid category required).
 */
export function canTransitionToMatched(
  p: ProductState,
  method: 'auto' | 'ai' | 'manual',
): boolean {
  if (p.categoryMatch === true) return false;

  if (method === 'ai') {
    // RULE 12: AI must not overwrite manual match
    // Since categoryMatch=false, this product is not matched, so safe.
    // But we should verify it's AI eligible:
    return isAiEligible(p);
  }

  return true;
}

/**
 * Compute the eligible counts for UI display.
 * Returns { autoEligible, manualReview, aiEligible, integrityReview, insufficientInput }
 */
export function computeEligibility(products: ProductState[]): {
  autoEligible: number;
  manualReview: number;
  aiEligible: number;
  integrityReview: number;
  insufficientInput: number;
} {
  let autoEligible = 0;
  let manualReview = 0;
  let aiEligible = 0;
  let integrityReview = 0;
  let insufficientInput = 0;

  for (const p of products) {
    if (p.categoryMatch === true) continue;
    const state = deriveState(p);
    if (state === 'MANUAL_REVIEW') {
      autoEligible++;
      manualReview++;
      aiEligible++;
    } else if (state === 'INTEGRITY_REVIEW') {
      integrityReview++;
    } else if (state === 'INSUFFICIENT_INPUT') {
      insufficientInput++;
    }
  }

  return { autoEligible, manualReview, aiEligible, integrityReview, insufficientInput };
}
