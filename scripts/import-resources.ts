/**
 * One-time Excel -> Supabase importer for the `downloads` table.
 *
 * Reads `data/plugins.xlsx`, validates rows, generates unique slugs using the
 * SAME logic as the admin resource actions (see `@/lib/slug` so we don't
 * drift), and inserts new rows through the existing service-role Supabase
 * client (`@/lib/supabase-server` -> `getSupabaseAdmin`).
 *
 * Usage:
 *   npm run import-resources -- --dry-run   # validate only, no DB writes
 *   npm run import-resources                # actually insert
 *
 * Behaviour:
 * - Trims whitespace on every cell.
 * - Ignores rows where both File Name and MediaFire URL are empty.
 * - Requires every MediaFire URL to be a valid https:// URL.
 * - Detects duplicates by MediaFire URL (existing or scheduled this run)
 *   AND by slug collision against the existing DB.
 * - Does NOT create any download_sessions.
 * - Defaults: require_subscribe=true, require_like=true, active=true,
 *   download_count=0.
 * - Never touches existing rows; a duplicate is SKIPPED, never updated.
 */

import path from 'node:path';
import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { generateUniqueSlug, normalizeSlug } from '../src/lib/slug';

type ParsedRow = {
  rowNumber: number; // 1-based including header
  name: string;
  mediafireUrl: string;
  normalizedName: string;
};

type SkippedRow = {
  rowNumber: number;
  name: string;
  reason: string;
};

type ImportCandidate = {
  rowNumber: number;
  name: string;
  mediafireUrl: string;
  slug: string;
};

type Args = {
  dryRun: boolean;
  file: string;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let dryRun = false;
  let file = path.resolve('data/plugins.xlsx');
  for (const a of argv) {
    if (a === '--dry-run') dryRun = true;
    else if (a === '--file' && argv[argv.indexOf(a) + 1]) {
      file = path.resolve(argv[argv.indexOf(a) + 1]!);
    } else if (a.startsWith('--file=')) {
      file = path.resolve(a.slice('--file='.length));
    } else if (a === '--help' || a === '-h') {
      // eslint-disable-next-line no-console
      console.log(
        'Usage: tsx scripts/import-resources.ts [--dry-run] [--file <path-to-xlsx>]'
      );
      process.exit(0);
    }
  }
  return { dryRun, file };
}

function isLikelyHeaderRow(cells: string[]): boolean {
  // We treat a row as a header (skip it) only if the candidate "name" cell is
  // empty and the candidate "url" cell looks like a URL or is empty AND there
  // is no value elsewhere that looks like a URL. Practically: we always skip
  // row #1 because inspection showed the header lives there.
  return false; // skip-handling is done by index, not sniffing, for determinism
}

function normaliseCells(row: unknown[]): string[] {
  return row.map((c) =>
    c === null || c === undefined ? '' : String(c).trim()
  );
}

function isCompletelyEmpty(cells: string[]): boolean {
  // Every meaningful column is empty AND row has no non-whitespace content
  // anywhere. We treat a row with all-empty cells as empty regardless of how
  // wide the sheet is.
  return cells.every((c) => c === '');
}

// Find the file-name + mediafire-URL column indices by header inspection.
// Headers in the workbook are: "File Name", "", "MediaFire URL" (column 2 is
// intentionally blank — it's a "description" column or similar we ignore).
// We match case- and whitespace-insensitively.
function detectColumns(headerRow: string[]): { nameCol: number; urlCol: number } | null {
  const lookup = headerRow.map((h) => h.toLowerCase().replace(/\s+/g, ' ').trim());
  const nameCandidates = ['file name', 'name', 'resource', 'title'];
  const urlCandidates = ['mediafire url', 'mediafire', 'url', 'download url', 'mediafire link'];
  const nameCol = lookup.findIndex((h) => nameCandidates.includes(h));
  const urlCol = lookup.findIndex((h) => urlCandidates.includes(h));
  if (nameCol === -1 || urlCol === -1) return null;
  return { nameCol, urlCol };
}

function validateHttpsUrl(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  if (!raw) return { ok: false, reason: 'Empty MediaFire URL' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'Invalid MediaFire URL' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'MediaFire URL must use https://' };
  }
  if (!url.hostname.includes('mediafire.com')) {
    return { ok: false, reason: 'MediaFire URL must be on mediafire.com' };
  }
  return { ok: true, url: raw };
}

type AdminClient = ReturnType<typeof createClient>;

