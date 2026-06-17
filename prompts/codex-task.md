You are helping build an internal compliance research tool.

Goal:
Given a CSV of patent and funding websites, visit each URL, locate its Terms of Use, Copyright, Legal, Data Policy, API Terms, or Usage Terms page, extract relevant clauses, and produce a structured report.

For each source:
1. Visit the homepage URL.
2. Locate likely legal/terms pages from footer links, robots.txt, sitemap.xml, and common paths.
3. Extract visible text from the terms page.
4. Search for permission-related keywords:
   - reuse
   - reproduce
   - republish
   - redistribute
   - commercial use
   - API
   - open data
   - public domain
   - license
   - Creative Commons
   - non-commercial
   - may not reproduce
   - prior written permission
   - automated access
   - scraping
   - crawler
5. Save evidence snippets with the source URL and clause location.
6. Classify the source as:
   - Allowed
   - Likely allowed with attribution
   - API only
   - Permission required
   - Commercial republication prohibited
   - Unclear / needs legal review

Important:
Do not bypass logins, paywalls, captchas, rate limits, robots.txt, or access restrictions.
Do not make legal conclusions. Only summarize evidence and flag risk.
Create both CSV and Markdown reports.