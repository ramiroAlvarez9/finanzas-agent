export type Period =
  | "today"
  | "week"
  | "month"
  | "last_month"
  | "year"
  | "custom";

export interface DateRange {
  readonly from: string;
  readonly to: string;
  readonly label: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = toUtcDate(value);
  return Number.isFinite(date.getTime()) && toIsoDate(date) === value;
}

export function addDays(iso: string, days: number): string {
  const date = toUtcDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

export function isFutureDate(iso: string, today: string): boolean {
  return iso > today;
}

export function startOfWeek(iso: string): string {
  const date = toUtcDate(iso);
  const day = date.getUTCDay(); // 0 = domingo
  const offset = (day + 6) % 7; // lunes = 0
  return addDays(iso, -offset);
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonth(iso: string): string {
  const [year, month] = iso.split("-").map(Number);
  return toIsoDate(new Date(Date.UTC(year, month, 0)));
}

export function formatShortDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

export function formatMonthLabel(iso: string): string {
  const label = new Intl.DateTimeFormat("es-AR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(toUtcDate(`${startOfMonth(iso).slice(0, 8)}01`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatWeekdayDate(iso: string): string {
  const weekday = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    timeZone: "UTC",
  }).format(toUtcDate(iso));
  return `${weekday} ${formatShortDate(iso)}`;
}

/** Etiqueta humana para la tarjeta de confirmación. */
export function formatDateHuman(iso: string, today: string): string {
  const short = formatShortDate(iso);
  if (iso === today) return `hoy (${short})`;
  if (iso === addDays(today, -1)) return `ayer (${short})`;
  const sixDaysAgo = addDays(today, -6);
  if (iso >= sixDaysAgo && iso < today) {
    return formatWeekdayDate(iso);
  }
  return short;
}

export function getPeriodRange(
  period: Exclude<Period, "custom">,
  today: string,
): DateRange {
  switch (period) {
    case "today":
      return { from: today, to: today, label: "Hoy" };
    case "week": {
      const from = startOfWeek(today);
      const to = addDays(from, 6);
      return {
        from,
        to,
        label: `Semana del ${formatShortDate(from).slice(0, 5)} al ${formatShortDate(to).slice(0, 5)}`,
      };
    }
    case "month": {
      const from = startOfMonth(today);
      const to = endOfMonth(today);
      return { from, to, label: formatMonthLabel(today) };
    }
    case "last_month": {
      const previousMonthDay = addDays(startOfMonth(today), -1);
      const from = startOfMonth(previousMonthDay);
      const to = endOfMonth(previousMonthDay);
      return { from, to, label: formatMonthLabel(previousMonthDay) };
    }
    case "year": {
      const year = today.slice(0, 4);
      return {
        from: `${year}-01-01`,
        to: `${year}-12-31`,
        label: `Año ${year}`,
      };
    }
  }
}

export function getCustomRange(from: string, to: string): DateRange {
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
    throw new Error("Las fechas tienen que tener formato YYYY-MM-DD.");
  }
  if (from > to) {
    throw new Error("La fecha desde no puede ser posterior a la fecha hasta.");
  }
  return {
    from,
    to,
    label:
      from === to
        ? formatShortDate(from)
        : `Del ${formatShortDate(from)} al ${formatShortDate(to)}`,
  };
}

