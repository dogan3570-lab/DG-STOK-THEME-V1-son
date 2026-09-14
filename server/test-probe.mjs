import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function probe() {
  try {
    // Check AI provider configs
    const providers = await prisma.aIProviderConfig.findMany({ orderBy: { priority: "asc" } });
    console.log("=== AI PROVIDER CONFIGURATION ===");
    console.log(`Total providers: ${providers.length}`);
    for (const p of providers) {
      console.log(`  Provider: ${p.provider}`);
      console.log(`    Active: ${p.active}`);
      console.log(`    Has API Key: ${!!p.apiKeyEncrypted}`);
      console.log(`    Model: ${p.model}`);
      console.log(`    Last Status: ${p.lastStatus}`);
      console.log(`    Total Requests: ${p.totalRequests}`);
      console.log(`    Successful: ${p.successfulRequests}`);
      console.log(`    Failed: ${p.failedRequests}`);
      console.log(`    Last Used: ${p.lastUsedAt}`);
      console.log("");
    }

    // Check categories
    const categories = await prisma.category.count({ where: { externalId: { not: null } } });
    console.log("=== DATABASE STATE ===");
    console.log(`Categories with externalId: ${categories}`);

    // Check products
    const products = await prisma.product.count();
    console.log(`Total products: ${products}`);

    // Check product with status WAITING_AI
    const waitingAi = await prisma.product.count({ where: { variantStatus: "WAITING_AI" } });
    console.log(`Products waiting for AI: ${waitingAi}`);

    // Check marketplace
    const marketplaces = await prisma.marketplace.findMany();
    console.log(`Marketplaces: ${marketplaces.length}`);
    for (const mp of marketplaces) {
      console.log(`  - ${mp.key}: ${mp.name} (active: ${mp.active})`);
    }

    await prisma.$disconnect();
    console.log("=== PROBE COMPLETE ===");
  } catch (e) {
    console.error("PROBE ERROR:", e.message);
    await prisma.$disconnect().catch(() => null);
    process.exit(1);
  }
}

probe();