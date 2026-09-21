/**
 * ATTRIBUTE AUTO-COMPLETE (APPROACH-B + AI Agent)
 *
 * READY/DB status DEGISTIRILMEZ. Bu servis yalnizca bir urunun EKSIK Trendyol zorunlu
 * attribute'larini:
 *   1) deterministik (baslik/aciklama + gercek Trendyol catalog allowed values)
 *   2) gerekirse AI Agent (mevcut ucretsiz `chatCompletion`, yalniz catalog valueId secimi)
 * ile cozer ve GUVENLI olanlari TrendyolProductAttribute'a yazar. Ardindan
 * evaluateTrendyolSendGate yeniden calistirilir.
 *
 * Uydurma deger YASAK: her zaman gercek catalog valueId'si dogrulanir.
 */
import { prisma } from '../db/prisma.ts';
import { chatCompletion } from './aiGateway.ts';
import { fetchTrendyolCategoryAttributes, fetchTrendyolAttributeValues } from './trendyolCatalog.ts';
import { evaluateTrendyolSendGate } from './sendReadiness.ts';

function fold(s: string): string {
  return String(s || '')
    .replace(/İ/g, 'i').replace(/I/g, 'i').replace(/ı/g, 'i')
    .replace(/Ç/g, 'c').replace(/Ğ/g, 'g').replace(/Ö/g, 'o').replace(/Ş/g, 's').replace(/Ü/g, 'u')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i')
    .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface AttrProposal {
  productId: string;
  categoryExternalId: number;
  attributeId: number;
  attributeName: string;
  valueId: number;
  value: string;
  confidence: number;
  evidence: string;
  source: 'DETERMINISTIC' | 'AI' | 'XML' | 'BUSINESS_RULE' | 'CATALOG_RULE';
  model?: string;
}

export interface ProposeResult {
  productId: string;
  categoryExternalId: number | null;
  missing: string[];
  proposals: AttrProposal[];
  gateEligible: boolean;
  note?: string;
}

async function categoryExternalIdFor(productId: string, marketplaceId: string): Promise<number | null> {
  const p = await prisma.product.findUnique({ where: { id: productId }, select: { categoryId: true } });
  if (!p?.categoryId) return null;
  const m = await prisma.categoryMapping.findFirst({ where: { categoryId: p.categoryId, marketplaceId, active: true, externalId: { not: null } }, select: { externalId: true }, orderBy: { createdAt: 'desc' } });
  const n = m ? Number(m.externalId) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function missingNamesFromGate(gate: { firstFailureCode: string | null; firstFailureMessage: string | null }): string[] {
  if (gate.firstFailureCode !== 'REQUIRED_ATTRIBUTE_MISSING' || !gate.firstFailureMessage) return [];
  const m = /:\s*(.+)$/.exec(gate.firstFailureMessage);
  return m ? m[1].split(',').map(s => s.trim()).filter(Boolean) : [];
}

/** Deterministik: baslik (>=3) veya aciklama (>=4) icinde birebir katalog degeri. */
export async function proposeForProduct(productId: string, marketplaceId: string, opts: { useAI?: boolean; aiMinConfidence?: number } = {}): Promise<ProposeResult> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, title: true, description: true, supplierCategory: true, categoryId: true, brand: { select: { name: true } }, variants: { select: { name: true, value: true }, take: 20 } },
  });
  const out: ProposeResult = { productId, categoryExternalId: null, missing: [], proposals: [], gateEligible: false };
  if (!product) { out.note = 'PRODUCT_NOT_FOUND'; return out; }

  const gateBefore = await evaluateTrendyolSendGate({ productId, marketplaceId, xmlSourceId: (await prisma.product.findUnique({ where: { id: productId }, select: { xmlSourceId: true } }))?.xmlSourceId || '' });
  if (gateBefore.ok) { out.gateEligible = true; return out; }

  const catExt = await categoryExternalIdFor(productId, marketplaceId);
  out.categoryExternalId = catExt;
  if (!catExt) { out.note = 'NO_CATEGORY_MAPPING'; return out; }

  const missing = missingNamesFromGate(gateBefore);
  out.missing = missing;
  if (missing.length === 0) { out.note = gateBefore.firstFailureCode || 'BLOCKED'; return out; }

  const defs = await fetchTrendyolCategoryAttributes(catExt).catch(() => [] as any[]);
  const titleNorm = ` ${fold(product.title || '')} `;
  const descNorm = ` ${fold(product.description || '')} `;

  const unresolved: Array<{ id: number; name: string; vals: Array<{ attributeValueId: number; attributeValue: string }> }> = [];
  for (const name of missing) {
    const def: any = defs.find((d: any) => fold(d.attribute.name) === fold(name));
    if (!def) { out.note = `DEF_NOT_FOUND:${name}`; continue; }
    const vals = await fetchTrendyolAttributeValues(catExt, def.attribute.id, 200).catch(() => [] as any[]);
    const nameF = fold(def.attribute.name);
    const textAll = titleNorm + ' ' + descNorm;
    const monthsOf = (s: string): number => { const t = fold(s); const m = /(\d+)\s*(ay|yil)/.exec(t); if (!m) return 0; return Number(m[1]) * (m[2] === 'yil' ? 12 : 1); };

    // ---- GARANTİ İŞ KURALI (XML değeri kazanır; yoksa deterministik kural) ----
    if (nameF === 'garanti tipi' || nameF === 'garanti suresi') {
      const isTip = nameF === 'garanti tipi';
      const cand = isTip ? vals.filter((v: any) => /garantili/.test(fold(v.attributeValue))) : vals.filter((v: any) => /(\d+)\s*(ay|yil)/.test(fold(v.attributeValue)));
      const inText = cand.filter((v: any) => textAll.includes(` ${fold(v.attributeValue)} `));
      let chosen: any = null; let src: AttrProposal['source'] = 'DETERMINISTIC'; let ev = '';
      if (inText.length === 1) { chosen = inText[0]; src = 'XML'; ev = `XML/metin garanti ${isTip ? 'tipi' : 'süresi'}: "${chosen.attributeValue}"`; }
      else if (inText.length === 0) {
        if (isTip) {
          const ith = vals.find((v: any) => fold(v.attributeValue) === 'ithalatci garantili');
          if (ith) { chosen = ith; src = 'BUSINESS_RULE'; ev = 'XML garanti yok → İthalatçı Garantili'; }
        } else {
          const one = vals.find((v: any) => fold(v.attributeValue).replace(/\s+/g, '') === '1yil');
          if (one) { chosen = one; src = 'CATALOG_RULE'; ev = 'XML süre yok → katalog 1 Yıl'; }
          else { const sorted = cand.map((v: any) => ({ v, m: monthsOf(v.attributeValue) })).filter((x: any) => x.m > 0).sort((a: any, b: any) => a.m - b.m); if (sorted[0]) { chosen = sorted[0].v; src = 'CATALOG_RULE'; ev = `XML süre yok, 1 Yıl katalogda yok → en kısa geçerli: ${sorted[0].v.attributeValue}`; } }
        }
      } // inText.length > 1 → belirsiz → seçme (kullanıcıya bırak)
      if (chosen) { out.proposals.push({ productId, categoryExternalId: catExt, attributeId: def.attribute.id, attributeName: def.attribute.name, valueId: chosen.attributeValueId, value: chosen.attributeValue, confidence: 0.95, evidence: ev, source: src }); continue; }
      unresolved.push({ id: def.attribute.id, name: def.attribute.name, vals }); continue;
    }

    const numericAttr = /parca sayisi|adet|sayfa sayisi|hacim/.test(fold(def.attribute.name));
    const matchesIn = (text: string, minLen: number, allowNumeric: boolean) => vals
      .map((v: any) => ({ v, n: fold(v.attributeValue) }))
      .filter((x: any) => ((x.n.length >= minLen) || (allowNumeric && /^\d+$/.test(x.n))) && text.includes(` ${x.n} `));
    let ms = matchesIn(titleNorm, 3, numericAttr);
    if (ms.length === 0) ms = matchesIn(descNorm, 4, false);
    const uniq = [...new Map(ms.map((m: any) => [m.v.attributeValueId, m])).values()] as any[];
    const match = uniq.length === 1 ? uniq[0] : undefined; // belirsiz (coklu deger) -> otomatik secme
    if (match) {
      out.proposals.push({ productId, categoryExternalId: catExt, attributeId: def.attribute.id, attributeName: def.attribute.name, valueId: match.v.attributeValueId, value: match.v.attributeValue, confidence: 0.95, evidence: `title/desc contains "${match.v.attributeValue}"`, source: 'DETERMINISTIC' });
    } else {
      unresolved.push({ id: def.attribute.id, name: def.attribute.name, vals });
    }
  }

  // AI AGENT — yalniz cozulemeyen attribute'lar icin; yalniz catalog valueId secimi.
  if (opts.useAI && unresolved.length > 0) {
    const catalogBlock = unresolved.map(u => {
      const list = u.vals.slice(0, 80).map(v => `${v.attributeValueId}=${v.attributeValue}`).join(' | ');
      return `- attributeId=${u.id} (${u.name}): ${list}`;
    }).join('\n');
    const prompt = `Trendyol urun ozelliklerini SEC. SADECE asagidaki valueId listelerinden sec. Uydurma. Emin degilsen valueId=null ver.\n\nUrun: ${product.title || ''}\nAciklama: ${(product.description || '').slice(0, 800)}\nKategori: ${product.categoryId || ''}\nMarka: ${product.brand?.name || ''}\n\nEksik ozellikler:\n${catalogBlock}\n\nSADECE JSON dondur: {"items":[{"attributeId":<id>,"valueId":<id|null>,"confidence":<0..1>,"evidence":"<kisa kanit>"}]}`;
    try {
      const ai = await chatCompletion({ messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 700, response_format: { type: 'json_object' } }, 'GENERAL');
      if (ai.ok && ai.content) {
        let parsed: any = null;
        try { parsed = JSON.parse(ai.content); } catch { const s = ai.content.indexOf('{'); const e = ai.content.lastIndexOf('}'); if (s >= 0 && e > s) { try { parsed = JSON.parse(ai.content.slice(s, e + 1)); } catch {} } }
        const items = parsed?.items || [];
        const minConf = opts.aiMinConfidence ?? 0.9;
        const textAll = titleNorm + ' ' + descNorm;
        for (const it of items) {
          if (it?.valueId == null) continue;
          const u = unresolved.find(x => x.id === Number(it.attributeId));
          if (!u) continue;
          const v = u.vals.find(x => Number(x.attributeValueId) === Number(it.valueId));
          if (!v) continue; // catalog'da yok -> REDDET
          const conf = Math.max(0, Math.min(1, Number(it.confidence ?? 0)));
          if (conf < minConf) continue;
          // GROUNDING: secilen deger urun metninde gecmeli (sayisal ise baslikta birebir token)
          const vf = fold(v.attributeValue);
          if (/^\d+$/.test(vf)) { if (!titleNorm.includes(` ${vf} `)) continue; }
          else if (vf.length >= 3) { const flat = textAll.replace(/ /g, ''); if (!(textAll.includes(` ${vf} `) || flat.includes(vf.replace(/ /g, '')))) continue; }
          else continue;
          out.proposals.push({ productId, categoryExternalId: catExt, attributeId: u.id, attributeName: u.name, valueId: v.attributeValueId, value: v.attributeValue, confidence: conf, evidence: String(it.evidence || '').slice(0, 200), source: 'AI', model: ai.model });
        }
      } else {
        out.note = `AI_FAILED:${ai.errorCode || ai.error || 'unknown'}`;
      }
    } catch (e: any) { out.note = 'AI_VERIFY_FAILED:' + (e?.message || 'error'); }
  }

  const gateAfter = await evaluateTrendyolSendGate({ productId, marketplaceId, xmlSourceId: (await prisma.product.findUnique({ where: { id: productId }, select: { xmlSourceId: true } }))?.xmlSourceId || '' });
  out.gateEligible = gateAfter.ok;
  return out;
}

