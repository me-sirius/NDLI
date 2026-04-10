const SENTENCE_SPLIT_REGEX = /(?<=[.!?])\s+|\n+/g;
const WORD_REGEX = /[a-z0-9]+/g;
const MIN_SENTENCE_WORDS = 6;
const MAX_SENTENCE_LENGTH = 320;

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'in', 'is', 'it',
  'its', 'of', 'on', 'or', 'that', 'the', 'to', 'was', 'were', 'will', 'with', 'this', 'these',
  'those', 'which', 'into', 'about', 'than', 'then', 'also', 'such', 'their', 'there', 'they',
]);

const LOW_SIGNAL_PATTERNS = [
  /click here/i,
  /watch\b/i,
  /video\b/i,
  /part\s*\d+/i,
  /chapter\s*\d+/i,
  /educator'?s guide/i,
  /timeline\b/i,
  /model question/i,
  /power\s*point/i,
  /rap\b/i,
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  const normalized = normalizeText(text);
  const matches = normalized.match(WORD_REGEX) || [];

  return matches.filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function splitSentences(text) {
  return String(text || '')
    .split(SENTENCE_SPLIT_REGEX)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => {
      if (line.length < 24 || line.length > MAX_SENTENCE_LENGTH) return false;
      const words = line.split(/\s+/).filter(Boolean);
      return words.length >= MIN_SENTENCE_WORDS;
    });
}

function weakSignalPenalty(text) {
  let penalty = 0;

  for (const pattern of LOW_SIGNAL_PATTERNS) {
    if (pattern.test(text)) penalty += 1.2;
  }

  if (/\?$/.test(text.trim())) penalty += 0.4;

  return penalty;
}

