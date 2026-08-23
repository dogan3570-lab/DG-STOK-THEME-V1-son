import { prisma } from '../db/prisma.ts';
import { type SemanticIdentity } from './productUnderstanding.ts';
import { type VisualIdentity } from './imageIntelligence.ts';
import { type StageCandidate } from './categoryMatchEngine.ts';
import { type TaxonomyGapResult } from './taxonomyGapDetector.ts';
import { type V3GateResult } from './categoryCore.ts';

// ==================== TYPES ====================

export interface CategoryVerification {
  productId: string;
  fit: 'STRONG' | 'MEDIUM' | 'WEAK' | 'REJECT';
  reason: string;
  confidence: number;
  contradictsExcluded: boolean;
}

export interface ForensicEvidence {
  productId: string;
  xmlKey: string;
  timestamp: Date;
  pipelineVersion: 'v3';

  // Stage 1
  semanticIdentity: SemanticIdentity;

  // Stage 2 (if triggered)
  visualIdentity: VisualIdentity | null;

  // Stage 3
  candidates: StageCandidate[];
  taxonomyGap: TaxonomyGapResult | null;

  // Stage 4
  verification: CategoryVerification[];

  // Stage 5
  selectedCategory: { id: string; name: string; fullPath: string } | null;
  confidence: number;
  decision: 'AUTO_APPLY' | 'MANUAL_REVIEW' | 'TAXONOMY_GAP';
  gates: V3GateResult;

  // Audit
  oldCategoryId: string | null;
  oldMatchedBy: string | null;
  newCategoryId: string | null;
  newMatchedBy: string | null;
  reason: string;
}

// ==================== IN-MEMORY EVIDENCE STORE ====================

const evidenceStore = new Map<string, ForensicEvidence>();

export function storeEvidence(evidence: ForensicEvidence): void {
  evidenceStore.set(evidence.productId, evidence);
}

export function getStoredEvidence(productId: string): ForensicEvidence | undefined {
  return evidenceStore.get(productId);
}

export function getAllStoredEvidence(): ForensicEvidence[] {
  return Array.from(evidenceStore.values());
}

export function clearEvidenceStore(): void {
  evidenceStore.clear();
}

// ==================== EVIDENCE FORMATTER ====================