/** Guvenli onerileri kalici yaz (gercek catalog valueId dogrulamasi ile) + audit. */
export async function applyProposals(productId: string, proposals: AttrProposal[], minConfidence = 0.9): Promise<{ applied: number; skipped: number; details: string[] }> {
  let applied = 0, skipped = 0; const details: string[] = [];
  for (const p of proposals) {
    if (!p || p.confidence < minConfidence) { skipped++; continue; }
    const vals = await fetchTrendyolAttributeValues(p.categoryExternalId, p.attributeId, 300).catch(() => [] as any[]);
    const v = vals.find((x: any) => Number(x.attributeValueId) === Number(p.valueId));
    if (!v) { skipped++; details.push(`REDDET ${p.attributeName}: valueId catalog'da yok`); continue; }
    const prev = await prisma.trendyolProductAttribute.findUnique({ where: { productId_marketplaceKey_categoryExternalId_attributeId: { productId, marketplaceKey: 'tt', categoryExternalId: p.categoryExternalId, attributeId: p.attributeId } }, select: { attributeValueId: true, attributeValue: true } }).catch(() => null);
    if (prev && Number(prev.attributeValueId) === Number(p.valueId)) { skipped++; details.push(`SKIP ${p.attributeName}=${p.value} (zaten aynı)`); continue; } // idempotent
    await prisma.trendyolProductAttribute.upsert({
      where: { productId_marketplaceKey_categoryExternalId_attributeId: { productId, marketplaceKey: 'tt', categoryExternalId: p.categoryExternalId, attributeId: p.attributeId } },
      update: { attributeValueId: p.valueId, attributeValue: p.value, source: p.source === 'AI' ? 'ai' : 'auto', confidence: p.confidence, reason: p.evidence },
      create: { productId, marketplaceKey: 'tt', categoryExternalId: p.categoryExternalId, attributeId: p.attributeId, attributeName: p.attributeName, attributeValueId: p.valueId, attributeValue: p.value, source: p.source === 'AI' ? 'ai' : 'auto', confidence: p.confidence, reason: p.evidence },
    });
    await prisma.auditLog.create({ data: { action: 'ATTRIBUTE_AUTOCOMPLETE', entity: 'product', entityId: productId, details: `${p.attributeName}: ${prev?.attributeValue ?? '-'} -> ${p.value} (${p.source}, conf=${p.confidence})`, meta: JSON.stringify({ productId, attributeId: p.attributeId, attributeName: p.attributeName, oldValue: prev?.attributeValue ?? null, newValue: p.value, valueId: p.valueId, source: p.source, model: p.model ?? null, confidence: p.confidence, evidence: p.evidence, at: new Date().toISOString() }) } }).catch(() => null);
    applied++; details.push(`OK ${p.attributeName}=${p.value} (${p.source})`);
  }
  return { applied, skipped, details };
}
