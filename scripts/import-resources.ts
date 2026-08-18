/**
 * Freat Editz — Excel bulk importer
 *
 * Usage (drives package.json npm scripts):
 *   tsx scripts/import-resources.ts windows [--dry-run]
 *   tsx scripts/import-resources.ts mac     [--dry-run]
 *   tsx scripts/import-resources.ts all     [--dry-run]
 *   tsx scripts/import-resources.ts summary
 *
 * Each command inspects data/<platform>/<platform>.xlsx in this order:
 *   1. data/<platform>/<platform>.xlsx          (per spec)
 *   2. data/<platform>/plugins.xlsx             (legacy fallback, the file
 *      that was around before the per-platform split)
 *
 * Detects the "File Name" + "MediaFire URL" columns from the header row —
 * never assumes positional placement because some sheets carry a description
 * column in between.
 *
 * Importer guarantees:
 * - Idempotent. Re-running NEVER duplicates — detection looks at MediaFire
 *   URL on the same platform, and at normalized name + same platform.
 * - A Windows resource and a Mac resource with the same name are NOT
 *   considered duplicates (they live on opposite platforms).
 * - V1 security architecture is untouched. Resources go through the same
 *   `supabase` admin client the rest of the app uses. Sessions are never
 *   created. YouTube URLs are global env vars, not per-row.
 * - Counterpart matching runs only in `all` mode, AFTER both platforms
 *   have been inserted. Windows ↔ Mac is set symmetrically via the existing
 *   atomic `link_counterparts` RPC; the script falls back to two updates if
 *   the RPC is not installed (it's defined in
 *   supabase/migrations/20260818000002_counterpart_rpcs.sql).
 * - Ambiguous counterpart matches are NEVER auto-linked. They are reported
 *   in a "needs review" section and left to a human.
 */

import path from 'node:path';
import XLSX from 'xlsx';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { generateUniqueSlug, normalizeSlug } from '../src/lib/slug';
import type { Platform } from '../src/lib/validations';

// ---------- CLI parsing ----------

type Mode = 'windows' | 'mac' | 'all' | 'summary';
type CliArgs = {
  mode: Mode;
  dryRun: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const positional = argv.filter((a) => !a.startsWith('--') && a !== '');
  const flags = argv.filter((a) => a.startsWith('--'));
  const mode = (positional[0] ?? 'all') as Mode;
  if (!['windows', 'mac', 'all', 'summary'].includes(mode)) {
    throw new Error(
      `Unknown mode "${mode}". Expected one of: windows | mac | all | summary`
    );
  }
  const dryRun = flags.includes('--dry-run');
  return { mode, dryRun };
}

// ---------- File resolution ----------

type ResolvedXlsx =
  | { kind: 'ok'; path: string }
  | { kind: 'none'; dir: string }
  | { kind: 'multiple'; dir: string; files: string[] };

// Discover the .xlsx file inside data/<platform>/. We do not care about
// the filename itself — exactly one .xlsx per folder is the rule. Zero or
// multiple files are surfaced as distinct error kinds so the caller can
// print a tailored message and (in the multiple-files case) refuse to
// proceed at all.
function resolveXlsx(platform: Platform): ResolvedXlsx {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as typeof import('node:fs');
  const dir = path.resolve(`data/${platform}`);
  if (!fs.existsSync(dir)) {
    return { kind: 'none', dir };
  }
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    throw new Error(`Unable to read ${dir}: ${(err as Error).message}`);
  }
  const xlsxFiles = entries
    .filter((f) => f.toLowerCase().endsWith('.xlsx'))
    // Filter macOS metadata sidecars that Excel occasionally drops in the
    // same folder but are not real workbooks.
    .filter((f) => !f.startsWith('~$'))
    .sort();
  if (xlsxFiles.length === 0) return { kind: 'none', dir };
  if (xlsxFiles.length === 1) return { kind: 'ok', path: path.join(dir, xlsxFiles[0]!) };
  return { kind: 'multiple', dir, files: xlsxFiles };
}

