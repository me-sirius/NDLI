const SENTENCE_SPLIT_REGEX = /(?<=[.!?])\s+|\n+/g;
const WORD_REGEX = /[a-z0-9]+/g;
const MIN_SENTENCE_WORDS = 6;
const MIN_SENTENCE_LENGTH = 24;
const MAX_SENTENCE_LENGTH = 320;
const MAX_SENTENCES_PER_SOURCE = 2;
const MAX_SOURCES = 4;
const DEDUPE_SIMILARITY_THRESHOLD = 0.78;
const CLUSTER_SIMILARITY_THRESHOLD = 0.75;

const EMBEDDING_SERVICE_URL = (process.env.EMBEDDING_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const EMBEDDING_SERVICE_TIMEOUT_MS = parsePositiveInt(process.env.EMBEDDING_SERVICE_TIMEOUT_MS, 4500);
const CANDIDATE_ROW_LIMIT = parsePositiveInt(process.env.AI_OVERVIEW_MAX_ROWS, 15);

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'in', 'is', 'it',
  'its', 'of', 'on', 'or', 'that', 'the', 'to', 'was', 'were', 'will', 'with', 'this', 'these',
  'those', 'which', 'into', 'about', 'than', 'then', 'also', 'such', 'their', 'there', 'they',
]);

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

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
      if (line.length < MIN_SENTENCE_LENGTH || line.length > MAX_SENTENCE_LENGTH) return false;
      const words = line.split(/\s+/).filter(Boolean);
      return words.length >= MIN_SENTENCE_WORDS;
    });
}

