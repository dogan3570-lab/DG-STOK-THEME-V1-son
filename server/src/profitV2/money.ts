// ============================================================
// PROFIT-V2 (VENDORED) — BigInt cents money helpers
// DG-STOK shared/utils/money'e bağlıdır; dış proje bağımlılığı YOK.
// ============================================================

import { rateToBasisPoints, divRound, INT64_MAX, INT64_MIN } from '../shared/utils/money.ts';

export { rateToBasisPoints, divRound, INT64_MAX, INT64_MIN };

export function rateBps(ratePercent: number): bigint {
  return rateToBasisPoints(ratePercent);
}

export function percentOf(base: bigint, ratePercent: number): bigint {
  if (ratePercent === 0 || base === 0n) return 0n;
  return divRound(base * rateBps(ratePercent), 10000n);
}

export function splitInclusive(grossCents: bigint, ratePercent: number): { netCents: bigint; vatCents: bigint } {
  if (grossCents === 0n || ratePercent <= 0) return { netCents: grossCents, vatCents: 0n };
  const netCents = divRound(grossCents * 10000n, 10000n + rateBps(ratePercent));
  return { netCents, vatCents: grossCents - netCents };
}

export function addVat(netCents: bigint, ratePercent: number): { grossCents: bigint; vatCents: bigint } {
  if (netCents === 0n || ratePercent <= 0) return { grossCents: netCents, vatCents: 0n };
  const vatCents = percentOf(netCents, ratePercent);
  return { grossCents: netCents + vatCents, vatCents };
}

export function normalizeLine(amountCents: bigint, inclusive: boolean, ratePercent: number): { netCents: bigint; vatCents: bigint; grossCents: bigint } {
  const amount = amountCents < 0n ? 0n : amountCents;
  if (inclusive) {
    const s = splitInclusive(amount, ratePercent);
    return { netCents: s.netCents, vatCents: s.vatCents, grossCents: amount };
  }
  const s = addVat(amount, ratePercent);
  return { netCents: amount, vatCents: s.vatCents, grossCents: s.grossCents };
}

export function clampInt64(value: bigint): bigint {
  if (value > INT64_MAX) return INT64_MAX;
  if (value < INT64_MIN) return INT64_MIN;
  return value;
}

export function nonNeg(value: bigint | undefined | null): bigint {
  if (value === undefined || value === null) return 0n;
  return value < 0n ? 0n : value;
}

export function ratioPercent(netProfitCents: bigint, baseCents: bigint): number {
  if (baseCents === 0n) return 0;
  return Number(divRound(netProfitCents * 10000n, baseCents)) / 100;
}
