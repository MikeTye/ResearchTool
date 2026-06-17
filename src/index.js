#!/usr/bin/env node
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { parse } = require('fast-csv');
const { z } = require('zod');
const { discoverCandidates } = require('./discover');
const { extractEvidenceFromPage } = require('./extract');

const { buildConfig } = require('./config');

const URL_COLUMNS = ['url', 'URL', 'website', 'source', 'link', 'LINK'];


function printHelp() {
  console.log(`Usage: npm run research -- [options]

Options:
  --input <path>         Source CSV path (default: input/source.csv, or /input/source.csv if present)
  --output-dir <path>    Directory for CSV and Markdown reports (default: reports)
  --config <path>        JSON config file with option overrides
  --keywords <value>     JSON file path or comma-separated keyword override
  --paths <value>        JSON file path or comma-separated legal-path override
  --concurrency <n>      Concurrent sites to process (default: 2)
  --timeout-ms <n>       HTTP timeout in milliseconds (default: 15000)
  --user-agent <value>   User-Agent header (default: ResearchTool/1.0 (+https://github.com/MikeTye/ResearchTool))
  --snippet-context-length <n>  Characters before and after each keyword match (default: 250)
  --max-snippets-per-page <n>   Maximum snippets to keep from each fetched page (default: 10)
  --help                 Show this help

Environment overrides:
  RESEARCHTOOL_CONFIG, RESEARCHTOOL_INPUT, RESEARCHTOOL_OUTPUT_DIR,
  RESEARCHTOOL_KEYWORDS, RESEARCHTOOL_PATHS, RESEARCHTOOL_CONCURRENCY,
  RESEARCHTOOL_TIMEOUT_MS, RESEARCHTOOL_USER_AGENT,
  RESEARCHTOOL_SNIPPET_CONTEXT_LENGTH, RESEARCHTOOL_MAX_SNIPPETS_PER_PAGE
`);
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
    const discoveryMethod = discovery.evidence.filter(item => item.url === url).map(item => item.method).join(';') || 'source-url';
    const extracted = await extractEvidenceFromPage(info.originalUrl, url, discoveryMethod, config);
    extracted.evidence.forEach(item => evidence.push(item));
    if (evidence.length >= 10) break;
  }
  if (!evidence.length) {
    discovery.evidence.slice(0, 10).forEach(item => evidence.push({
      originalSourceUrl: info.originalUrl,
      pageUrl: item.url,
      fetchedLegalPageUrl: item.url,
      discovery: item.method,
      keyword: item.blocked ? 'blocked' : 'inaccessible',
      snippet: item.error || `HTTP status ${item.status || 'not fetched'}`,
      httpStatus: item.status || 0,
      fetchedAt: new Date().toISOString()
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
  const csvRows = ['original_url,origin,classification,page_url,discovery,keyword,http_status,fetched_at,snippet'];
  const md = ['# Research Report', ''];
  for (const result of results) {
    md.push(`## ${result.originalUrl}`, '', `- Origin: ${result.origin || ''}`, `- Classification: ${result.classification}`, '');
    if (!result.evidence.length) md.push('- No keyword evidence found.', '');
    for (const ev of result.evidence) {
      csvRows.push([result.originalUrl, result.origin, result.classification, ev.pageUrl, ev.discovery || 'content-scan', ev.keyword, ev.httpStatus || '', ev.fetchedAt || '', ev.snippet].map(csvEscape).join(','));
      md.push(`- **${ev.keyword}** on ${ev.pageUrl} (${ev.discovery || 'content-scan'}, HTTP ${ev.httpStatus || 'n/a'}, fetched ${ev.fetchedAt || 'n/a'}): ${ev.snippet}`);
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

module.exports = { buildConfig, normalizeUrl, readCsv, processSource };
