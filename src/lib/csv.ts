/**
 * One CSV cell. Text that a spreadsheet would run as a formula (starting with
 * =, +, -, @, tab or carriage return) gets a leading apostrophe so Excel and
 * Google Sheets show it as text; then the cell is quoted when needed.
 */
export function csvCell(value: unknown) {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
