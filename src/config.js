'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { z } = require('zod');

const DEFAULT_KEYWORDS = [
  'reuse', 'reproduce', 'republish', 'redistribute', 'commercial use', 'API',
  'open data', 'public domain', 'license', 'Creative Commons', 'non-commercial',
  'may not reproduce', 'prior written permission', 'automated access', 'scraping', 'crawler'
];

const DEFAULT_PATHS = [
  '/terms', '/terms-of-use', '/terms-and-conditions', '/legal', '/copyright',
  '/privacy', '/data-policy', '/api-terms', '/usage-terms', '/robots.txt', '/sitemap.xml'
];

const ConfigSchema = z.object({
  input: z.string().min(1),
  outputDir: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(1),
  paths: z.array(z.string().min(1)).min(1),
  concurrency: z.coerce.number().int().min(1).max(10),
  timeoutMs: z.coerce.number().int().min(1000),
  userAgent: z.string().min(1),
  snippetContextLength: z.coerce.number().int().min(0).max(2000),
  maxSnippetsPerPage: z.coerce.number().int().min(1).max(50)
});

function defaultInputPath() {
  return fs.existsSync('/input/source.csv') ? '/input/source.csv' : path.join(process.cwd(), 'input/source.csv');
}

const DEFAULT_CONFIG = Object.freeze({
  input: defaultInputPath,
  outputDir: 'reports',
  keywords: DEFAULT_KEYWORDS,
  paths: DEFAULT_PATHS,
  concurrency: 2,
  timeoutMs: 15000,
  userAgent: 'ResearchTool/1.0 (+https://github.com/MikeTye/ResearchTool)',
  snippetContextLength: 250,
  maxSnippetsPerPage: 10
});

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

async function readJsonFile(filePath) {
  return JSON.parse(await fsp.readFile(path.resolve(filePath), 'utf8'));
}

function normalizeStringList(value, label) {
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof value !== 'string') throw new Error(`${label} must be a JSON array or comma-separated string`);
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

async function listFromOption(value, fallback, label) {
  if (!value) return fallback;
  const maybePath = path.resolve(value);
  if (fs.existsSync(maybePath)) return normalizeStringList(await readJsonFile(maybePath), label);
  return normalizeStringList(value, label);
}

function envOverrides(env = process.env) {
  return {
    input: env.RESEARCHTOOL_INPUT,
    outputDir: env.RESEARCHTOOL_OUTPUT_DIR,
    keywords: env.RESEARCHTOOL_KEYWORDS,
    paths: env.RESEARCHTOOL_PATHS,
    concurrency: env.RESEARCHTOOL_CONCURRENCY,
    timeoutMs: env.RESEARCHTOOL_TIMEOUT_MS,
    userAgent: env.RESEARCHTOOL_USER_AGENT,
    snippetContextLength: env.RESEARCHTOOL_SNIPPET_CONTEXT_LENGTH,
    maxSnippetsPerPage: env.RESEARCHTOOL_MAX_SNIPPETS_PER_PAGE
  };
}

function compactObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== ''));
}

async function fileOverrides(filePath) {
  if (!filePath) return {};
  const parsed = await readJsonFile(filePath);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${filePath} must contain a JSON object`);
  return parsed;
}

async function buildConfig(argv, env = process.env) {
  const args = parseArgs(argv);
  if (args.help) return { help: true };

  const defaults = {
    ...DEFAULT_CONFIG,
    input: DEFAULT_CONFIG.input()
  };
  const fromEnv = compactObject(envOverrides(env));
  const configPath = args.config || fromEnv.config || env.RESEARCHTOOL_CONFIG;
  const fromFile = await fileOverrides(configPath);
  const fromCli = compactObject(args);
  delete fromCli.config;

  const merged = { ...defaults, ...fromFile, ...fromEnv, ...fromCli };
  return ConfigSchema.parse({
    ...merged,
    keywords: await listFromOption(merged.keywords, defaults.keywords, 'keywords'),
    paths: await listFromOption(merged.paths, defaults.paths, 'paths')
  });
}

module.exports = {
  DEFAULT_CONFIG,
  DEFAULT_KEYWORDS,
  DEFAULT_PATHS,
  ConfigSchema,
  buildConfig,
  parseArgs,
  listFromOption
};
