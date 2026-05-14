export function nowIso(): string {
  return new Date().toISOString();
}

export function safeDateIso(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
