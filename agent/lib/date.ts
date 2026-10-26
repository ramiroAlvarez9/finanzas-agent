export const DEFAULT_TIMEZONE = "America/Argentina/Buenos_Aires";

export function getUserToday(timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
