#!/usr/bin/env node
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { parse } = require('fast-csv');
const { z } = require('zod');
const cheerio = require('cheerio');
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
  --help                 Show this help

Environment overrides:
  RESEARCHTOOL_CONFIG, RESEARCHTOOL_INPUT, RESEARCHTOOL_OUTPUT_DIR,
  RESEARCHTOOL_KEYWORDS, RESEARCHTOOL_PATHS, RESEARCHTOOL_CONCURRENCY,
  RESEARCHTOOL_TIMEOUT_MS, RESEARCHTOOL_USER_AGENT
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

function discoverLinks(html, baseUrl, origin, sourcePathname) {
  const $ = cheerio.load(html || '');
  const found = new Set();
  $('a[href]').each((_, el) => {
    const label = `${$(el).text()} ${$(el).attr('href')}`.toLowerCase();
    if (/terms|legal|copyright|privacy|data|api|usage|license/.test(label)) {
      try { found.add(new URL($(el).attr('href'), baseUrl).href); } catch (_) {}
    }
  });
  if (sourcePathname && sourcePathname !== '/') {
    const parts = sourcePathname.split('/').filter(Boolean);
    while (parts.length) {
      found.add(`${origin}/${parts.join('/')}/terms`);
      found.add(`${origin}/${parts.join('/')}/legal`);
      parts.pop();
    }
  }
  return [...found];
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
  const candidates = new Set([info.normalizedUrl, info.origin, `${info.origin}/robots.txt`, `${info.origin}/sitemap.xml`]);
  config.paths.forEach(p => candidates.add(new URL(p.startsWith('/') ? p : `/${p}`, info.origin).href));
  const home = await fetchText(info.normalizedUrl, config);
  if (home.ok) discoverLinks(home.text, info.normalizedUrl, info.origin, info.pathname).forEach(u => candidates.add(u));
  const evidence = [];
  for (const url of [...candidates].slice(0, 30)) {
    const page = url === info.normalizedUrl && home.ok ? home : await fetchText(url, config);
    if (!page.ok) continue;
    const $ = cheerio.load(page.text);
    const text = $('body').text() || page.text;
    snippetsFor(text, config.keywords).forEach(s => evidence.push({ pageUrl: url, ...s }));
    if (evidence.length >= 10) break;
  }
  return { ...info, classification: classify(evidence), evidence, row: source.row };
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
  const csvRows = ['original_url,origin,classification,page_url,keyword,snippet'];
  const md = ['# Research Report', ''];
  for (const result of results) {
    md.push(`## ${result.originalUrl}`, '', `- Origin: ${result.origin || ''}`, `- Classification: ${result.classification}`, '');
    if (!result.evidence.length) md.push('- No keyword evidence found.', '');
    for (const ev of result.evidence) {
      csvRows.push([result.originalUrl, result.origin, result.classification, ev.pageUrl, ev.keyword, ev.snippet].map(csvEscape).join(','));
      md.push(`- **${ev.keyword}** on ${ev.pageUrl}: ${ev.snippet}`);
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
