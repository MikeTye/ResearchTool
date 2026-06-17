'use strict';

const CLASSIFICATIONS = Object.freeze({
  ALLOWED: 'Allowed',
  ATTRIBUTION: 'Likely allowed with attribution',
  API_ONLY: 'API only',
  PERMISSION: 'Permission required',
  COMMERCIAL_PROHIBITED: 'Commercial republication prohibited',
  UNCLEAR: 'Unclear / needs legal review'
});

const OUTPUT_NOTE = 'Classification is a research flag based on extracted evidence only; it is not a legal conclusion.';

const RULES = [
  {
    category: CLASSIFICATIONS.COMMERCIAL_PROHIBITED,
    patterns: [
      /\bnon[-\s]?commercial\b/i,
      /\bcommercial\s+use\s+(?:is\s+)?(?:prohibited|forbidden|not\s+permitted|not\s+allowed|disallowed)/i,
      /\b(?:no|not|without|prohibit(?:ed|s)?|forbid(?:den|s)?|restrict(?:ed|s)?)\b[^.]{0,120}\bcommercial\b/i,
      /\bcommercial\b[^.]{0,120}\b(?:republication|redistribution|reuse|use)\b[^.]{0,120}\b(?:prohibited|forbidden|not\s+permitted|not\s+allowed|without\s+(?:prior\s+)?(?:written\s+)?permission)\b/i,
      /\b(?:republication|redistribution)\b[^.]{0,120}\bcommercial\b[^.]{0,120}\b(?:prohibited|forbidden|not\s+permitted|not\s+allowed|restricted)\b/i
    ]
  },
  {
    category: CLASSIFICATIONS.PERMISSION,
    patterns: [
      /\bprior\s+written\s+permission\b/i,
      /\b(?:express|written)\s+permission\b/i,
      /\bpermission\s+(?:is\s+)?required\b/i,
      /\bmay\s+not\s+(?:copy|reproduce|republish|redistribute|reuse|modify|distribute)\b/i,
      /\b(?:no|not)\s+(?:copying|reproduction|republication|redistribution|reuse|distribution)\b/i,
      /\b(?:must|shall)\s+not\s+(?:copy|reproduce|republish|redistribute|reuse|distribute)\b/i,
      /\bwithout\s+(?:our\s+)?(?:prior\s+)?(?:written\s+)?(?:consent|permission|authorization)\b/i
    ]
  },
  {
    category: CLASSIFICATIONS.API_ONLY,
    patterns: [
      /\bapi\s+terms\b/i,
      /\bdeveloper\s+api\b/i,
      /\bapi\s+only\b/i,
      /\baccess\s+(?:is\s+)?(?:available|permitted|provided)\s+(?:only\s+)?(?:through|via)\s+(?:the\s+)?api\b/i,
      /\b(?:only|solely)\s+(?:through|via)\s+(?:the\s+)?api\b/i,
      /\buse\s+(?:of\s+)?(?:the\s+)?api\b[^.]{0,120}\bterms\b/i
    ]
  },
  {
    category: CLASSIFICATIONS.ATTRIBUTION,
    patterns: [
      /\bcreative\s+commons\b[^.]{0,160}\battribution\b/i,
      /\bcc[-\s]?by\b/i,
      /\b(?:open\s+data|public\s+domain|permissive\s+licen[cs]e|creative\s+commons|licen[cs]ed)\b[^.]{0,180}\b(?:attribution|attribute|credit|cite|citation|acknowledge)\b/i,
      /\b(?:attribution|credit|cite|citation|acknowledge)\b[^.]{0,180}\b(?:required|must|shall|should)\b/i
    ]
  },
  {
    category: CLASSIFICATIONS.ALLOWED,
    patterns: [
      /\bpublic\s+domain\b/i,
      /\bopen\s+data\b/i,
      /\bpermissive\s+licen[cs]e\b/i,
      /\bcreative\s+commons\b/i,
      /\bcc0\b/i,
      /\b(?:reuse|reproduce|redistribute|republish|copy|use)\b[^.]{0,120}\b(?:permitted|allowed|free|without\s+restriction)\b/i,
      /\b(?:mit|apache|bsd)\s+licen[cs]e\b/i
    ]
  }
];

function normalizeEvidenceText(evidenceItems = []) {
  return evidenceItems
    .map(item => [item.snippet, item.matchedText, item.keyword].filter(Boolean).join(' '))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchingCategories(text) {
  return RULES.filter(rule => rule.patterns.some(pattern => pattern.test(text))).map(rule => rule.category);
}

function classifyEvidence(evidenceItems = []) {
  const text = normalizeEvidenceText(evidenceItems);
  if (!text) return CLASSIFICATIONS.UNCLEAR;

  const matches = [...new Set(matchingCategories(text))];
  if (!matches.length) return CLASSIFICATIONS.UNCLEAR;

  const hasAllowedSignal = matches.includes(CLASSIFICATIONS.ALLOWED) || matches.includes(CLASSIFICATIONS.ATTRIBUTION);
  const hasRestrictiveSignal = matches.some(category => [
    CLASSIFICATIONS.API_ONLY,
    CLASSIFICATIONS.PERMISSION,
    CLASSIFICATIONS.COMMERCIAL_PROHIBITED
  ].includes(category));
  if (hasAllowedSignal && hasRestrictiveSignal) return CLASSIFICATIONS.UNCLEAR;

  return matches[0];
}

module.exports = {
  CLASSIFICATIONS,
  OUTPUT_NOTE,
  normalizeEvidenceText,
  classifyEvidence
};
