/**
 * READ-ONLY PLAN PROBE — 12.100 kategori eşleştirme görevi için mevcut durum ölçümü.
 * YAZMA YOK: yalnızca count / groupBy / findMany / aggregate okur.
 * Match işlemi DB ağacı üzerinde SAF matcher ile RAM'de yapılır; DB değiştirilmez.
 */
import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';
import { matchTrendyolCategoryByPath, normalizeName } from './src/services/categoryBrandMapper.ts';

interface TNode { id: number; name: string; subCategories: TNode[] }

interface TreeRow { id: string; externalId: string | null; name: string; parentId: string | null }

function buildTree(rows: TreeRow[]): TNode[] {
  // Hiyerarşi DB'nin kendi uuid id/parentId çiftiyle kurulur;
  // matcher çıktısı için node.id = Number(externalId) saklanır.
  const byUuid = new Map<string, TNode>();
  for (const r of rows) {
    if (!r.externalId) continue;
    const ext = Number(r.externalId);
    if (!Number.isFinite(ext)) continue;
    byUuid.set(r.id, { id: ext, name: r.name, subCategories: [] });
  }
  const roots: TNode[] = [];
  for (const r of rows) {
    const node = byUuid.get(r.id);
    if (!node) continue;
    if (r.parentId && byUuid.has(r.parentId)) {
      byUuid.get(r.parentId)!.subCategories.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function countLeaves(nodes: TNode[]): number {
  let leaf = 0;
  const walk = (list: TNode[]) => {
    for (const n of list) {
      if (n.subCategories.length === 0) leaf++;
      else walk(n.subCategories);
    }
  };
  walk(nodes);
  return leaf;
}

function detectCycles(rows: TreeRow[]): number {
  const parent = new Map<string, string>();
  for (const r of rows) parent.set(r.id, r.parentId ?? '');
  let cycles = 0;
  for (const start of parent.keys()) {
    const seen = new Set<string>();
    let cur: string | undefined = start;
    while (cur) {
      if (seen.has(cur)) { cycles++; break; }
      seen.add(cur);
      const p = parent.get(cur);
      if (p === undefined || p === '') break;
      cur = p;
    }
  }
  return cycles;
}

async function main() {
  const productTotal = await prisma.product.count();
  const categoryMatchTrue = await prisma.product.count({ where: { categoryMatch: true } });
  const categoryMatchFalse = await prisma.product.count({ where: { categoryMatch: false } });
  const categoryIdNull = await prisma.product.count({ where: { categoryId: null } });
  const categoryIdFilled = await prisma.product.count({ where: { categoryId: { not: null } } });
  const supplierNull = await prisma.product.count({ where: { supplierCategory: null } });
  const supplierFilled = await prisma.product.count({ where: { supplierCategory: { not: null } } });
  const ready = await prisma.product.count({ where: { status: 'READY' } });

  const categoryTotal = await prisma.category.count();
  const categoryReal = await prisma.category.count({ where: { externalId: { not: null } } });
  const categoryLocal = await prisma.category.count({ where: { externalId: null } });
  const categoryParentFilled = await prisma.category.count({ where: { parentId: { not: null } } });

  const mappingTotal = await prisma.categoryMapping.count();
  const mappingTrendyol = await prisma.categoryMapping.count({ where: { marketplaceId: { not: null } } });

  const brandTrue = await prisma.product.count({ where: { brandMatch: true } });
  const brandFalse = await prisma.product.count({ where: { brandMatch: false } });
  const variantPass = await prisma.product.count({ where: { OR: [{ variantMatch: true }, { variantStatus: 'NOT_REQUIRED' }] } });
  const variantFail = await prisma.product.count({ where: { AND: [{ variantMatch: false }, { variantStatus: { not: 'NOT_REQUIRED' } }] } });
  const templateTrue = await prisma.product.count({ where: { templateMatch: true } });
  const templateFalse = await prisma.product.count({ where: { templateMatch: false } });
  const ready4of4 = await prisma.product.count({
    where: {
      status: 'READY', categoryMatch: true, brandMatch: true, templateMatch: true,
      OR: [{ variantMatch: true }, { variantStatus: 'NOT_REQUIRED' }],
    },
  });

  const treeRows = await prisma.category.findMany({
    where: { externalId: { not: null } },
    select: { id: true, externalId: true, name: true, parentId: true },
  });
  const tree = buildTree(treeRows);
  const leafCount = countLeaves(tree);

  // duplicate externalId
  const dupExt = await prisma.category.groupBy({
    by: ['externalId'],
    where: { externalId: { not: null } },
    _count: { id: true },
    having: { id: { _count: { gt: 1 } } },
  });

  // orphan: parentId dolu ama karşılığı yok (uuid id setiyle)
  const allIds = new Set(treeRows.map((r) => r.id));
  const orphan = treeRows.filter((r) => r.parentId !== null && !allIds.has(r.parentId)).length;
  const cycle = detectCycles(treeRows);

  // ==== categoryMatch=false kök neden grupları ====
  const falseGroup = {
    A_supplierNull: await prisma.product.count({ where: { categoryMatch: false, supplierCategory: null } }),
    B_supplierPresent: await prisma.product.count({ where: { categoryMatch: false, supplierCategory: { not: null } } }),
    C_categoryLocal: await prisma.product.count({
      where: { categoryMatch: false, categoryId: { not: null }, category: { externalId: null } },
    }),
    categoryIdRealButFalse: await prisma.product.count({
      where: { categoryMatch: false, categoryId: { not: null }, category: { externalId: { not: null } } },
    }),
  };

  // categoryMatch=false ürünlerde mevcut aktif tt mapping olanlar (existing verified mapping)
  const falseWithExistingMapping = await prisma.product.count({
    where: {
      categoryMatch: false,
      categoryId: { not: null },
      category: { mappings: { some: { marketplaceId: { not: null }, externalId: { not: null }, active: true } } },
    },
  });

  // ==== SAF MATCH SINIFLAMASI (supplierCategory → gerçek ağaç) ====
  const grouped = await prisma.product.groupBy({
    by: ['supplierCategory'],
    where: { categoryMatch: false, supplierCategory: { not: null } },
    _count: { id: true },
    orderBy: { supplierCategory: 'asc' },
  });

  let autoCount = 0;
  let ambiguousCount = 0;
  let notFoundCount = 0;
  const autoPaths: Array<{ path: string; products: number; extId: number | null; name: string | null }> = [];
  const ambiguousPaths: Array<{ path: string; products: number }> = [];
  const notFoundPaths: Array<{ path: string; products: number }> = [];

  for (const g of grouped) {
    const path = String(g.supplierCategory ?? '');
    if (!path.trim()) continue;
    const m = matchTrendyolCategoryByPath(path, tree);
    if (m.status === 'MATCHED') {
      autoCount += g._count.id;
      autoPaths.push({ path, products: g._count.id, extId: m.id, name: m.name });
    } else if (m.status === 'AMBIGUOUS') {
      ambiguousCount += g._count.id;
      ambiguousPaths.push({ path, products: g._count.id });
    } else {
      notFoundCount += g._count.id;
      notFoundPaths.push({ path, products: g._count.id });
    }
  }

  console.log(JSON.stringify({
    product: {
      total: productTotal,
      categoryMatchTrue,
      categoryMatchFalse,
      categoryIdNull,
      categoryIdFilled,
      supplierCategoryNull: supplierNull,
      supplierCategoryFilled: supplierFilled,
      statusREADY: ready,
    },
    category: { total: categoryTotal, realTrendyol: categoryReal, localXml: categoryLocal, parentFilled: categoryParentFilled },
    categoryMapping: { total: mappingTotal, trendyol: mappingTrendyol },
    gates: {
      brandMatchTrue: brandTrue, brandMatchFalse: brandFalse,
      variantPass, variantFail,
      templateMatchTrue: templateTrue, templateMatchFalse: templateFalse,
      ready4of4,
    },
    treeIntegrity: {
      realTotal: treeRows.length,
      leaf: leafCount,
      duplicateExternalId: dupExt.length,
      orphan,
      cycle,
    },
    falseGroup: { ...falseGroup, withExistingVerifiedMapping: falseWithExistingMapping },
    matchClassify: {
      distinctSupplierCategories: grouped.length,
      auto: autoCount,
      ambiguous: ambiguousCount,
      notFound: notFoundCount,
      autoPaths: autoPaths.slice(0, 20),
      ambiguousPaths: ambiguousPaths.slice(0, 10),
      notFoundPaths: notFoundPaths.slice(0, 10),
    },
  }, null, 2));

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});
