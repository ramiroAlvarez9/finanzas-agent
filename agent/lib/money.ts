export const DEFAULT_CURRENCY = "ARS";
export const DEFAULT_LOCALE = "es-AR";

const FALLBACK_CURRENCIES = [
  "ARS",
  "USD",
  "EUR",
  "BRL",
  "CLP",
  "UYU",
  "PYG",
  "BOB",
  "PEN",
  "COP",
  "MXN",
  "GBP",
  "CHF",
  "CAD",
  "AUD",
  "JPY",
  "CNY",
];

function readSupportedCurrencies(): Set<string> {
  const intl = Intl as unknown as {
    supportedValuesOf?: (key: string) => string[];
  };
  if (typeof intl.supportedValuesOf === "function") {
    return new Set(intl.supportedValuesOf("currency"));
  }
  return new Set(FALLBACK_CURRENCIES);
}

const SUPPORTED_CURRENCIES = readSupportedCurrencies();
const UNSUPPORTED_CODES = new Set(["XXX", "XTS"]);

export function isSupportedCurrency(value: string): boolean {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return false;
  if (UNSUPPORTED_CODES.has(code)) return false;
  return SUPPORTED_CURRENCIES.has(code);
}

/** Devuelve el código ISO normalizado, o null si no es una moneda válida. */
export function normalizeCurrencyCode(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const code = value.trim().toUpperCase();
  return isSupportedCurrency(code) ? code : null;
}

/** Usa la moneda indicada si es válida; si no, cae a la moneda por defecto. */
export function resolveCurrency(
  value: string | null | undefined,
  fallback: string = DEFAULT_CURRENCY,
): string {
  return (
    normalizeCurrencyCode(value) ??
    normalizeCurrencyCode(fallback) ??
    DEFAULT_CURRENCY
  );
}

/** Cantidad de decimales de la moneda (ARS/USD: 2, CLP/JPY: 0, KWD: 3). */
export function currencyFractionDigits(currency: string): number {
  const code = normalizeCurrencyCode(currency);
  if (!code) {
    throw new Error(`Moneda no soportada: ${currency}`);
  }
  const options = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
  }).resolvedOptions();
  return options.maximumFractionDigits ?? 2;
}

/** Convierte un monto en unidades (12.5) a la unidad mínima (1250). */
export function toMinorUnits(amount: number, currency: string): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("El monto tiene que ser un número positivo.");
  }
  const digits = currencyFractionDigits(currency);
  const minor = Math.round(amount * 10 ** digits);
  if (!Number.isSafeInteger(minor) || minor <= 0) {
    throw new Error("El monto no es válido.");
  }
  return minor;
}

export function fromMinorUnits(minor: number, currency: string): number {
  const digits = currencyFractionDigits(currency);
  return minor / 10 ** digits;
}

/** Formatea una unidad mínima: 1250000 ARS -> "ARS 12.500". */
export function formatMoney(minor: number, currency: string): string {
  const code = resolveCurrency(currency);
  const digits = currencyFractionDigits(code);
  const amount = minor / 10 ** digits;
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    style: "currency",
    currency: code,
    currencyDisplay: "code",
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(amount);
}

/** Formatea un monto en unidades: 12500 ARS -> "ARS 12.500". */
export function formatAmount(amount: number, currency: string): string {
  const code = resolveCurrency(currency);
  return formatMoney(toMinorUnits(amount, code), code);
}
