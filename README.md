# ResearchTool

ResearchTool is an internal compliance research CLI for reviewing patent, funding, and research-related websites. It visits each source URL in a CSV, discovers likely legal or terms pages, extracts permission-related evidence snippets, and writes CSV and Markdown reports.

> **Important:** ResearchTool summarizes evidence and flags risk. It does **not** make legal conclusions and does **not** provide legal advice. Any unclear, high-risk, or business-critical use should be reviewed by qualified counsel.

## Expected CSV format

Provide a CSV with headers. The tool looks for a URL in one of these columns:

- `url`
- `URL`
- `website`
- `source`
- `link`
- `LINK`

If the CSV has only one column, that column is treated as the URL column.

Example:

```csv
ORGANIZATION,LINK
NIH Reporter,https://reporter.nih.gov/funding/search
NSF Funding Opportunities,https://www.nsf.gov/funding/opportunities
Wellcome Trust Schemes,https://wellcome.org/grant-funding/schemes
```

URLs may include or omit the `https://` scheme. When a scheme is omitted, the tool normalizes the value to `https://`.

## Installation

```sh
npm install
```

Playwright may require browser dependencies in some environments. If your environment does not already have them, follow the Playwright setup instructions for your platform.

## Example command

Run with the default input path (`input/source.csv`) and default output directory (`reports`):

```sh
npm run research
```

Run with an explicit CSV, output directory, and config file:

```sh
npm run research -- --input input/source.csv --output-dir reports --config config.example.json
```

The equivalent npm start alias is also available:

```sh
npm start -- --input input/source.csv
```

## Configuration options

Configuration can be supplied through defaults, a JSON config file, environment variables, or CLI flags. Later sources override earlier ones in this order:

1. Built-in defaults
2. JSON config file specified with `--config` or `RESEARCHTOOL_CONFIG`
3. Environment variables
4. CLI flags

### Common CLI flags

| Option | Description | Default |
| --- | --- | --- |
| `--input <path>` | Source CSV path. | `input/source.csv`, or `/input/source.csv` if present |
| `--output-dir <path>` | Directory where reports are written. | `reports` |
| `--config <path>` | JSON config file containing overrides. | none |
| `--keywords <value>` | Comma-separated keywords or a path to a JSON file containing a keyword array. | built-in keyword list |
| `--paths <value>` | Comma-separated legal/common paths or a path to a JSON file containing a path array. | built-in path list |
| `--concurrency <n>` | Number of sites to process concurrently. | `2` |
| `--timeout-ms <n>` | HTTP timeout in milliseconds. | `15000` |
| `--user-agent <value>` | User-Agent header for requests. | `ResearchTool/1.0 (+https://github.com/MikeTye/ResearchTool)` |
| `--snippet-context-length <n>` | Characters to keep before and after each keyword match. | `250` |
| `--max-snippets-per-page <n>` | Maximum snippets to keep from each fetched page. | `10` |

### Environment variables

- `RESEARCHTOOL_CONFIG`
- `RESEARCHTOOL_INPUT`
- `RESEARCHTOOL_OUTPUT_DIR`
- `RESEARCHTOOL_KEYWORDS`
- `RESEARCHTOOL_PATHS`
- `RESEARCHTOOL_CONCURRENCY`
- `RESEARCHTOOL_TIMEOUT_MS`
- `RESEARCHTOOL_USER_AGENT`
- `RESEARCHTOOL_SNIPPET_CONTEXT_LENGTH`
- `RESEARCHTOOL_MAX_SNIPPETS_PER_PAGE`

### Keyword overrides

The default keyword list targets terms related to reuse, redistribution, licensing, APIs, public-domain/open-data status, commercial use, and automated access. Override it when your review needs different evidence terms.

Example CLI override:

```sh
npm run research -- --keywords "reuse,license,commercial use,automated access,API"
```

Example JSON config override:

```json
{
  "keywords": [
    "reuse",
    "license",
    "commercial use",
    "automated access",
    "API"
  ]
}
```

### Common path overrides

The default path list includes common legal, terms, copyright, data-policy, API-terms, robots, and sitemap paths. Override it when reviewing sites that use known custom routes.

Example CLI override:

```sh
npm run research -- --paths "/terms,/legal,/copyright,/data-policy,/api-terms,/robots.txt,/sitemap.xml"
```

Example JSON config override:

```json
{
  "paths": [
    "/terms",
    "/legal",
    "/copyright",
    "/data-policy",
    "/api-terms",
    "/robots.txt",
    "/sitemap.xml"
  ]
}
```

See [`config.example.json`](config.example.json) for a complete example.

## Output files

Reports are written to the configured output directory.

### `report.csv`

A row-oriented evidence report suitable for spreadsheets and downstream review. Columns include:

- `source_url`: Original source URL from the input CSV.
- `normalized_origin`: Normalized site origin.
- `terms_url`: Legal, terms, policy, robots, sitemap, or source URL where evidence was found or attempted.
- `discovery_method`: How the URL was discovered, such as source URL, footer/link discovery, robots, sitemap, or common path.
- `http_status`: HTTP status observed during fetching, when available.
- `classification`: Tool-generated evidence category.
- `keyword`: Keyword that matched the snippet, or status marker such as blocked/inaccessible.
- `snippet`: Evidence text or access note.
- `notes`: Fetch, blocked, or error details.

### `report.md`

A reviewer-friendly Markdown report grouped by source. Each source section includes:

- normalized origin
- final evidence classification
- discovered legal/terms URLs
- evidence snippets
- blocked or inaccessible notes
- unanswered or unclear status

## Classification categories

The tool classifies evidence into one of these review-oriented categories:

- `Allowed`
- `Likely allowed with attribution`
- `API only`
- `Permission required`
- `Commercial republication prohibited`
- `Unclear / needs legal review`

These labels are triage aids only. They are not legal conclusions.

## Ethical and access constraints

This project is intended for responsible, internal compliance research. When using it:

- Do not bypass logins.
- Do not bypass paywalls.
- Do not bypass CAPTCHAs.
- Do not bypass rate limits.
- Do not bypass `robots.txt` or other access restrictions.
- Do not evade technical controls or site policies.
- Use evidence snippets to summarize and flag risk rather than to make legal conclusions.
- Treat unclear findings as needing legal review.

## Available npm scripts

- `npm run research` / `npm start`: run the CLI.
- `npm run check`: placeholder for future linting or type checking.
- `npm test`: currently aliases the placeholder check script.
