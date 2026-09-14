import { PrismaClient } from '@prisma/client';
import { executeMasterRequest } from './src/services/omniRouteOrchestrator.ts';
import { matchCategoriesWithAI } from './src/services/aiGateway.ts';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

async function test() {
  console.log('=== Testing executeMasterRequest (full chain) ===');
  try {
    const result = await executeMasterRequest({
      taskType: 'CATEGORY_MATCHING',
      messages: [{ role: 'user', content: 'Respond with exactly: TEST_OK' }],
      maxTokens: 20,
      temperature: 0,
    });
    console.log('executeMasterRequest result:', JSON.stringify(result, null, 2));
  } catch (e) {
    console.log('executeMasterRequest error:', e.message);
    console.log(e.stack);
  }
  
  // Test matchCategoriesWithAI directly
  console.log('\n=== Testing matchCategoriesWithAI (full chain) ===');
  try {
    const { matchCategoriesWithAI } = await import('./src/services/aiGateway.ts');
    const result = await matchCategoriesWithAI([{
      id: 'test-product-1',
      xmlKey: 'test-1',
      title: 'Test Product',
      supplierCategory: 'Test Category',
      xmlBrandName: 'Test Brand',
      description: 'Test description'
    }], new Map([['test-product-1', [
      { id: 'cat-1', name: 'Test Category 1', fullPath: 'Test > Category 1', score: 90 },
      { id: 'cat-2', name: 'Test Category 2', fullPath: 'Test > Category 2', score: 80 }
    ]]]), 'Test Marketplace');
    
    console.log('matchCategoriesWithAI result:', JSON.stringify(result, null, 2));
  } catch (e) {
    console.log('matchCategoriesWithAI error:', e.message);
    console.log(e.stack);
  }
  
  // Test the actual Category AI endpoint via HTTP
  console.log('\n=== Testing actual Category AI endpoint ===');
  try {
    const u = await prisma.user.findFirst({ where: { email: 'admin@dgstok.com' } });
    const token = jwt.sign({ role: u.role, sub: u.id }, 'ySsgOO3P4RiZ8jtu0MBcVYcXNlYn7IWRyZpHhDBs', { expiresIn: '1h' });
    
    const productId = '003deaf2-8dd1-4226-b3c4-0bba83a2b0f4';
    const xmlSourceId = '949855eb-d68c-4920-b378-c622a6a665e2';
    const MP = '757a071c-98c5-4c96-bb8c-2dceac1568dd';
    
    const r = await fetch('http://localhost:4000/categories/ai-match', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({ productIds: [productId], marketplaceId: MP, xmlSourceId: xmlSourceId }),
    });
    
    const raw = await r.text();
    console.log('Category AI endpoint response:', raw);
    
    // Check DB state after
    const after = await prisma.product.findFirst({ where: { id: '003deaf2-8dd1-4226-b3c4-0bba83a2b0f4' }, select: { id: true, xmlKey: true, title: true, categoryMatch: true, aiSuggestedCategoryId: true, aiScore: true, lastMatchDate: true } });
    console.log('DB AFTER - categoryMatch:', after.categoryMatch, '| aiSuggestedCategoryId:', after.aiSuggestedCategoryId, '| aiScore:', after.aiScore, '| lastMatchDate:', after.lastMatchDate);
    
  } catch (e) {
    console.log('HTTP test error:', e.message);
    console.log(e.stack);
  }
  
  await prisma.$disconnect();
  process.exit(0);
}

test().catch(e => {
  console.error('Test error:', e);
  console.error(e.stack);
  process.exit(1);
});