// Rows we read from Supabase for dedup. We declare a minimal shape because
// the script uses a raw client (no schema generics) and TS would otherwise
// type the result as `never`.
type DownloadRow = {
  slug: string | null;
  mediafire_url: string | null;
  name: string | null;
};

function getAdmin(): AdminClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.'
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function fetchExistingForDedup(admin: AdminClient): Promise<{
  slugs: Set<string>;
  mediafireUrls: Set<string>;
  normalizedNames: Set<string>;
}> {
  // Single pull of the relevant columns. We only consider non-deleted rows
  // for collisions, mirroring the slug uniqueness check in `generateUniqueSlug`.
  // Pull all rows via pagination just in case the table grows beyond 1000.
  const slugs = new Set<string>();
  const mediafireUrls = new Set<string>();
  const normalizedNames = new Set<string>();
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await admin
      .from('downloads')
      .select('slug, mediafire_url, name')
      .is('deleted_at', null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to read downloads: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as unknown as DownloadRow[]) {
      if (r.slug) slugs.add(r.slug);
      if (r.mediafire_url) mediafireUrls.add(r.mediafire_url);
      if (r.name) normalizedNames.add(normalizeSlug(r.name));
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return { slugs, mediafireUrls, normalizedNames };
}

function formatRowReport(rows: SkippedRow[], title: string): void {
  if (rows.length === 0) return;
  // eslint-disable-next-line no-console
  console.log(`\n${title}:`);
  for (const r of rows) {
    const label = r.name ? r.name : '(blank)';
    // eslint-disable-next-line no-console
    console.log(`  Row ${r.rowNumber}\n    ${label}\n    ${r.reason}`);
  }
}

async function main() {
  const { dryRun, file } = parseArgs();
  const mode = dryRun ? 'DRY RUN' : 'REAL';
  // eslint-disable-next-line no-console
  console.log(`\n=== IMPORT ${mode} ===\nFile: ${file}\n`);

  const wb = XLSX.readFile(file);
  const sheetName = wb.SheetNames[0]!;
  const ws = wb.Sheets[sheetName]!;
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
  if (raw.length === 0) {
    // eslint-disable-next-line no-console
    console.log('Spreadsheet is empty. Nothing to do.');
    return;
  }

  const headerRow = normaliseCells(raw[0] ?? []);
  const cols = detectColumns(headerRow);
  if (!cols) {
    throw new Error(
      `Could not detect required columns in sheet "${sheetName}". Headers found: ${JSON.stringify(
        headerRow
      )}. Expected at minimum a "File Name" column and a "MediaFire URL" column.`
    );
  }
  const { nameCol, urlCol } = cols;
  // eslint-disable-next-line no-console
  console.log(
    `Sheet: ${sheetName}\nDetected columns: File Name (col ${nameCol + 1}), MediaFire URL (col ${
      urlCol + 1
    })\n`
  );

  const parsed: ParsedRow[] = [];
  const empties: SkippedRow[] = [];
  for (let i = 1; i < raw.length; i++) {
    const cells = normaliseCells(raw[i] ?? []);
    if (isCompletelyEmpty(cells) || isLikelyHeaderRow(cells)) {
      empties.push({ rowNumber: i + 1, name: '', reason: 'Empty row' });
      continue;
    }
    const name = cells[nameCol] ?? '';
    const url = cells[urlCol] ?? '';
    if (!name) {
      empties.push({ rowNumber: i + 1, name: '', reason: 'Missing File Name' });
      continue;
    }
    parsed.push({
      rowNumber: i + 1,
      name,
      mediafireUrl: url,
      normalizedName: normalizeSlug(name),
    });
  }

  if (parsed.length === 0) {
    // eslint-disable-next-line no-console
    console.log('No data rows found after the header.');
    return;
  }

  // Validate URLs up front.
  const valid: ParsedRow[] = [];
  const invalid: SkippedRow[] = [];
  for (const r of parsed) {
    const v = validateHttpsUrl(r.mediafireUrl);
    if (!v.ok) {
      invalid.push({ rowNumber: r.rowNumber, name: r.name, reason: v.reason });
      continue;
    }
    valid.push(r);
  }

  // Connect to Supabase and pull existing rows for dedup + slug reservation.
  const admin = getAdmin();
  const existing = await fetchExistingForDedup(admin);

  // Track which slugs we plan to use in this run, in addition to DB slugs.
  const reservedSlugs = new Set<string>(existing.slugs);
  const reservedMediafire = new Set<string>(existing.mediafireUrls);
  const reservedNormalizedNames = new Set<string>(existing.normalizedNames);

  const toImport: ImportCandidate[] = [];
  const duplicates: SkippedRow[] = [];

  for (const r of valid) {
    // Duplicate detection — check MediaFire URL first (strong signal) then
    // normalized name. A normalized-name collision on an existing DB row is
    // treated as a duplicate since users searching the admin dashboard by
    // name would see both entries as visually identical.
    const urlAlready = reservedMediafire.has(r.mediafireUrl);
    const nameAlready = reservedNormalizedNames.has(r.normalizedName);

    if (urlAlready && nameAlready) {
      duplicates.push({
        rowNumber: r.rowNumber,
        name: r.name,
        reason: 'Duplicate: same File Name and MediaFire URL already exist in the database.',
      });
      continue;
    }
    if (urlAlready) {
      duplicates.push({
        rowNumber: r.rowNumber,
        name: r.name,
        reason: `Duplicate: MediaFire URL already exists in the database.`,
      });
      continue;
    }
    if (nameAlready) {
      duplicates.push({
        rowNumber: r.rowNumber,
        name: r.name,
        reason: 'Duplicate: a resource with the same (normalized) name already exists.',
      });
      continue;
    }

    // Generate a slug. Use the DB-backed generator so we're guaranteed to
    // avoid colliding with anyone else (including another concurrent runner).
    const slug = await generateUniqueSlug(r.name);
    // In dry run we still want predictable output, but the generator is
    // server-side authoritative — calling it during dry-run is fine because
    // it only reads (doesn't write).
    toImport.push({
      rowNumber: r.rowNumber,
      name: r.name,
      mediafireUrl: r.mediafireUrl,
      slug,
    });
    reservedSlugs.add(slug);
    reservedMediafire.add(r.mediafireUrl);
    reservedNormalizedNames.add(r.normalizedName);
  }

  // Summarize.
  const totalRows = raw.length - 1; // excluding header
  // eslint-disable-next-line no-console
  console.log(
    [
      'Total rows: ' + totalRows,
      'Valid: ' + valid.length,
      'Invalid: ' + invalid.length,
      'Duplicates: ' + duplicates.length,
      'Empty: ' + empties.length,
      'Would import: ' + toImport.length,
    ].join('\n')
  );

  formatRowReport(invalid, 'Invalid rows');
  formatRowReport(duplicates, 'Skipped duplicates');
  formatRowReport(empties.filter((e) => e.reason === 'Missing File Name'), 'Missing name');

  if (toImport.length > 0) {
    // eslint-disable-next-line no-console
    console.log('\nWould insert (first 10):');
    for (const c of toImport.slice(0, 10)) {
      // eslint-disable-next-line no-console
      console.log(`  [row ${c.rowNumber}] ${c.slug}  ::  ${c.name}`);
    }
  }

  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log('\nNo database changes were made.');
    return;
  }

  if (toImport.length === 0) {
    // eslint-disable-next-line no-console
    console.log('\nNothing to import.');
    return;
  }

  // Real import: batch up rows and insert. We DO NOT use a single big
  // multi-row insert because we'd lose granular error reporting; instead we
  // insert in small batches and record per-row success/failure.
  const BATCH = 50;
  let imported = 0;
  let failed = 0;
  const failureRows: SkippedRow[] = [];

  for (let i = 0; i < toImport.length; i += BATCH) {
    const chunk = toImport.slice(i, i + BATCH);
    for (const c of chunk) {
      // The raw createClient returns a non-generic DB; cast through `unknown`
      // so the inline row payload is accepted without redefining the full
      // database schema here.
      const payload = {
        name: c.name,
        slug: c.slug,
        mediafire_url: c.mediafireUrl,
        require_subscribe: true,
        require_like: true,
        active: true,
        download_count: 0,
      } as unknown as Record<string, unknown>;
      const { error } = await admin
        .from('downloads')
        .insert(payload as any);
      if (error) {
        failed++;
        failureRows.push({
          rowNumber: c.rowNumber,
          name: c.name,
          reason: `Insert failed: ${error.message}`,
        });
      } else {
        imported++;
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log('\n=== IMPORT COMPLETE ===');
  // eslint-disable-next-line no-console
  console.log(`Imported: ${imported}`);
  // eslint-disable-next-line no-console
  console.log(`Skipped duplicates: ${duplicates.length}`);
  // eslint-disable-next-line no-console
  console.log(`Invalid: ${invalid.length}`);
  // eslint-disable-next-line no-console
  console.log(`Failed: ${failed}`);

  if (failureRows.length > 0) {
    formatRowReport(failureRows, 'Insert failures');
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('\nImport aborted:', err?.message ?? err);
  process.exitCode = 1;
});
