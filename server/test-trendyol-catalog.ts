import { fetchTrendyolCategoryAttributes } from './src/services/trendyolCatalog.ts';

async function main() {
  // Get the category externalId from categoryMapping for a test product
  // Let's use category 1476 (Pisirme Kagidi ve Torbasi) which we saw in category results
  const result = await fetchTrendyolCategoryAttributes(1476);
  console.log('fetchTrendyolCategoryAttributes(1476):', JSON.stringify(result, null, 2));
}

main().catch(console.error);