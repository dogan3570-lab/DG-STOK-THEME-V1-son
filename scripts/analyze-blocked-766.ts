// scripts/analyze-blocked-766.ts
// READ-ONLY analysis – uses ONLY existing services.
// Run: npx tsx scripts/analyze-blocked-766.ts
// Output: JSON on stdout. No DB writes, no file writes, no Git.

import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { getBlockedProductIds } from '../server/src/services/missingFieldsService.js';
import { evaluateTrendyolSendGate } from '../server/src/services/sendReadiness.js';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function getTrendyolMarketplaceId() {
  const mp = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true } });
  return mp?.id;
}

interface BlockedResult {
  productId: string;
  firstFailureCode: string | null;
  firstFailureMessage: string | null;
  blockingReasons: string[];
  steps: Record<string, any>;
}

async function main() {
  // 1️⃣ Load blocked IDs using real scanning function
  const blockedIds = await getBlockedProductIds({});
  const totalBlocked = blockedIds.length;
  console.error(`Total blocked distinct products: ${blockedIds.length}`);

  const uniqueIds = new Set(blockedIds);
  const duplicateCount = blockedIds.length - new Set(blockedIds).size;
  console.error(`Duplicate productIds: ${blockedIds.length - new Set(blockedIds).size}`);

  const marketplaceId = await getTrendyolMarketplaceId();
  if (!marketplaceId) throw new Error('Trendyol marketplace not found');

  // Load blocked products
  const blockedProducts = await prisma.product.findMany({
    where: { id: { in: Array.from(new Set(blockedIds)) } },
    select: {
      id: true,
      title: true,
      description: true,
      xmlSourceId: true,
      categoryId: true,
      brand: { select: { externalId: true } },
      variants: { select: { id: true } },
      marketplaceStates: { where: { marketplaceId: (await getTrendyolMarketplaceId()) }, select: { status: true } },
    },
  });

  const results = [];

  for (const product of blockedProducts) {
    // Evaluate real send readiness gate
    const gate = await evaluateTrendyolSendGate({
      productId: product.id,
      marketplaceId: await getTrendyolMarketplaceId(),
      xmlSourceId: product.xmlSourceId!,
    });

    const firstFailureCode = gate.firstFailureCode;
    const firstFailureMessage = gate.firstFailureMessage;
    const steps = gate.steps;

    // Collect every failing step from gate.steps
    const blockingReasons = Object.values(gate.steps as Record<string, any>)
      .filter((s: any) => s?.status === 'FAIL' && s?.reasonCode)
      .map((s: any) => s.reasonCode);

    results.push({
      productId: product.id,
      firstFailureCode: gate.firstFailureCode,
      firstFailureMessage: gate.firstFailureMessage,
      blockingReasons,
      steps: gate.steps,
    });
  }

  // Summary
  const productsReturned = results.length;
  const missingProducts = blockedIds.length - results.length;
  try {
    const statsResp = await fetch('http://localhost:4000/products/stats', {
      headers: { Cookie: fs.readFileSync(path.resolve('cookies.txt'), 'utf8') },
    });
    const stats = await statsResp.json();
    const readyNow = stats.data?.marketplaceReady ?? 0;
    console.log(JSON.stringify({
      totalBlocked: blockedIds.length,
      distinctBlockedCount: new Set(blockedIds).size,
      duplicateCount: blockedIds.length - new Set(blockedIds).size,
      productsReturned: results.length,
      missingProducts: blockedIds.length - results.length,
      results,
    }, null, 2));
  } catch {}

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());