function sourceKey(source) {
  return `${source?.title || ''}|${source?.url || ''}`;
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    const valueA = a[i];
    const valueB = b[i];
    dot += valueA * valueB;
    normA += valueA * valueA;
    normB += valueB * valueB;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
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

function keywordOverlapScore(query, sentence) {
  const queryWords = String(query || '').toLowerCase().split(/\W+/).filter(Boolean);
  if (!queryWords.length) return 0;

  const sentenceWords = new Set(
    String(sentence || '').toLowerCase().split(/\W+/).filter(Boolean),
  );

  let overlap = 0;
  queryWords.forEach((word) => {
    if (sentenceWords.has(word)) {
      overlap += 1;
    }
  });

  return overlap / queryWords.length;
}

function positionScore(index) {
  if (index === 0) return 1.0;
  if (index === 1) return 0.8;
  if (index === 2) return 0.6;
  return 0.4;
}

function sortByScoreThenPosition(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (a.rowIndex !== b.rowIndex) return a.rowIndex - b.rowIndex;
  return a.sentenceIndex - b.sentenceIndex;
}

function clusterSentences(sentences, threshold = CLUSTER_SIMILARITY_THRESHOLD) {
  const clusters = [];

  sentences.forEach((sentence) => {
    if (!Array.isArray(sentence.embedding) || sentence.embedding.length === 0) {
      clusters.push([sentence]);
      return;
    }

    let added = false;

    for (const cluster of clusters) {
      const anchor = cluster[0];
      if (!Array.isArray(anchor.embedding) || anchor.embedding.length === 0) continue;

      const similarity = cosineSimilarity(sentence.embedding, anchor.embedding);
      if (similarity > threshold) {
        cluster.push(sentence);
        added = true;
        break;
      }
    }

    if (!added) {
      clusters.push([sentence]);
    }
  });

  return clusters;
}

function buildCandidates(rows) {
  const candidates = [];
  const seenSentences = new Set();

  rows.slice(0, CANDIDATE_ROW_LIMIT).forEach((row, rowIndex) => {
    const source = {
      title: String(row?.title || 'Untitled').trim() || 'Untitled',
      url: String(row?.url || '#').trim() || '#',
      author: String(row?.author || 'NDLI').trim() || 'NDLI',
    };

    const titleText = String(row?.title || '').trim();
    const titleTokenCount = tokenize(titleText).length;

    if (titleText.length >= 18 && titleTokenCount >= 6) {
      const titleHash = normalizeText(titleText);
      if (!seenSentences.has(titleHash)) {
        seenSentences.add(titleHash);
        candidates.push({
          text: titleText,
          rowIndex,
          sentenceIndex: 0,
          source,
          fromTitle: true,
        });
      }
    }

    splitSentences(row?.desc || '').forEach((sentence, sentenceIndex) => {
      const sentenceHash = normalizeText(sentence);
      if (!sentenceHash || seenSentences.has(sentenceHash)) return;

      seenSentences.add(sentenceHash);
      candidates.push({
        text: sentence,
        rowIndex,
        sentenceIndex,
        source,
        fromTitle: false,
      });
    });
  });

  return candidates;
}

async function getEmbeddings(texts) {
  if (!Array.isArray(texts) || texts.length === 0) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EMBEDDING_SERVICE_TIMEOUT_MS);

  try {
    const response = await fetch(`${EMBEDDING_SERVICE_URL}/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ texts }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Embedding service failed with status ${response.status}`);
    }

    const data = await response.json();
    const vectors = data?.embeddings;

    if (!Array.isArray(vectors) || vectors.length !== texts.length) {
      return null;
    }

    const expectedDimension = Array.isArray(vectors[0]) ? vectors[0].length : 0;
    if (!expectedDimension) return null;

    const hasInvalidVector = vectors.some((vector) => (
      !Array.isArray(vector)
      || vector.length !== expectedDimension
      || vector.some((value) => !Number.isFinite(value))
    ));

    if (hasInvalidVector) return null;
    return vectors;
  } catch (error) {
    console.warn('[summarizer] embedding lookup failed, falling back to heuristic scoring', {
      message: error?.message,
      serviceUrl: EMBEDDING_SERVICE_URL,
    });
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function scoreCandidatesWithEmbeddings(queryText, candidates, embeddings) {
  const queryEmbedding = embeddings[0];

  return candidates
    .map((candidate, index) => {
      const sentenceEmbedding = embeddings[index + 1];
      const semanticScore = cosineSimilarity(queryEmbedding, sentenceEmbedding);
      const keywordScore = keywordOverlapScore(queryText, candidate.text);
      const structureScore = positionScore(index);

      return {
        ...candidate,
        embedding: sentenceEmbedding,
        score: clamp(
          0.6 * semanticScore
          + 0.25 * keywordScore
          + 0.15 * structureScore,
          0,
          1,
        ),
        sentenceTokens: tokenize(candidate.text),
      };
    })
    .sort(sortByScoreThenPosition);
}

function selectClusterRepresentativeSentences(scoredCandidates, minSentences, maxSentences) {
  if (!scoredCandidates.length) return [];

  const clusters = clusterSentences(scoredCandidates);
  const representatives = clusters
    .map((cluster) => {
      cluster.sort(sortByScoreThenPosition);
      return cluster[0];
    })
    .sort(sortByScoreThenPosition);

  const selected = representatives.slice(0, Math.min(maxSentences, 3));
  if (selected.length >= minSentences) return selected;

  for (const candidate of scoredCandidates) {
    if (selected.length >= minSentences || selected.length >= maxSentences) break;
    if (selected.includes(candidate)) continue;
    selected.push(candidate);
  }

  return selected;
}

function scoreCandidatesFallback(candidates) {
  const maxRowIndex = Math.max(...candidates.map((candidate) => candidate.rowIndex), 0);

  return candidates
    .map((candidate) => {
      const rowScore = maxRowIndex > 0 ? 1 - (candidate.rowIndex / (maxRowIndex + 1)) : 1;
      const positionBoost = candidate.sentenceIndex === 0 ? 0.12 : 0;
      const titleBoost = candidate.fromTitle ? 0.08 : 0;

      return {
        ...candidate,
        score: clamp(0.4 + rowScore * 0.5 + positionBoost + titleBoost, 0, 1),
        sentenceTokens: tokenize(candidate.text),
      };
    })
    .sort(sortByScoreThenPosition);
}

function selectBestSentences(scoredCandidates, minSentences, maxSentences) {
  if (!scoredCandidates.length) return [];

  const targetCount = Math.min(
    maxSentences,
    Math.max(minSentences, scoredCandidates.length > 10 ? 4 : 3),
  );

  const selected = [];
  const sourceCounter = new Map();
  const sourcePool = new Set();

  for (const candidate of scoredCandidates) {
    if (selected.length >= targetCount) break;

    const key = sourceKey(candidate.source);
    const sourceCount = sourceCounter.get(key) || 0;
    const introducesNewSource = !sourcePool.has(key);

    if (sourceCount >= MAX_SENTENCES_PER_SOURCE) continue;
    if (introducesNewSource && sourcePool.size >= MAX_SOURCES) continue;

    const tooSimilar = selected.some((picked) => (
      jaccardSimilarity(candidate.sentenceTokens, picked.sentenceTokens) >= DEDUPE_SIMILARITY_THRESHOLD
    ));
    if (tooSimilar) continue;

    selected.push(candidate);
    sourceCounter.set(key, sourceCount + 1);
    sourcePool.add(key);
  }

  if (selected.length < minSentences) {
    for (const candidate of scoredCandidates) {
      if (selected.length >= minSentences) break;
      if (selected.includes(candidate)) continue;

      const key = sourceKey(candidate.source);
      const sourceCount = sourceCounter.get(key) || 0;
      const introducesNewSource = !sourcePool.has(key);

      if (sourceCount >= MAX_SENTENCES_PER_SOURCE) continue;
      if (introducesNewSource && sourcePool.size >= MAX_SOURCES) continue;

      selected.push(candidate);
      sourceCounter.set(key, sourceCount + 1);
      sourcePool.add(key);
    }
  }

  return selected.slice(0, maxSentences);
}

function scoreToConfidence(score) {
  return Math.round((0.35 + 0.6 * clamp(score, 0, 1)) * 100) / 100;
}

function buildOverview(selectedSentences) {
  if (!selectedSentences.length) return null;

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
      confidence: scoreToConfidence(item.score),
      sourceRef,
      citation: `[${sourceRef}]`,
    };
  });

  const summarySentences = sentenceDetails.map((item) => item.text);
  const snippet = summarySentences.join(' ');
  const snippetWithCitations = sentenceDetails
    .map((item) => `${item.text} ${item.citation}`)
    .join(' ');

  return {
    snippet,
    snippetWithCitations,
    sentences: summarySentences,
    sentenceDetails,
    sources: sources.slice(0, MAX_SOURCES),
  };
}

export async function generateOverview(query, rows, options = {}) {
  const queryText = String(query || '').trim();
  const safeRows = Array.isArray(rows) ? rows : [];
  const requestedMin = parsePositiveInt(options.minSentences, 2);
  const requestedMax = parsePositiveInt(options.maxSentences, 4);
  const minSentences = Math.min(requestedMin, requestedMax);
  const maxSentences = Math.max(requestedMin, requestedMax);

  if (!queryText || !safeRows.length) {
    return null;
  }

  const candidates = buildCandidates(safeRows);
  if (!candidates.length) return null;

  const texts = [queryText, ...candidates.map((candidate) => candidate.text)];
  const embeddings = await getEmbeddings(texts);
  if (embeddings) {
    const scoredCandidates = scoreCandidatesWithEmbeddings(queryText, candidates, embeddings);
    const selected = selectClusterRepresentativeSentences(scoredCandidates, minSentences, maxSentences);
    return buildOverview(selected);
  }

  const scoredCandidates = scoreCandidatesFallback(candidates);
  const selected = selectBestSentences(scoredCandidates, minSentences, maxSentences);
  return buildOverview(selected);
}
