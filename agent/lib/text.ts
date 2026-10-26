/** Normaliza texto para búsquedas: minúsculas, sin acentos y sin signos. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Recorta un texto sin cortar palabras de forma brusca. */
export function truncate(value: string, maxLength: number): string {
  const clean = value.trim().replace(/\s+/g, " ");
  if (clean.length <= maxLength) return clean;
  const cut = Math.max(0, maxLength - 1);
  return `${clean.slice(0, cut).trimEnd()}…`;
}
