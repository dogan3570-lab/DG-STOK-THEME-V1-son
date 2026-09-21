export const INT64_MAX = 9223372036854775807n;
export const INT64_MIN = -9223372036854775808n;

type DecimalParts = {
  sign: -1 | 1;
  digits: string;
  decimalIndex: number;
};

function parseDecimalParts(amount: number): DecimalParts {
  if (!Number.isFinite(amount)) {
    throw new Error('Invalid amount: not finite');
  }

  const text = String(amount).trim();
  let sign: -1 | 1 = 1;
  let mantissa = text;

  if (mantissa[0] === '-' || mantissa[0] === '+') {
    if (mantissa[0] === '-') sign = -1;
    mantissa = mantissa.slice(1);
  }

  const match = mantissa.match(/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/);
  if (!match) {
    throw new Error('Invalid amount: ' + amount);
  }

  const mantissaText = match[1];
  const exponent = Number(match[2]?.slice(1) || '0');
  const dotIndex = mantissaText.indexOf('.');
  const integerPart = dotIndex === -1 ? mantissaText : mantissaText.slice(0, dotIndex);
  const fractionalPart = dotIndex === -1 ? '' : mantissaText.slice(dotIndex + 1);
  const digits = (integerPart + fractionalPart).replace(/^0+(?=\d)/, '');
  const decimalIndex = integerPart.length + exponent;

  return { sign, digits: digits || '0', decimalIndex };
}

function incrementIntegerString(value: string): string {
  const digits = value.split('');
  let carry = 1;

  for (let index = digits.length - 1; index >= 0 && carry > 0; index -= 1) {
    const current = digits[index] === '9' ? '0' : String(Number(digits[index]) + 1);
    digits[index] = current;
    carry = current === '0' ? 1 : 0;
  }

  if (carry > 0) digits.unshift('1');
  return digits.join('').replace(/^0+/, '') || '0';
}

function decimalToScaledInteger(amount: number, scale: bigint): bigint {
  const scaleText = scale.toString();
  const scaleDigits = scaleText.length - 1;
  const parts = parseDecimalParts(amount);
  const scaledDigits = parts.digits + scaleText.slice(1);
  let decimalIndex = parts.decimalIndex + scaleDigits;

  if (decimalIndex < 0) {
    const leadingZeros = '0'.repeat(-decimalIndex);
    return parts.sign === -1 && BigInt(leadingZeros + scaledDigits) === 0n
      ? 0n
      : BigInt(parts.sign) * BigInt(incrementIntegerString(leadingZeros + scaledDigits));
  }

  const integerPart = scaledDigits.slice(0, decimalIndex) || '0';
  const fractionalPart = scaledDigits.slice(decimalIndex) || '';
  const roundedInteger = Number(fractionalPart[0] || '0') >= 5
    ? incrementIntegerString(integerPart)
    : integerPart;

  return parts.sign === -1 && BigInt(roundedInteger) !== 0n
    ? -BigInt(roundedInteger)
    : BigInt(roundedInteger);
}

export function floatToCents(amount: number): bigint {
  const cents = decimalToScaledInteger(amount, 100n);
  if (cents > INT64_MAX || cents < INT64_MIN) {
    throw new Error('Amount overflow: ' + cents + ' cents exceeds INT64 range');
  }
  return cents;
}

export function parseFloatToCents(amount: number): bigint {
  return floatToCents(amount);
}

export function centsToFloat(cents: bigint): number {
  return Number(cents) / 100;
}

export function serializeCents(cents: bigint): string {
  return cents.toString();
}

export function formatCents(cents: bigint, currency: string = 'TRY'): string {
  const sign = cents < 0n ? '-' : '';
  const absoluteValue = cents < 0n ? -cents : cents;
  const major = absoluteValue / 100n;
  const minor = absoluteValue % 100n;
  return `${sign}${major}.${minor.toString().padStart(2, '0')} ${currency}`;
}

export function checkInt64Range(cents: bigint): void {
  if (cents > INT64_MAX || cents < INT64_MIN) {
    throw new Error('Amount overflow: ' + cents + ' cents exceeds INT64 range');
  }
}

export function rateToBasisPoints(rate: number): bigint {
  const basisPoints = decimalToScaledInteger(rate, 100n);
  if (basisPoints < -9223372036854775807n || basisPoints > 9223372036854775807n) {
    throw new Error('Rate overflow: ' + basisPoints + ' basis points exceeds supported range');
  }
  return basisPoints;
}

export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n;
  const isNegative = (numerator < 0n) !== (denominator < 0n);
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = (absoluteNumerator + absoluteDenominator / 2n) / absoluteDenominator;
  return isNegative ? -quotient : quotient;
}

export function calculateMargin(netProfit: bigint, netSales: bigint): number {
  if (netSales === 0n) return 0;
  return Number((netProfit * 10000n) / netSales) / 100;
}

export function calculateROI(netProfit: bigint, productCost: bigint): number {
  if (productCost === 0n) return 0;
  return Number((netProfit * 10000n) / productCost) / 100;
}
