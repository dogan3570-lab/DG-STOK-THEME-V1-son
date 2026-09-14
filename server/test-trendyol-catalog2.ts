import { catalogGet } from './src/services/trendyolCatalog.ts';

async function main() {
  // Test the raw API call
  const result = await catalogGet('/product/categories/1476/attributes');
  console.log('catalogGet result:', JSON.stringify(result, null, 2));
}

main().catch(console.error);