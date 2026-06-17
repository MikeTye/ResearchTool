#!/usr/bin/env node
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { parse } = require('fast-csv');
const { z } = require('zod');
const cheerio = require('cheerio');
const { discoverCandidates } = require('./discover');

const DEFAULT_KEYWORDS = [
  'reuse', 'reproduce', 'republish', 'redistribute', 'commercial use', 'API',
  'open data', 'public domain', 'license', 'Creative Commons', 'non-commercial',
  'may not reproduce', 'prior written permission', 'automated access', 'scraping', 'crawler'
];
const DEFAULT_PATHS = [
  '/terms', '/terms-of-use', '/terms-and-conditions', '/conditions', '/legal', '/copyright',
  '/license', '/licensing', '/privacy', '/privacy-policy', '/data-policy', '/api',
  '/api/terms', '/api-terms', '/usage', '/usage-terms', '/acceptable-use',
  '/acceptable-use-policy'
];
const URL_COLUMNS = ['url', 'URL', 'website', 'source', 'link', 'LINK'];

const ConfigSchema = z.object({
  input: z.string().min(1),
  outputDir: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(1),
  paths: z.array(z.string().min(1)).min(1),
  concurrency: z.coerce.number().int().min(1).max(10),
  timeoutMs: z.coerce.number().int().min(1000),
  userAgent: z.string().min(1)
});

