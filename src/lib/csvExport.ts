// Minimal CSV export — good enough for handing a shift's entries to
// an accountant without needing a server-side export endpoint.
export function buildCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';

  const headers = Object.keys(rows[0]);
  const escape = (value: unknown): string => {
    let s = value === null || value === undefined ? '' : String(value);
    // Treat untrusted text as text when opened in spreadsheet software.
    if (typeof value === 'string' && /^[\s]*[=+@-]/.test(s)) s = `'${s}`;
    // Quote any field containing a comma, quote, or newline — the
    // three characters that break naive CSV parsing.
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ];
  return '\uFEFF' + lines.join('\r\n');
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (!rows.length) return;
  const blob = new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
