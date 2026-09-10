import { type SemanticIdentity } from './productUnderstanding.ts';
import { type StageCandidate } from './categoryMatchEngine.ts';

// ==================== TYPES ====================

export interface TaxonomyGapResult {
  isGap: boolean;
  reason: string;
  bestAvailableCandidates: StageCandidate[];
  productType: string;
  marketplaceName: string;
}

// ==================== MAIN FUNCTION ====================

export function detectTaxonomyGap(
  identity: SemanticIdentity,
  candidates: StageCandidate[],
  marketplaceName: string,
): TaxonomyGapResult {
  const hasExactOrNormalized = candidates.some((c) => c.matchStage === 'exact' || c.matchStage === 'normalized');
  const noCandidates = candidates.length === 0;
  const allWeak = candidates.length > 0 && candidates.every((c) => c.semanticFit === 'WEAK' || c.semanticFit === 'REJECT');
  const veryLowScore = candidates.length > 0 && candidates[0].matchStage === 'semantic' && candidates[0].matchScore < 10;

  let reason: string;
  let isGap: boolean;

  if (noCandidates) {
    isGap = true;
    reason = `No candidates found for "${identity.coreObject}" (${identity.productType}) in ${marketplaceName} taxonomy`;
  } else if (hasExactOrNormalized) {
    // If we have exact or normalized matches, it's NOT a gap — even if verification is WEAK
    isGap = false;
    reason = `Exact/normalized candidates found (${candidates.length}, best: ${candidates[0]?.name ?? 'N/A'}, stage: ${candidates[0]?.matchStage ?? 'N/A'})`;
  } else if (allWeak) {
    isGap = true;
    reason = `All ${candidates.length} candidates have WEAK/REJECT fit for "${identity.coreObject}" in ${marketplaceName}`;
  } else if (veryLowScore) {
    isGap = true;
    reason = `Best candidate score (${candidates[0].matchScore}) is too low for "${identity.coreObject}" in ${marketplaceName}`;
  } else {
    isGap = false;
    reason = `Valid candidates found (${candidates.length}, best: ${candidates[0]?.name ?? 'N/A'}, stage: ${candidates[0]?.matchStage ?? 'N/A'})`;
  }

  return {
    isGap,
    reason,
    bestAvailableCandidates: candidates.slice(0, 5),
    productType: identity.productType,
    marketplaceName,
  };
}