function describeResolved(resolved: ResolvedXlsx): string {
  if (resolved.kind === 'ok') return resolved.path;
  if (resolved.kind === 'none') return `${resolved.dir}/ (no .xlsx found)`;
  return `${resolved.dir}/ (multiple .xlsx found: ${resolved.files.join(', ')})`;
}

// ---------- Column detection ----------

type SheetLayout = {
  nameCol: number;
  urlCol: number;
  headers: string[];
};

function detectColumns(headerRow: string[]): SheetLayout | null {
  const lookup = headerRow.map((h) => h.toLowerCase().replace(/\s+/g, ' ').trim());
  const nameCandidates = ['file name', 'name', 'resource', 'title'];
  const urlCandidates = ['mediafire url', 'mediafire', 'url', 'download url', 'mediafire link'];
  const nameCol = lookup.findIndex((h) => nameCandidates.includes(h));
  const urlCol = lookup.findIndex((h) => urlCandidates.includes(h));
  if (nameCol === -1 || urlCol === -1) return null;
  return { nameCol, urlCol, headers: headerRow };
}

// ---------- URL validation ----------

function validateMediafireUrl(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  if (!raw) return { ok: false, reason: 'Empty MediaFire URL' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'Malformed URL' };
  }
  // Reject all non-http(s) schemes, including dangerous ones we'd otherwise
  // rely on prefix matching to spot. (e.g. javascript:data:file:)
  if (url.protocol !== 'https:') {
    return {
      ok: false,
      reason: url.protocol === 'http:'
        ? 'MediaFire URL must use https://'
        : `Disallowed URL scheme "${url.protocol.replace(':', '')}"`,
    };
  }
  if (!url.hostname.includes('mediafire.com')) {
    return { ok: false, reason: 'URL is not on mediafire.com' };
  }
  return { ok: true, url: raw };
}

// ---------- Database reading ----------

type DownloadRow = {
  id: string;
  slug: string | null;
  mediafire_url: string | null;
  name: string | null;
  platform: Platform | null;
};

