export function minutesAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return 'No recent report';
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return 'Updated ' + minutes + ' min ago';
  const hours = Math.round(minutes / 60);
  return 'Updated ' + hours + (hours === 1 ? ' hr ago' : ' hrs ago');
}

export function money(value: number | null, currency = 'CAD'): string {
  if (value === null || !Number.isFinite(value)) return 'Price unknown';
  return new Intl.NumberFormat('en-CA', {style: 'currency', currency}).format(value);
}

export function localTime(value: string): string {
  return new Intl.DateTimeFormat('en-CA', {hour: 'numeric', minute: '2-digit'}).format(new Date(value));
}