function jaccardSimilarity(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;

  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function sourceKey(source) {
  return `${source?.title || ''}|${source?.url || ''}`;
}

function scoreToConfidence(score, minScore, maxScore) {
  const absolute = 1 / (1 + Math.exp(-(score - 3) / 2.2));
  const relative = maxScore > minScore ? (score - minScore) / (maxScore - minScore) : 0.5;
  const blended = 0.6 * absolute + 0.4 * relative;

  return Math.round((0.35 + 0.6 * clamp(blended, 0, 1)) * 100) / 100;
}

function scoreSentence(candidate, queryTokens, queryNormalized, queryTokenSet) {
  const sentenceTokens = tokenize(candidate.text);
  const sentenceTokenSet = new Set(sentenceTokens);
  const uniqueTokenRatio = sentenceTokens.length
    ? sentenceTokenSet.size / sentenceTokens.length
    : 0;

  let matchedCount = 0;
  for (const token of queryTokenSet) {
    if (sentenceTokenSet.has(token)) matchedCount += 1;
  }

  const queryCoverage = queryTokens.length ? matchedCount / queryTokens.length : 0;
  const exactPhraseBoost = queryNormalized && normalizeText(candidate.text).includes(queryNormalized) ? 4 : 0;
  const titleBoost = candidate.fromTitle ? 1.4 : 0;
  const descBoost = candidate.fromTitle ? 0 : 0.55;
  const rankBoost = Math.max(0, 1.8 - candidate.rowIndex * 0.16);
  const positionBoost = candidate.sentenceIndex === 0 ? 0.35 : 0;
  const densityBoost = Math.min(1.2, uniqueTokenRatio * 1.25);
  const lowSignalPenalty = weakSignalPenalty(candidate.text);

  const wordCount = candidate.text.split(/\s+/).length;
  let lengthScore = 0;
  if (wordCount < 6) lengthScore = -1;
  else if (wordCount <= 34) lengthScore = 0.7;
  else if (wordCount <= 48) lengthScore = 0.2;
  else lengthScore = -0.5;

  const score =
    matchedCount * 2.1 +
    queryCoverage * 3.2 +
    exactPhraseBoost +
    titleBoost +
    descBoost +
    rankBoost +
    positionBoost +
    densityBoost +
    lengthScore -
    lowSignalPenalty;

  return {
    score,
    matchedCount,
    sentenceTokens,
  };
}

function buildCandidates(rows) {
  const candidates = [];
  const seenSentences = new Set();

  rows.slice(0, 15).forEach((row, rowIndex) => {
    const source = {
      title: row.title,
      url: row.url || '#',
      author: row.author || 'NDLI',
    };

    const titleText = String(row.title || '').trim();
    const titleTokenCount = tokenize(titleText).length;

    if (titleText.length >= 18 && titleTokenCount >= 6) {
      const titleKey = normalizeText(titleText);
      if (!seenSentences.has(titleKey)) {
        seenSentences.add(titleKey);
        candidates.push({
          text: titleText,
          rowIndex,
          sentenceIndex: 0,
          fromTitle: true,
          source,
        });
      }
    }

    const descSentences = splitSentences(row.desc || '');
    descSentences.forEach((sentence, sentenceIndex) => {
      const key = normalizeText(sentence);
      if (!key || seenSentences.has(key)) return;

      seenSentences.add(key);
      candidates.push({
        text: sentence,
        rowIndex,
        sentenceIndex,
        fromTitle: false,
        source,
      });
    });
  });

  return candidates;
}

function selectBestSentences(scoredCandidates, minSentences, maxSentences) {
  if (!scoredCandidates.length) return [];

  const targetCount = Math.min(maxSentences, Math.max(minSentences, scoredCandidates.length > 10 ? 4 : 3));
  const selected = [];
  const sourceCounter = new Map();

  for (const candidate of scoredCandidates) {
    if (selected.length >= targetCount) break;
    if (candidate.matchedCount === 0 && selected.length > 0) continue;
    if (candidate.score < 0.5 && selected.length >= minSentences) continue;

    const sourceKey = `${candidate.source.title}|${candidate.source.url}`;
    const currentSourceCount = sourceCounter.get(sourceKey) || 0;
    if (currentSourceCount >= 2) continue;

    const isTooSimilar = selected.some((chosen) => {
      const similarity = jaccardSimilarity(candidate.sentenceTokens, chosen.sentenceTokens);
      return similarity >= 0.74;
    });

    if (isTooSimilar) continue;

    selected.push(candidate);
    sourceCounter.set(sourceKey, currentSourceCount + 1);
  }

  if (selected.length < minSentences) {
    for (const candidate of scoredCandidates) {
      if (selected.length >= minSentences) break;
      if (selected.includes(candidate)) continue;

      selected.push(candidate);
    }
  }

  return selected.slice(0, maxSentences);
}

function buildSentenceDetails(selectedSentences) {
  const scores = selectedSentences.map((item) => item.score);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);

  const sourceRefByKey = new Map();
  const sources = [];

  const sentenceDetails = selectedSentences.map((item) => {
    const key = sourceKey(item.source);
    let sourceRef = sourceRefByKey.get(key);

    if (!sourceRef) {
      sourceRef = sources.length + 1;
      sourceRefByKey.set(key, sourceRef);
      sources.push({
        ...item.source,
        ref: sourceRef,
      });
    }

    return {
      text: item.text,
      confidence: scoreToConfidence(item.score, minScore, maxScore),
      sourceRef,
      citation: `[${sourceRef}]`,
    };
  });

  return {
    sentenceDetails,
    sources: sources.slice(0, 4),
  };
}

export function buildExtractiveOverview({ query, rows, minSentences = 2, maxSentences = 4 }) {
  const queryText = String(query || '').trim();
  const safeRows = Array.isArray(rows) ? rows : [];

  if (!queryText || !safeRows.length) {
    return null;
  }

  const queryTokens = tokenize(queryText);
  const queryTokenSet = new Set(queryTokens);
  const queryNormalized = normalizeText(queryText);
  const candidates = buildCandidates(safeRows);

  if (!candidates.length) return null;

  const scored = candidates
    .map((candidate) => {
      const scoredCandidate = scoreSentence(candidate, queryTokens, queryNormalized, queryTokenSet);
      return {
        ...candidate,
        ...scoredCandidate,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.rowIndex !== b.rowIndex) return a.rowIndex - b.rowIndex;
      return a.sentenceIndex - b.sentenceIndex;
    });

  const selected = selectBestSentences(scored, minSentences, maxSentences);
  if (!selected.length) return null;

  const { sentenceDetails, sources } = buildSentenceDetails(selected);
  const summarySentences = sentenceDetails.map((item) => item.text);
  const summaryText = summarySentences.join(' ');
  const summaryTextWithCitations = sentenceDetails
    .map((item) => `${item.text} ${item.citation}`)
    .join(' ');

  return {
    snippet: summaryText,
    snippetWithCitations: summaryTextWithCitations,
    sentences: summarySentences,
    sentenceDetails,
    sources,
  };
}