function getAdmin(): SupabaseClient {
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

async function fetchExistingForDedup(
  admin: SupabaseClient,
  platform?: Platform
): Promise<{
  rows: DownloadRow[];
  mediafireByPlatform: Map<Platform, Set<string>>;
  normalizedNameByPlatform: Map<Platform, Set<string>>;
  slugs: Set<string>;
}> {
  const rows: DownloadRow[] = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    let q = admin
      .from('downloads')
      .select('id, slug, mediafire_url, name, platform')
      .is('deleted_at', null)
      .range(from, from + PAGE - 1);
    if (platform) q = q.eq('platform', platform);
    const { data, error } = await q;
    if (error) throw new Error(`Failed to read downloads: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as DownloadRow[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  const mediafireByPlatform = new Map<Platform, Set<string>>();
  const normalizedNameByPlatform = new Map<Platform, Set<string>>();
  const slugs = new Set<string>();
  for (const r of rows) {
    if (r.platform !== 'windows' && r.platform !== 'mac') continue;
    if (!mediafireByPlatform.has(r.platform)) mediafireByPlatform.set(r.platform, new Set());
    if (!normalizedNameByPlatform.has(r.platform)) normalizedNameByPlatform.set(r.platform, new Set());
    if (r.mediafire_url) mediafireByPlatform.get(r.platform)!.add(r.mediafire_url);
    if (r.name) normalizedNameByPlatform.get(r.platform)!.add(normalizeSlug(r.name));
    if (r.slug) slugs.add(r.slug);
  }
  return { rows, mediafireByPlatform, normalizedNameByPlatform, slugs };
}

// ---------- Excel reading ----------

type ParsedRow = {
  rowNumber: number; // 1-based including header
  name: string;
  mediafireUrl: string;
};

type InvalidRow = {
  rowNumber: number;
  name: string;
  reason: string;
};

function parseWorkbook(file: string): { sheetName: string; layout: SheetLayout | null; rows: ParsedRow[] } {
  const wb = XLSX.readFile(file);
  const sheetName = wb.SheetNames[0]!;
  const ws = wb.Sheets[sheetName]!;
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });

  const headerRow = (raw[0] ?? []).map((c) => String(c ?? '').trim());
  const layout = detectColumns(headerRow);

  const rows: ParsedRow[] = [];
  for (let i = 1; i < raw.length; i++) {
    const cells = (raw[i] ?? []).map((c) => String(c ?? '').trim());
    if (cells.every((c) => c === '')) continue;
    const name = layout ? (cells[layout.nameCol] ?? '') : '';
    const url = layout ? (cells[layout.urlCol] ?? '') : '';
    rows.push({ rowNumber: i + 1, name, mediafireUrl: url });
  }
  return { sheetName, layout, rows };
}

// ---------- Counterpart matching ----------

// Build a "match key" suitable for joining Windows ↔ Mac rows. We strip
// obvious platform words from the END of the name. We DO NOT remove
// platform words that appear inside a product name — that's how this stays
// safe for cases like "Macrium Reflect" (a real Windows backup product).
const PLATFORM_TAIL_WORDS = new Set([
  'windows',
  'win',
  'win64',
  'win32',
  'mac',
  'macos',
  'osx',
  'mac edition',
  'windows edition',
  'win edition',
  'mac version',
  'windows version',
  'win version',
]);

function matchKey(rawName: string): string {
  let s = rawName.toLowerCase();
  // Normalise separators — collapse spaces, underscores, hyphens so we can
  // tokenise consistently.
  s = s.replace(/[\s_\-]+/g, ' ').trim();
  // Strip trailing platform tokens one at a time (in case there are several,
  // e.g. "AE 2023 Mac Windows"). Words INSIDE the product name are left
  // alone (no greedy removal).
  const tokens = s.split(' ');
  while (tokens.length > 0) {
    const last = tokens[tokens.length - 1]!;
    if (PLATFORM_TAIL_WORDS.has(last)) {
      tokens.pop();
      continue;
    }
    // Strip a trailing "for windows" / "for mac" / "for macos" style tail.
    if (tokens.length >= 2) {
      const two = tokens.slice(-2).join(' ');
      if (two === 'for windows' || two === 'for mac' || two === 'for macos' || two === 'for osx' || two === 'for win') {
        tokens.length = tokens.length - 2;
        continue;
      }
    }
    break;
  }
  return tokens.join(' ').trim();
}

// ---------- Reporting ----------

function reportInvalid(label: string, rows: InvalidRow[]): void {
  if (rows.length === 0) return;
  // eslint-disable-next-line no-console
  console.log(`\n${label}:`);
  for (const r of rows) {
    const label = r.name ? r.name : '(blank)';
    // eslint-disable-next-line no-console
    console.log(`  Row ${r.rowNumber}\n    ${label}\n    ${r.reason}`);
  }
}

function reportAmbiguous(groups: Array<{ key: string; wins: string[]; macs: string[] }>): void {
  if (groups.length === 0) return;
  // eslint-disable-next-line no-console
  console.log(`\nAmbiguous counterpart matches (${groups.length}) — left for manual review:`);
  for (const g of groups) {
    // eslint-disable-next-line no-console
    console.log(`\n  Key: "${g.key}"`);
    // eslint-disable-next-line no-console
    console.log(`    Windows:`);
    for (const w of g.wins) console.log(`      • ${w}`);
    // eslint-disable-next-line no-console
    console.log(`    Mac:`);
    for (const m of g.macs) console.log(`      • ${m}`);
  }
}

function reportUnmatched(platform: Platform, names: string[]): void {
  if (names.length === 0) return;
  // eslint-disable-next-line no-console
  console.log(`\n${platform === 'windows' ? 'Windows' : 'Mac'} resources with no counterpart on the other platform:`);
  for (const n of names) console.log(`  • ${n}`);
}

// ---------- Main per-platform pass ----------

type InsertPlan = {
  rowNumber: number;
  name: string;
  mediafireUrl: string;
  slug: string;
};

type PlatformReport = {
  platform: Platform;
  resolution: ResolvedXlsx;
  sheetName: string;
  columnsDetected: boolean;
  headersSeen: string[];
  totalDataRows: number;
  valid: number;
  invalid: InvalidRow[];
  duplicates: InvalidRow[];
  toInsert: InsertPlan[];
};

async function processPlatform(
  admin: SupabaseClient | null,
  platform: Platform,
  dryRun: boolean
): Promise<PlatformReport> {
  const resolution = resolveXlsx(platform);
  const report: PlatformReport = {
    platform,
    resolution,
    sheetName: '',
    columnsDetected: false,
    headersSeen: [],
    totalDataRows: 0,
    valid: 0,
    invalid: [],
    duplicates: [],
    toInsert: [],
  };

  // Non-ok resolutions bail out early; we surface them in the per-run
  // section without trying to read a workbook.
  if (resolution.kind !== 'ok') return report;

  const parsed = parseWorkbook(resolution.path);
  report.sheetName = parsed.sheetName;
  if (!parsed.layout) {
    report.headersSeen = [];
    return report;
  }
  report.columnsDetected = true;
  report.headersSeen = parsed.layout.headers;
  report.totalDataRows = parsed.rows.length;

  // Dedup DB lookup is skipped in dry-run (we never want a dry run to make
  // any DB call), but we still maintain in-memory dedup so the dry-run
  // report reflects what would happen on a clean DB.
  let dbMediafire = new Set<string>();
  let dbNames = new Set<string>();
  if (admin) {
    const result = await fetchExistingForDedup(admin, platform);
    dbMediafire = result.mediafireByPlatform.get(platform) ?? new Set<string>();
    dbNames = result.normalizedNameByPlatform.get(platform) ?? new Set<string>();
  }

  // Running sets that also include rows we're about to insert THIS run, so
  // we never duplicate within a single import either.
  const runMediafire = new Set<string>(dbMediafire);
  const runNames = new Set<string>(dbNames);

  for (const r of parsed.rows) {
    const v = validateMediafireUrl(r.mediafireUrl);
    if (!v.ok) {
      report.invalid.push({ rowNumber: r.rowNumber, name: r.name, reason: v.reason });
      continue;
    }
    if (!r.name) {
      report.invalid.push({ rowNumber: r.rowNumber, name: '', reason: 'Missing File Name' });
      continue;
    }
    // Dedup against DB + this run on (platform, MediaFire URL) and
    // (platform, normalised name).
    if (runMediafire.has(v.url)) {
      report.duplicates.push({
        rowNumber: r.rowNumber,
        name: r.name,
        reason: `Duplicate: a ${platform} resource with this MediaFire URL already exists.`,
      });
      continue;
    }
    const norm = normalizeSlug(r.name);
    if (runNames.has(norm)) {
      report.duplicates.push({
        rowNumber: r.rowNumber,
        name: r.name,
        reason: `Duplicate: a ${platform} resource with the same (normalized) name already exists.`,
      });
      continue;
    }

    report.valid += 1;

    if (dryRun) {
      // In dry-run we still predict a slug so it shows up in the report.
      // We do NOT call the DB here — instead we generate the suffix locally.
      const crypto = await import('node:crypto');
      const suffix = crypto.randomBytes(3).toString('hex');
      const base = normalizeSlug(r.name) || 'resource';
      report.toInsert.push({
        rowNumber: r.rowNumber,
        name: r.name,
        mediafireUrl: v.url,
        slug: `${base}-${suffix}`,
      });
    } else {
      const slug = await generateUniqueSlug(r.name);
      report.toInsert.push({
        rowNumber: r.rowNumber,
        name: r.name,
        mediafireUrl: v.url,
        slug,
      });
    }

    runMediafire.add(v.url);
    runNames.add(norm);
  }
  return report;
}

// ---------- Bulk insert ----------

async function bulkInsert(admin: SupabaseClient, platform: Platform, plan: InsertPlan[]): Promise<{
  imported: number;
  failed: InvalidRow[];
}> {
  if (plan.length === 0) return { imported: 0, failed: [] };
  const BATCH = 50;
  const failed: InvalidRow[] = [];
  let imported = 0;
  for (let i = 0; i < plan.length; i += BATCH) {
    const chunk = plan.slice(i, i + BATCH);
    // Build the multi-row insert payload once, with platform per row.
    const payload = chunk.map((c) => ({
      name: c.name,
      slug: c.slug,
      mediafire_url: c.mediafireUrl,
      platform,
      require_subscribe: true,
      require_like: true,
      active: true,
      download_count: 0,
    }));
    const { data, error } = await admin
      .from('downloads')
      .insert(payload as any)
      .select('id, slug');
    if (error) {
      // Batch failed — fall back to per-row insert so a single bad row
      // doesn't sink the rest. Errors land in `failed` for reporting.
      for (const c of chunk) {
        const single = await admin.from('downloads').insert({
          name: c.name,
          slug: c.slug,
          mediafire_url: c.mediafireUrl,
          platform,
          require_subscribe: true,
          require_like: true,
          active: true,
          download_count: 0,
        } as any);
        if (single.error) {
          failed.push({
            rowNumber: c.rowNumber,
            name: c.name,
            reason: `Insert failed: ${single.error.message}`,
          });
        } else {
          imported += 1;
        }
      }
      continue;
    }
    // Success — count as many as were inserted.
    imported += (data?.length ?? chunk.length);
  }
  return { imported, failed };
}

// ---------- Counterpart matching ----------

type Candidate = { id: string; name: string; slug: string; matchKey: string };

async function buildCandidates(
  admin: SupabaseClient,
  platform: Platform
): Promise<Candidate[]> {
  const { data } = await admin
    .from('downloads')
    .select('id, name, slug, platform, counterpart_id')
    .eq('platform', platform)
    .is('deleted_at', null);
  return ((data ?? []) as Array<{
    id: string;
    name: string;
    slug: string;
    platform: Platform;
    counterpart_id: string | null;
  }>).map((r) => ({ id: r.id, name: r.name, slug: r.slug, matchKey: matchKey(r.name) }));
}

async function linkCounterparts(admin: SupabaseClient, aId: string, bId: string): Promise<string | null> {
  const rpc = await admin.rpc('link_counterparts', { a: aId, b: bId });
  if (!rpc.error) return null;
  // Fallback: two updates. Mismatched state is recovered on the next run.
  const e1 = await admin.from('downloads').update({ counterpart_id: bId }).eq('id', aId);
  if (e1.error) return e1.error.message;
  const e2 = await admin.from('downloads').update({ counterpart_id: aId }).eq('id', bId);
  if (e2.error) return e2.error.message;
  return null;
}

async function runCounterpartMatch(
  admin: SupabaseClient,
  dryRun: boolean,
  wins: Candidate[],
  macs: Candidate[]
): Promise<{
  matched: number;
  ambiguous: Array<{ key: string; wins: string[]; macs: string[] }>;
  unmatchedWindows: string[];
  unmatchedMac: string[];
}> {
  // Group by match key on each side.
  const winByKey = new Map<string, Candidate[]>();
  const macByKey = new Map<string, Candidate[]>();
  for (const w of wins) {
    if (!winByKey.has(w.matchKey)) winByKey.set(w.matchKey, []);
    winByKey.get(w.matchKey)!.push(w);
  }
  for (const m of macs) {
    if (!macByKey.has(m.matchKey)) macByKey.set(m.matchKey, []);
    macByKey.get(m.matchKey)!.push(m);
  }

  let matched = 0;
  const ambiguous: Array<{ key: string; wins: string[]; macs: string[] }> = [];
  const unmatchedWindows: string[] = [];
  const unmatchedMac: string[] = [];

  // Track which rows get paired so we can report unmatched on each side.
  const pairedWindows = new Set<string>();
  const pairedMacs = new Set<string>();

  for (const entry of Array.from(winByKey.entries())) {
    const key = entry[0];
    const winList = entry[1];
    const macList = macByKey.get(key) ?? [];
    if (winList.length === 0 || macList.length === 0) continue;
    if (winList.length === 1 && macList.length === 1) {
      // Safe 1:1 match.
      const w = winList[0]!;
      const m = macList[0]!;
      pairedWindows.add(w.id);
      pairedMacs.add(m.id);
      if (!dryRun) {
        const err = await linkCounterparts(admin, w.id, m.id);
        if (err) {
          // Don't throw — count as unmatched and surface in the report.
          unmatchedWindows.push(`${w.name} (link failed: ${err})`);
          continue;
        }
      }
      matched += 1;
    } else {
      // Ambiguous: multiple rows on at least one side share the same key.
      // We never auto-link.
      ambiguous.push({
        key,
        wins: winList.map((c: Candidate) => c.name),
        macs: macList.map((c: Candidate) => c.name),
      });
    }
  }

  for (const w of wins) {
    if (!pairedWindows.has(w.id) && !ambiguous.some((a) => a.wins.includes(w.name))) {
      unmatchedWindows.push(w.name);
    }
  }
  for (const m of macs) {
    if (!pairedMacs.has(m.id) && !ambiguous.some((a) => a.macs.includes(m.name))) {
      unmatchedMac.push(m.name);
    }
  }

  return { matched, ambiguous, unmatchedWindows, unmatchedMac };
}

// ---------- Top-level runners ----------

async function runSummary(): Promise<void> {
  for (const platform of ['windows', 'mac'] as Platform[]) {
    const resolution = resolveXlsx(platform);
    // eslint-disable-next-line no-console
    console.log(`\n=== ${platform.toUpperCase()} ===`);

    if (resolution.kind === 'none') {
      // eslint-disable-next-line no-console
      console.log(`No Excel file found in ${resolution.dir}/`);
      continue;
    }
    if (resolution.kind === 'multiple') {
      // eslint-disable-next-line no-console
      console.log(`Multiple Excel files found:`);
      for (const f of resolution.files) {
        // eslint-disable-next-line no-console
        console.log(`  * ${f}`);
      }
      // eslint-disable-next-line no-console
      console.log(`Please keep only one file or specify which file to use.`);
      continue;
    }

    const parsed = parseWorkbook(resolution.path);
    // eslint-disable-next-line no-console
    console.log(`Sheet: ${parsed.sheetName}`);
    // eslint-disable-next-line no-console
    console.log(`Path:  ${resolution.path}`);
    if (!parsed.layout) {
      // eslint-disable-next-line no-console
      console.log(`Columns not detected. Headers found: ${JSON.stringify(parsed.rows)}`);
      continue;
    }
    // eslint-disable-next-line no-console
    console.log(`Headers: ${JSON.stringify(parsed.layout.headers)}`);
    let invalidCount = 0;
    for (const r of parsed.rows) {
      const v = validateMediafireUrl(r.mediafireUrl);
      if (!v.ok || !r.name) invalidCount += 1;
    }
    // eslint-disable-next-line no-console
    console.log(`Total data rows: ${parsed.rows.length}`);
    // eslint-disable-next-line no-console
    console.log(`Valid:  ${parsed.rows.length - invalidCount}`);
    // eslint-disable-next-line no-console
    console.log(`Invalid: ${invalidCount}`);
  }
}

async function runSinglePlatform(mode: 'windows' | 'mac', dryRun: boolean): Promise<void> {
  const admin: SupabaseClient | null = dryRun ? null : getAdmin();
  const platform: Platform = mode;
  const report = await processPlatform(admin, platform, dryRun);

  // eslint-disable-next-line no-console
  console.log(`\n=== ${dryRun ? 'DRY RUN' : 'REAL'} — ${platform.toUpperCase()} ===`);
  // eslint-disable-next-line no-console
  console.log(`File: ${describeResolved(report.resolution)}`);

  if (report.resolution.kind === 'none') {
    // eslint-disable-next-line no-console
    console.log(`No Excel file found in ${report.resolution.dir}/ — nothing to do.`);
    return;
  }
  if (report.resolution.kind === 'multiple') {
    // eslint-disable-next-line no-console
    console.log('\nMultiple Excel files found:');
    for (const f of report.resolution.files) {
      // eslint-disable-next-line no-console
      console.log(`  * ${f}`);
    }
    // eslint-disable-next-line no-console
    console.log(
      '\nPlease keep only one file or specify which file to use.\nNot importing anything.'
    );
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`Sheet: ${report.sheetName}`);
  // eslint-disable-next-line no-console
  console.log(`Columns: ${report.columnsDetected ? 'detected' : 'NOT detected'}`);
  if (!report.columnsDetected) {
    // eslint-disable-next-line no-console
    console.log(`Headers seen: ${JSON.stringify(report.headersSeen)}`);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`Total data rows: ${report.totalDataRows}`);
  // eslint-disable-next-line no-console
  console.log(`Valid:    ${report.valid}`);
  // eslint-disable-next-line no-console
  console.log(`Invalid:  ${report.invalid.length}`);
  // eslint-disable-next-line no-console
  console.log(`Duplicates: ${report.duplicates.length}`);
  // eslint-disable-next-line no-console
  console.log(`Would import: ${report.toInsert.length}`);

  reportInvalid(`${platform === 'windows' ? 'Windows' : 'Mac'} invalid rows`, report.invalid);
  reportInvalid(
    `${platform === 'windows' ? 'Windows' : 'Mac'} skipped duplicates`,
    report.duplicates
  );

  if (report.toInsert.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`\nWould insert (first 10):`);
    for (const c of report.toInsert.slice(0, 10)) {
      // eslint-disable-next-line no-console
      console.log(`  [row ${c.rowNumber}] ${c.slug}  ::  ${c.name}`);
    }
  }

  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log('\nNo database changes were made.');
    return;
  }

  const { imported, failed } = await bulkInsert(admin as SupabaseClient, platform, report.toInsert);
  // eslint-disable-next-line no-console
  console.log(`\n=== ${platform.toUpperCase()} IMPORT COMPLETE ===`);
  // eslint-disable-next-line no-console
  console.log(`Imported: ${imported}`);
  // eslint-disable-next-line no-console
  console.log(`Skipped duplicates: ${report.duplicates.length}`);
  // eslint-disable-next-line no-console
  console.log(`Invalid: ${report.invalid.length}`);
  // eslint-disable-next-line no-console
  console.log(`Failed: ${failed.length}`);
  if (failed.length > 0) reportInvalid(`${platform} insert failures`, failed);
}

async function runAll(dryRun: boolean): Promise<void> {
  const admin: SupabaseClient | null = dryRun ? null : getAdmin();
  const winReport = await processPlatform(admin, 'windows', dryRun);
  const macReport = await processPlatform(admin, 'mac', dryRun);

  // Header.
  // eslint-disable-next-line no-console
  console.log(`\n=== ${dryRun ? 'FREAT EDITZ RESOURCE IMPORT (DRY RUN)' : 'FREAT EDITZ RESOURCE IMPORT'} ===`);

  for (const rep of [winReport, macReport]) {
    // eslint-disable-next-line no-console
    console.log(`\n${rep.platform.toUpperCase()}:`);
    // eslint-disable-next-line no-console
    console.log(`  File:          ${describeResolved(rep.resolution)}`);

    if (rep.resolution.kind === 'none') {
      // eslint-disable-next-line no-console
      console.log(`  No Excel file found in ${rep.resolution.dir}/ — skipping.`);
      continue;
    }
    if (rep.resolution.kind === 'multiple') {
      // eslint-disable-next-line no-console
      console.log(`  Multiple Excel files found — refusing to guess:`);
      for (const f of rep.resolution.files) {
        // eslint-disable-next-line no-console
        console.log(`    * ${f}`);
      }
      // eslint-disable-next-line no-console
      console.log('  Please keep only one file or specify which file to use.');
      continue;
    }

    // eslint-disable-next-line no-console
    console.log(`  Sheet:         ${rep.sheetName}`);
    // eslint-disable-next-line no-console
    console.log(`  Headers:       ${JSON.stringify(rep.headersSeen)}`);
    // eslint-disable-next-line no-console
    console.log(`  Rows:          ${rep.totalDataRows}`);
    // eslint-disable-next-line no-console
    console.log(`  Valid:         ${rep.valid}`);
    // eslint-disable-next-line no-console
    console.log(`  Invalid:       ${rep.invalid.length}`);
    // eslint-disable-next-line no-console
    console.log(`  Duplicates:    ${rep.duplicates.length}`);
    // eslint-disable-next-line no-console
    console.log(`  Would import:  ${rep.toInsert.length}`);
  }

  for (const rep of [winReport, macReport]) {
    const label = rep.platform === 'windows' ? 'Windows' : 'Mac';
    reportInvalid(`${label} invalid rows`, rep.invalid);
    reportInvalid(`${label} skipped duplicates`, rep.duplicates);
  }

  if (dryRun) {
    // Counterpart pre-match (no DB read — pure projection from the toInsert
    // list) so the dry-run preview shows what would link.
    const winBy = new Map<string, string[]>();
    const macBy = new Map<string, string[]>();
    for (const w of winReport.toInsert) {
      const k = matchKey(w.name);
      if (!winBy.has(k)) winBy.set(k, []);
      winBy.get(k)!.push(w.name);
    }
    for (const m of macReport.toInsert) {
      const k = matchKey(m.name);
      if (!macBy.has(k)) macBy.set(k, []);
      macBy.get(k)!.push(m.name);
    }
    let wouldMatch = 0;
    let ambiguousCount = 0;
    for (const entry of Array.from(winBy.entries())) {
      const k = entry[0];
      const ws = entry[1];
      const ms = macBy.get(k) ?? [];
      if (ws.length === 1 && ms.length === 1) {
        wouldMatch += 1;
      } else if (ws.length > 0 && ms.length > 0) {
        ambiguousCount += 1;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`\nCounterpart matches (preview):`);
    // eslint-disable-next-line no-console
    console.log(`  Would match (1:1): ${wouldMatch}`);
    // eslint-disable-next-line no-console
    console.log(`  Ambiguous (would NOT auto-link): ${ambiguousCount}`);
    // eslint-disable-next-line no-console
    console.log('\nNo database changes were made.');
    return;
  }

  // Real run: insert Windows first, then Mac, then mirror links.
  const realAdmin = admin as SupabaseClient;
  const winInsert = await bulkInsert(realAdmin, 'windows', winReport.toInsert);
  const macInsert = await bulkInsert(realAdmin, 'mac', macReport.toInsert);

  const wins = await buildCandidates(realAdmin, 'windows');
  const macs = await buildCandidates(realAdmin, 'mac');
  const match = await runCounterpartMatch(realAdmin, false, wins, macs);

  // eslint-disable-next-line no-console
  console.log(`\n=== IMPORT COMPLETE ===`);
  // eslint-disable-next-line no-console
  console.log(`Windows: imported ${winInsert.imported}, skipped ${winReport.duplicates.length}, invalid ${winReport.invalid.length}, failed ${winInsert.failed.length}`);
  // eslint-disable-next-line no-console
  console.log(`Mac:     imported ${macInsert.imported}, skipped ${macReport.duplicates.length}, invalid ${macReport.invalid.length}, failed ${macInsert.failed.length}`);
  // eslint-disable-next-line no-console
  console.log(`Counterparts: matched ${match.matched}, ambiguous ${match.ambiguous.length}, windows unmatched ${match.unmatchedWindows.length}, mac unmatched ${match.unmatchedMac.length}`);

  for (const rep of [winReport, macReport]) {
    const failed = rep.platform === 'windows' ? winInsert.failed : macInsert.failed;
    if (failed.length > 0) {
      reportInvalid(`${rep.platform} insert failures`, failed);
    }
  }
  reportAmbiguous(match.ambiguous);
  reportUnmatched('windows', match.unmatchedWindows);
  reportUnmatched('mac', match.unmatchedMac);
}

// ---------- Entry ----------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === 'summary') {
    await runSummary();
    return;
  }
  if (args.mode === 'all') {
    await runAll(args.dryRun);
    return;
  }
  await runSinglePlatform(args.mode, args.dryRun);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('\nImport aborted:', err?.message ?? err);
  process.exitCode = 1;
});