function printHelp() {
  console.log(`Usage: npm run research -- [options]\n\nOptions:\n  --input <path>         Source CSV path (default: input/source.csv, or /input/source.csv if present)\n  --output-dir <path>    Directory for CSV and Markdown reports (default: reports)\n  --keywords <value>     JSON file path or comma-separated keyword override\n  --paths <value>        JSON file path or comma-separated legal-path override\n  --concurrency <n>      Concurrent sites to process (default: 2)\n  --timeout-ms <n>       HTTP timeout in milliseconds (default: 15000)\n  --user-agent <value>   User-Agent header (default: ResearchTool/1.0 (+https://github.com/MikeTye/ResearchTool))\n  --help                 Show this help\n`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function defaultInputPath() {
  return fs.existsSync('/input/source.csv') ? '/input/source.csv' : path.join(process.cwd(), 'input/source.csv');
}

async function listFromOption(value, fallback) {
  if (!value) return fallback;
  const maybePath = path.resolve(value);
  if (fs.existsSync(maybePath)) {
    const parsed = JSON.parse(await fsp.readFile(maybePath, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error(`${value} must contain a JSON array`);
    return parsed.map(String).map(s => s.trim()).filter(Boolean);
  }
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

async function buildConfig(argv) {
  const args = parseArgs(argv);
  if (args.help) return { help: true };
  return ConfigSchema.parse({
    input: args.input || defaultInputPath(),
    outputDir: args.outputDir || 'reports',
    keywords: await listFromOption(args.keywords, DEFAULT_KEYWORDS),
    paths: await listFromOption(args.paths, DEFAULT_PATHS),
    concurrency: args.concurrency || 2,
    timeoutMs: args.timeoutMs || 15000,
    userAgent: args.userAgent || 'ResearchTool/1.0 (+https://github.com/MikeTye/ResearchTool)'
  });
}

function normalizeUrl(raw) {
  const originalUrl = String(raw || '').trim();
  const withScheme = /^https?:\/\//i.test(originalUrl) ? originalUrl : `https://${originalUrl}`;
  const parsed = new URL(withScheme);
  return { originalUrl, normalizedUrl: parsed.href, origin: parsed.origin, pathname: parsed.pathname };
}

async function readCsv(input) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(input)
      .pipe(parse({ headers: true, ignoreEmpty: true, trim: true }))
      .on('error', reject)
      .on('data', row => rows.push(row))
      .on('end', () => {
        resolve(rows.map(row => {
          const keys = Object.keys(row);
          const urlKey = URL_COLUMNS.find(c => Object.prototype.hasOwnProperty.call(row, c)) || (keys.length === 1 ? keys[0] : null);
          if (!urlKey || !row[urlKey]) return null;
          return { row, url: row[urlKey] };
        }).filter(Boolean));
      });
  });
}

async function fetchText(url, config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'user-agent': config.userAgent }, signal: controller.signal, redirect: 'follow' });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || (!type.includes('text') && !type.includes('html') && !type.includes('xml'))) return { ok: false, status: res.status, text: '' };
    return { ok: true, status: res.status, text: await res.text() };
  } catch (err) {
    return { ok: false, status: 0, text: '', error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

function snippetsFor(text, keywords) {
  const compact = text.replace(/\s+/g, ' ');
  const snippets = [];
  for (const keyword of keywords) {
    const idx = compact.toLowerCase().indexOf(keyword.toLowerCase());
    if (idx !== -1) snippets.push({ keyword, snippet: compact.slice(Math.max(0, idx - 120), idx + keyword.length + 220).trim() });
  }
  return snippets.slice(0, 10);
}

function classify(snippets) {
  const text = snippets.map(s => s.snippet).join(' ').toLowerCase();
  if (!text) return 'Unclear / needs legal review';
  if (/prior written permission|may not reproduce|permission required/.test(text)) return 'Permission required';
  if (/commercial use|commercial republication|non-commercial/.test(text) && /prohibit|not|without/.test(text)) return 'Commercial republication prohibited';
  if (/api/.test(text) && /only|terms/.test(text)) return 'API only';
  if (/creative commons|attribution/.test(text)) return 'Likely allowed with attribution';
  if (/public domain|open data|license/.test(text)) return 'Allowed';
  return 'Unclear / needs legal review';
}

async function processSource(source, config) {
  const info = normalizeUrl(source.url);
  const discovery = await discoverCandidates(info.normalizedUrl, config);
  const candidateUrls = [info.normalizedUrl, discovery.homepageUrl, ...discovery.candidates.map(item => item.url)];
  const seen = new Set();
  const evidence = [];
  for (const url of candidateUrls.filter(url => url && !seen.has(url) && seen.add(url)).slice(0, 30)) {
    const page = await fetchText(url, config);
    if (!page.ok) continue;
    const $ = cheerio.load(page.text);
    const text = $('body').text() || page.text;
    snippetsFor(text, config.keywords).forEach(s => evidence.push({
      pageUrl: url,
      discovery: discovery.evidence.filter(item => item.url === url).map(item => item.method).join(';') || 'source-url',
      ...s
    }));
    if (evidence.length >= 10) break;
  }
  if (!evidence.length) {
    discovery.evidence.slice(0, 10).forEach(item => evidence.push({
      pageUrl: item.url,
      discovery: item.method,
      keyword: item.blocked ? 'blocked' : 'inaccessible',
      snippet: item.error || `HTTP status ${item.status || 'not fetched'}`
    }));
  }
  return { ...info, classification: classify(evidence), evidence, discoveryEvidence: discovery.evidence, row: source.row };
}

async function mapLimit(items, limit, worker) {
  const results = [];
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index++;
      try { results[current] = await worker(items[current]); }
      catch (err) { results[current] = { originalUrl: items[current].url, error: err.message, evidence: [], classification: 'Unclear / needs legal review' }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

async function writeReports(results, outputDir) {
  await fsp.mkdir(outputDir, { recursive: true });
  const csvRows = ['original_url,origin,classification,page_url,discovery,keyword,snippet'];
  const md = ['# Research Report', ''];
  for (const result of results) {
    md.push(`## ${result.originalUrl}`, '', `- Origin: ${result.origin || ''}`, `- Classification: ${result.classification}`, '');
    if (!result.evidence.length) md.push('- No keyword evidence found.', '');
    for (const ev of result.evidence) {
      csvRows.push([result.originalUrl, result.origin, result.classification, ev.pageUrl, ev.discovery || 'content-scan', ev.keyword, ev.snippet].map(csvEscape).join(','));
      md.push(`- **${ev.keyword}** on ${ev.pageUrl} (${ev.discovery || 'content-scan'}): ${ev.snippet}`);
    }
    md.push('');
  }
  await fsp.writeFile(path.join(outputDir, 'research-report.csv'), `${csvRows.join('\n')}\n`);
  await fsp.writeFile(path.join(outputDir, 'research-report.md'), `${md.join('\n')}\n`);
}

async function main() {
  const config = await buildConfig(process.argv.slice(2));
  if (config.help) return printHelp();
  const sources = await readCsv(config.input);
  const results = await mapLimit(sources, config.concurrency, source => processSource(source, config));
  await writeReports(results, config.outputDir);
  console.log(`Processed ${results.length} source(s). Reports written to ${config.outputDir}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(err instanceof z.ZodError ? z.prettifyError(err) : err.message);
    process.exit(1);
  });
}

module.exports = { buildConfig, normalizeUrl, readCsv, processSource, fetchText };
