'use strict';

const cheerio = require('cheerio');

const LEGAL_TERMS = [
  'terms', 'legal', 'copyright', 'license', 'privacy', 'data', 'api', 'usage',
  'acceptable use', 'conditions'
];
const LEGAL_RE = /terms|legal|copyright|licen[cs]e|privacy|data|api|usage|acceptable\s+use|conditions/i;
const DEFAULT_COMMON_PATHS = [
  '/terms', '/terms-of-use', '/terms-and-conditions', '/conditions', '/legal',
  '/copyright', '/license', '/licensing', '/privacy', '/privacy-policy',
  '/data-policy', '/api', '/api/terms', '/api-terms', '/usage', '/usage-terms',
  '/acceptable-use', '/acceptable-use-policy'
];
const SITEMAP_LIMIT = 5;
const SITEMAP_ENTRY_LIMIT = 50;

function uniquePush(items, item, key = 'url') {
  if (!item || !item[key]) return;
  if (!items.some(existing => existing[key] === item[key] && existing.method === item.method)) items.push(item);
}

function toOriginUrl(raw) {
  const parsed = new URL(/^https?:\/\//i.test(String(raw)) ? raw : `https://${raw}`);
  return { origin: parsed.origin, homepageUrl: `${parsed.origin}/` };
}

function safeUrl(raw, baseUrl) {
  try {
    const parsed = new URL(raw, baseUrl);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    return parsed.href;
  } catch (_) {
    return null;
  }
}

function conservativeTimeout(config) {
  return Math.min(config.timeoutMs || 15000, config.discoveryTimeoutMs || 7000);
}

async function fetchText(url, config, timeoutMs = config.timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': config.userAgent },
      signal: controller.signal,
      redirect: 'follow'
    });
    const type = res.headers.get('content-type') || '';
    const readable = type.includes('text') || type.includes('html') || type.includes('xml') || type.includes('rss') || type === '';
    return {
      ok: res.ok && readable,
      blocked: [401, 403, 407, 429, 451].includes(res.status),
      status: res.status,
      contentType: type,
      finalUrl: res.url,
      text: res.ok && readable ? await res.text() : ''
    };
  } catch (err) {
    return { ok: false, blocked: false, status: 0, text: '', error: err.message, finalUrl: url };
  } finally {
    clearTimeout(timer);
  }
}

function evidence(method, url, details = {}) {
  return { method, url, ...details };
}

function discoverHomepageAnchors(html, homepageUrl) {
  const $ = cheerio.load(html || '');
  const matches = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    const haystack = `${text} ${href}`;
    if (!LEGAL_RE.test(haystack)) return;
    const url = safeUrl(href, homepageUrl);
    if (url) uniquePush(matches, evidence('homepage-anchor', url, { text, href }));
  });
  return matches;
}

function parseRobots(text, origin, userAgent = '') {
  const sitemaps = [];
  const groups = [];
  let current = null;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'sitemap') {
      const url = safeUrl(value, origin);
      if (url) sitemaps.push(url);
      continue;
    }
    if (field === 'user-agent') {
      current = { agents: [value.toLowerCase()], disallow: [] };
      groups.push(current);
    } else if (field === 'disallow' && current) {
      current.disallow.push(value);
    } else if (field === 'allow' && current) {
      // Kept for evidence-aware conservative checks. We do not use Allow to bypass Disallow.
    }
  }
  const ua = String(userAgent).toLowerCase();
  const applicable = groups.filter(g => g.agents.some(agent => agent === '*' || (ua && ua.includes(agent))));
  const disallow = applicable.flatMap(g => g.disallow).filter(Boolean);
  return { sitemaps: [...new Set(sitemaps)], disallow };
}

function isRobotsBlocked(candidateUrl, origin, disallowRules) {
  const path = new URL(candidateUrl).pathname;
  return disallowRules.some(rule => rule === '/' || (rule && path.startsWith(rule.startsWith('/') ? rule : `/${rule}`)));
}

function parseSitemapEntries(xml, sitemapUrl) {
  const $ = cheerio.load(xml || '', { xmlMode: true });
  const urls = [];
  $('url > loc, sitemap > loc').each((_, el) => {
    const url = safeUrl($(el).text().trim(), sitemapUrl);
    if (url) urls.push(url);
  });
  return [...new Set(urls)];
}

async function discoverCandidates(sourceUrl, config) {
  const { origin, homepageUrl } = toOriginUrl(sourceUrl);
  const candidates = [];
  const blocked = [];
  const inaccessible = [];
  const sitemaps = new Set([`${origin}/sitemap.xml`]);
  const timeout = conservativeTimeout(config);

  const home = await fetchText(homepageUrl, config, timeout);
  if (home.ok) discoverHomepageAnchors(home.text, homepageUrl).forEach(item => uniquePush(candidates, item));
  else inaccessible.push(evidence('homepage', homepageUrl, { status: home.status, error: home.error, blocked: home.blocked }));

  const robotsUrl = `${origin}/robots.txt`;
  const robots = await fetchText(robotsUrl, config, timeout);
  let disallow = [];
  if (robots.ok) {
    const parsed = parseRobots(robots.text, origin, config.userAgent);
    disallow = parsed.disallow;
    parsed.sitemaps.forEach(url => sitemaps.add(url));
    parsed.sitemaps.forEach(url => uniquePush(candidates, evidence('robots-sitemap-entry', url, { robotsUrl })));
  } else {
    inaccessible.push(evidence('robots', robotsUrl, { status: robots.status, error: robots.error, blocked: robots.blocked }));
  }

  for (const sitemapUrl of [...sitemaps].slice(0, SITEMAP_LIMIT)) {
    if (isRobotsBlocked(sitemapUrl, origin, disallow)) {
      blocked.push(evidence('robots-disallow', sitemapUrl, { rule: 'sitemap path disallowed', blocked: true }));
      continue;
    }
    const sitemap = await fetchText(sitemapUrl, config, timeout);
    if (!sitemap.ok) {
      inaccessible.push(evidence('sitemap', sitemapUrl, { status: sitemap.status, error: sitemap.error, blocked: sitemap.blocked }));
      continue;
    }
    parseSitemapEntries(sitemap.text, sitemapUrl).slice(0, SITEMAP_ENTRY_LIMIT).forEach(url => {
      if (LEGAL_RE.test(url)) uniquePush(candidates, evidence('sitemap-entry', url, { sitemapUrl }));
    });
  }

  const commonPaths = config.paths && config.paths.length ? config.paths : DEFAULT_COMMON_PATHS;
  for (const path of commonPaths) {
    const url = safeUrl(path.startsWith('/') ? path : `/${path}`, origin);
    if (!url) continue;
    if (isRobotsBlocked(url, origin, disallow)) {
      blocked.push(evidence('robots-disallow', url, { path, blocked: true }));
      continue;
    }
    const probe = await fetchText(url, config, timeout);
    const item = evidence('common-path-probe', url, { path, status: probe.status, blocked: probe.blocked, error: probe.error });
    if (probe.ok) uniquePush(candidates, item);
    else inaccessible.push(item);
  }

  const deduped = [];
  for (const item of candidates) uniquePush(deduped, item);
  return { origin, homepageUrl, candidates: deduped, evidence: [...deduped, ...blocked, ...inaccessible], blocked, inaccessible };
}

module.exports = {
  LEGAL_TERMS,
  DEFAULT_COMMON_PATHS,
  discoverCandidates,
  discoverHomepageAnchors,
  parseRobots,
  parseSitemapEntries,
  isRobotsBlocked
};
