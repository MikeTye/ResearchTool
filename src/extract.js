'use strict';

const cheerio = require('cheerio');

const DEFAULT_SNIPPET_CONTEXT_LENGTH = 250;
const DEFAULT_MAX_SNIPPETS_PER_PAGE = 10;
const NON_VISIBLE_SELECTOR = [
  'script', 'style', 'noscript', 'svg', 'canvas', 'template', 'iframe',
  'header', 'footer', 'nav', '[role="navigation"]', '[aria-hidden="true"]'
].join(',');

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isReadableContentType(contentType) {
  const type = String(contentType || '').toLowerCase();
  return type === '' || type.includes('text/html') || type.includes('application/xhtml') || type.includes('text/plain');
}

async function fetchHtml(url, config = {}) {
  const controller = new AbortController();
  const timeoutMs = config.timeoutMs || 15000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fetchedAt = new Date().toISOString();

  try {
    const res = await fetch(url, {
      headers: { 'user-agent': config.userAgent || 'ResearchTool/1.0' },
      signal: controller.signal,
      redirect: 'follow'
    });
    const contentType = res.headers.get('content-type') || '';
    const readable = isReadableContentType(contentType);
    return {
      ok: res.ok && readable,
      status: res.status,
      finalUrl: res.url,
      contentType,
      fetchedAt,
      html: res.ok && readable ? await res.text() : ''
    };
  } catch (err) {
    return { ok: false, status: 0, finalUrl: url, fetchedAt, html: '', error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

function htmlToVisibleText(html) {
  const $ = cheerio.load(html || '');
  $(NON_VISIBLE_SELECTOR).remove();
  $('[hidden], [style*="display:none"], [style*="display: none"], [style*="visibility:hidden"], [style*="visibility: hidden"]').remove();
  return normalizeWhitespace($('body').text() || $.root().text() || html);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordToPattern(keyword) {
  if (keyword instanceof RegExp) return new RegExp(keyword.source, keyword.flags.includes('g') ? keyword.flags : `${keyword.flags}g`);
  const raw = String(keyword || '').trim();
  if (!raw) return null;
  const slash = raw.match(/^\/(.*)\/([dgimsuvy]*)$/);
  if (slash) return new RegExp(slash[1], slash[2].includes('g') ? slash[2] : `${slash[2]}g`);
  return new RegExp(escapeRegExp(raw), 'gi');
}

function findKeywordSnippets(text, keywords, options = {}) {
  const normalizedText = normalizeWhitespace(text);
  const contextLength = Number.isInteger(options.contextLength) ? options.contextLength : DEFAULT_SNIPPET_CONTEXT_LENGTH;
  const maxSnippets = Number.isInteger(options.maxSnippets) ? options.maxSnippets : DEFAULT_MAX_SNIPPETS_PER_PAGE;
  const snippets = [];

  for (const keyword of keywords || []) {
    const pattern = keywordToPattern(keyword);
    if (!pattern) continue;
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(normalizedText)) && snippets.length < maxSnippets) {
      const start = Math.max(0, match.index - contextLength);
      const end = Math.min(normalizedText.length, match.index + match[0].length + contextLength);
      snippets.push({
        keyword: String(keyword),
        matchedText: match[0],
        snippet: normalizedText.slice(start, end).trim()
      });
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
    if (snippets.length >= maxSnippets) break;
  }
  return snippets;
}

async function extractEvidenceFromPage(sourceUrl, legalPageUrl, discoveryMethod, config = {}) {
  const page = await fetchHtml(legalPageUrl, config);
  if (!page.ok) return { page, evidence: [] };
  const text = htmlToVisibleText(page.html);
  const snippets = findKeywordSnippets(text, config.keywords || [], {
    contextLength: config.snippetContextLength,
    maxSnippets: config.maxSnippetsPerPage
  });
  return {
    page,
    evidence: snippets.map(item => ({
      originalSourceUrl: sourceUrl,
      pageUrl: page.finalUrl || legalPageUrl,
      fetchedLegalPageUrl: page.finalUrl || legalPageUrl,
      requestedLegalPageUrl: legalPageUrl,
      keyword: item.keyword,
      matchedText: item.matchedText,
      snippet: item.snippet,
      discovery: discoveryMethod || 'content-scan',
      httpStatus: page.status,
      fetchedAt: page.fetchedAt
    }))
  };
}

module.exports = {
  DEFAULT_SNIPPET_CONTEXT_LENGTH,
  DEFAULT_MAX_SNIPPETS_PER_PAGE,
  fetchHtml,
  htmlToVisibleText,
  normalizeWhitespace,
  findKeywordSnippets,
  extractEvidenceFromPage
};