export function formatEvidenceReport(evidence: ForensicEvidence): string {
  const lines: string[] = [];
  lines.push(`=== PRODUCT: ${evidence.xmlKey} (${evidence.productId}) ===`);
  lines.push(`Pipeline: ${evidence.pipelineVersion} | Time: ${evidence.timestamp.toISOString()}`);
  lines.push('');

  // Stage 1
  lines.push('--- STAGE 1: PRODUCT UNDERSTANDING ---');
  lines.push(`Core Object: ${evidence.semanticIdentity.coreObject}`);
  lines.push(`Product Type: ${evidence.semanticIdentity.productType}`);
  lines.push(`Primary Function: ${evidence.semanticIdentity.primaryFunction}`);
  lines.push(`Use Case: ${evidence.semanticIdentity.useCase}`);
  lines.push(`Material: ${evidence.semanticIdentity.material ?? 'N/A'}`);
  lines.push(`Form Factor: ${evidence.semanticIdentity.formFactor ?? 'N/A'}`);
  lines.push(`Power Type: ${evidence.semanticIdentity.powerType ?? 'N/A'}`);
  lines.push(`Domain: ${evidence.semanticIdentity.domain}`);
  lines.push(`Supplier Trust: ${evidence.semanticIdentity.supplierCategoryTrust}`);
  lines.push(`Needs Image: ${evidence.semanticIdentity.needsImageInspection}`);
  lines.push(`Confidence: ${evidence.semanticIdentity.confidence}`);
  if (evidence.semanticIdentity.excludedInterpretations.length > 0) {
    lines.push(`Excluded: ${evidence.semanticIdentity.excludedInterpretations.join(', ')}`);
  }
  lines.push('');

  // Stage 2
  if (evidence.visualIdentity) {
    lines.push('--- STAGE 2: IMAGE INTELLIGENCE ---');
    lines.push(`Visual Type: ${evidence.visualIdentity.visualProductType}`);
    lines.push(`Confirms: ${evidence.visualIdentity.confirmsIdentity}`);
    lines.push(`Notes: ${evidence.visualIdentity.visualNotes}`);
    lines.push('');
  }

  // Stage 3
  lines.push('--- STAGE 3: CANDIDATE RETRIEVAL ---');
  if (evidence.candidates.length === 0) {
    lines.push('No candidates found.');
  } else {
    for (const c of evidence.candidates.slice(0, 5)) {
      lines.push(`  [${c.matchStage}] ${c.name} (score=${c.matchScore}, fit=${c.semanticFit})`);
      lines.push(`    Path: ${c.fullPath}`);
    }
    if (evidence.candidates.length > 5) {
      lines.push(`  ... and ${evidence.candidates.length - 5} more`);
    }
  }
  if (evidence.taxonomyGap) {
    lines.push(`TAXONOMY GAP: ${evidence.taxonomyGap.reason}`);
  }
  lines.push('');

  // Stage 4
  lines.push('--- STAGE 4: AI VERIFICATION ---');
  for (const v of evidence.verification) {
    lines.push(`  [${v.fit}] ${v.reason} (conf=${v.confidence}, contradictsExcluded=${v.contradictsExcluded})`);
  }
  lines.push('');

  // Stage 5
  lines.push('--- STAGE 5: SAFETY GATES ---');
  lines.push(`Decision: ${evidence.decision}`);
  if (evidence.selectedCategory) {
    lines.push(`Category: ${evidence.selectedCategory.name} (${evidence.selectedCategory.id})`);
    lines.push(`Full Path: ${evidence.selectedCategory.fullPath}`);
  }
  lines.push(`Confidence: ${evidence.confidence}`);
  if (!evidence.gates.pass) {
    lines.push(`FAILED GATE: ${evidence.gates.failedGate} — ${evidence.gates.detail}`);
  }
  lines.push('');

  // Audit
  lines.push('--- AUDIT ---');
  lines.push(`Old Category: ${evidence.oldCategoryId ?? 'none'}`);
  lines.push(`Old MatchedBy: ${evidence.oldMatchedBy ?? 'none'}`);
  lines.push(`New Category: ${evidence.newCategoryId ?? 'none'}`);
  lines.push(`New MatchedBy: ${evidence.newMatchedBy ?? 'none'}`);
  lines.push(`Reason: ${evidence.reason}`);
  lines.push('='.repeat(60));

  return lines.join('\n');
}

export function formatEvidenceSummary(evidences: ForensicEvidence[]): string {
  const lines: string[] = [];
  lines.push(`\n${'='.repeat(60)}`);
  lines.push(`V3 FORENSIC EVIDENCE SUMMARY — ${evidences.length} products`);
  lines.push(`${'='.repeat(60)}`);

  let autoApply = 0;
  let manualReview = 0;
  let taxonomyGap = 0;
  let totalConfidence = 0;

  for (const e of evidences) {
    if (e.decision === 'AUTO_APPLY') autoApply++;
    else if (e.decision === 'MANUAL_REVIEW') manualReview++;
    else if (e.decision === 'TAXONOMY_GAP') taxonomyGap++;
    totalConfidence += e.confidence;
  }

  lines.push(`AUTO_APPLY: ${autoApply} (${(autoApply / evidences.length * 100).toFixed(1)}%)`);
  lines.push(`MANUAL_REVIEW: ${manualReview} (${(manualReview / evidences.length * 100).toFixed(1)}%)`);
  lines.push(`TAXONOMY_GAP: ${taxonomyGap} (${(taxonomyGap / evidences.length * 100).toFixed(1)}%)`);
  lines.push(`AVG CONFIDENCE: ${(totalConfidence / evidences.length).toFixed(3)}`);
  lines.push(`${'='.repeat(60)}`);

  return lines.join('\n');
}
