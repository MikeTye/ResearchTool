'use strict';

const fsp = require('fs/promises');
const path = require('path');
const { OUTPUT_NOTE, CLASSIFICATIONS } = require('./classify');

const REPORT_DISCLAIMER = `${OUTPUT_NOTE} This tool summarizes evidence and does not provide legal advice.`;

const CSV_COLUMNS = [
  'source_url',
  'normalized_origin',
  'terms_url',
  'discovery_method',
  'http_status',
  'classification',
  'keyword',
  'snippet',
  'notes'
];

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeNote(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function legalUrlFromEvidence(item = {}) {
  return item.fetchedLegalPageUrl || item.pageUrl || item.url || item.requestedLegalPageUrl || '';
}

function discoveryMethodFromEvidence(item = {}) {
  return item.discovery || item.method || 'not-discovered';
}

function evidenceNote(item = {}) {
  const notes = [];
  if (item.blocked) notes.push('blocked');
  if (item.error) notes.push(item.error);
  if (item.status && !item.httpStatus) notes.push(`HTTP status ${item.status}`);
  return normalizeNote(notes.join('; '));
}

function discoveredTermsUrls(result = {}) {
  return unique([
    ...(result.discoveredTermsUrls || []),
    ...(result.evidence || []).map(legalUrlFromEvidence)
  ]);
}

function hasDiscoveredTermsPage(result = {}) {
  return discoveredTermsUrls(result).length > 0;
}

function buildReportRows(results = []) {
  const rows = [];

  for (const result of results) {
    const evidence = result.evidence || [];
    const classification = hasDiscoveredTermsPage(result)
      ? (result.classification || CLASSIFICATIONS.UNCLEAR)
      : CLASSIFICATIONS.UNCLEAR;

    if (!evidence.length) {
      rows.push({
        source_url: result.originalUrl || '',
        normalized_origin: result.origin || '',
        terms_url: '',
        discovery_method: 'not-discovered',
        http_status: result.error ? '0' : '',
        classification,
        keyword: '',
        snippet: '',
        notes: result.error || 'No discovered terms/legal page; unclear / needs legal review.'
      });
      continue;
    }

    for (const item of evidence) {
      rows.push({
        source_url: result.originalUrl || item.originalSourceUrl || '',
        normalized_origin: result.origin || '',
        terms_url: legalUrlFromEvidence(item),
        discovery_method: discoveryMethodFromEvidence(item),
        http_status: item.httpStatus || item.status || '',
        classification,
        keyword: item.keyword || '',
        snippet: item.snippet || '',
        notes: evidenceNote(item)
      });
    }
  }

  return rows;
}

function buildCsv(results = []) {
  const rows = buildReportRows(results);
  return [
    CSV_COLUMNS.join(','),
    ...rows.map(row => CSV_COLUMNS.map(column => csvEscape(row[column])).join(','))
  ].join('\n') + '\n';
}

function buildMarkdown(results = []) {
  const lines = [
    '# Research Report',
    '',
    `> ${REPORT_DISCLAIMER}`,
    ''
  ];

  for (const result of results) {
    const evidence = result.evidence || [];
    const discoveredUrls = discoveredTermsUrls(result);
    const inaccessible = (result.discoveryEvidence || []).filter(item => item.error || item.blocked || (item.status && item.status >= 400));
    const classification = discoveredUrls.length ? (result.classification || CLASSIFICATIONS.UNCLEAR) : CLASSIFICATIONS.UNCLEAR;
    const unanswered = [];

    if (!discoveredUrls.length) unanswered.push('No discovered terms/legal page.');
    if (!evidence.length) unanswered.push('No keyword evidence snippets were extracted.');
    if (classification === CLASSIFICATIONS.UNCLEAR) unanswered.push('Final status is unclear and needs legal review.');

    lines.push(
      `## ${result.originalUrl || 'Unknown source'}`,
      '',
      `- **Normalized origin:** ${result.origin || 'n/a'}`,
      `- **Final classification:** ${classification}`,
      ''
    );

    lines.push('### Discovered legal/terms URLs');
    if (discoveredUrls.length) discoveredUrls.forEach(url => lines.push(`- ${url}`));
    else lines.push('- None discovered.');
    lines.push('');

    lines.push('### Evidence snippets');
    if (evidence.length) {
      evidence.forEach(item => {
        lines.push(`- **${item.keyword || 'evidence'}** on ${legalUrlFromEvidence(item) || 'n/a'} (${discoveryMethodFromEvidence(item)}, HTTP ${item.httpStatus || item.status || 'n/a'}): ${item.snippet || 'No snippet available.'}`);
      });
    } else {
      lines.push('- No evidence snippets available.');
    }
    lines.push('');

    lines.push('### Blocked/inaccessible notes');
    if (result.error) lines.push(`- ${result.error}`);
    if (inaccessible.length) {
      inaccessible.forEach(item => {
        const status = item.status || item.httpStatus || 'n/a';
        const note = evidenceNote(item) || 'Inaccessible during discovery.';
        lines.push(`- ${item.url || legalUrlFromEvidence(item) || 'n/a'} (${item.method || item.discovery || 'discovery'}, HTTP ${status}): ${note}`);
      });
    }
    if (!result.error && !inaccessible.length) lines.push('- None recorded.');
    lines.push('');

    lines.push('### Unanswered or unclear status');
    if (unanswered.length) unanswered.forEach(item => lines.push(`- ${item}`));
    else lines.push('- No unresolved status recorded by the tool.');
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

async function writeReports(results, outputDir) {
  await fsp.mkdir(outputDir, { recursive: true });
  await Promise.all([
    fsp.writeFile(path.join(outputDir, 'report.csv'), buildCsv(results)),
    fsp.writeFile(path.join(outputDir, 'report.md'), buildMarkdown(results))
  ]);
}

module.exports = {
  CSV_COLUMNS,
  REPORT_DISCLAIMER,
  discoveredTermsUrls,
  buildReportRows,
  buildCsv,
  buildMarkdown,
  writeReports
};
