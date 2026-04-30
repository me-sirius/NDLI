import 'dotenv/config';

const SENTENCE_SPLIT_REGEX = /(?<=[.!?])\s+|\n+/g;
const WORD_REGEX = /[a-z0-9]+/g;
const MIN_SENTENCE_WORDS = 6;
const MIN_SENTENCE_LENGTH = 24;
const MIN_GENERATED_SENTENCE_LENGTH = 20;
const MAX_SENTENCE_LENGTH = 320;
const MAX_SENTENCES_PER_SOURCE = parsePositiveInt(process.env.AI_OVERVIEW_MAX_SENTENCES_PER_SOURCE, 3);
const MAX_SOURCES = 4;
const DEDUPE_SIMILARITY_THRESHOLD = 0.78;
const CLUSTER_SIMILARITY_THRESHOLD = 0.75;

const EMBEDDING_SERVICE_URL = (process.env.EMBEDDING_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const EMBEDDING_SERVICE_TIMEOUT_MS = parsePositiveInt(process.env.EMBEDDING_SERVICE_TIMEOUT_MS, 4500);
const SUMMARIZE_SERVICE_TIMEOUT_MS = parsePositiveInt(process.env.AI_OVERVIEW_SUMMARIZE_TIMEOUT_MS, 20000);
const RAG_EVIDENCE_SENTENCE_LIMIT = parsePositiveInt(process.env.AI_OVERVIEW_RAG_EVIDENCE_SENTENCE_LIMIT, 12);
const RAG_MAX_NEW_TOKENS = parsePositiveInt(process.env.AI_OVERVIEW_RAG_MAX_NEW_TOKENS, 280);
const ALIGNMENT_SCORE_THRESHOLD = parsePositiveNumber(process.env.AI_OVERVIEW_ALIGNMENT_THRESHOLD, 0.55);
const ENABLE_GENERATIVE_OVERVIEW = String(process.env.AI_OVERVIEW_GENERATIVE || 'true').toLowerCase() !== 'false';
const CANDIDATE_ROW_LIMIT = parsePositiveInt(process.env.AI_OVERVIEW_MAX_ROWS, 20);

let summarizeCapabilityKnown = false;
let summarizeCapabilityAvailable = false;

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'in', 'is', 'it',
  'its', 'of', 'on', 'or', 'that', 'the', 'to', 'was', 'were', 'will', 'with', 'this', 'these',
  'those', 'which', 'into', 'about', 'than', 'then', 'also', 'such', 'their', 'there', 'they',
]);

const ANCHOR_GENERIC_TOKENS = new Set([
  'cause', 'causes', 'reason', 'reasons', 'why', 'effect', 'effects', 'impact', 'overview', 'summary',
  'explain', 'explanation', 'introduction', 'background', 'history', 'timeline', 'meaning', 'definition',
  'difference', 'differences', 'compare', 'comparison', 'between', 'who', 'what', 'when', 'where', 'how',
  'uprising', 'revolution', 'war', 'battle', 'conflict', 'movement', 'protest', 'rebellion',
  'insurrection', 'riot',
]);

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return 0;

  const sentenceTokens = new Set(tokenize(sentence));
  let overlap = 0;

  for (const token of queryTokens) {
    if (sentenceTokens.has(token)) overlap += 1;
  }

  return overlap / queryTokens.length;
}

function keywordOverlapScoreWithTitle(query, sentence, title) {
  return keywordOverlapScore(query, `${sentence || ''} ${title || ''}`);
}

function computeAnchorTokens(queryText, candidates) {
  const originalQueryTokens = tokenize(queryText);
  if (!originalQueryTokens.length || !Array.isArray(candidates) || candidates.length === 0) return [];

  const filteredQueryTokens = originalQueryTokens.filter((token) => !ANCHOR_GENERIC_TOKENS.has(token));
  const queryTokens = filteredQueryTokens.length ? filteredQueryTokens : originalQueryTokens;

  const counts = new Map(queryTokens.map((token) => [token, 0]));

  for (const candidate of candidates) {
    if (!Array.isArray(candidate.sentenceTokens)) {
      candidate.sentenceTokens = tokenize(candidate.text);
    }

    const combined = new Set([
      ...candidate.sentenceTokens,
      ...tokenize(candidate?.source?.title),
    ]);

    for (const token of queryTokens) {
      if (combined.has(token)) {
        counts.set(token, (counts.get(token) || 0) + 1);
      }
    }
  }

  const present = queryTokens.filter((token) => (counts.get(token) || 0) > 0);
  if (!present.length) return [];

  present.sort((a, b) => (counts.get(a) || 0) - (counts.get(b) || 0));

  const anchors = present.slice(0, Math.min(2, present.length));

  // Only enforce anchors if they actually narrow candidates.
  let matches = 0;
  for (const candidate of candidates) {
    const combined = new Set([
      ...(Array.isArray(candidate.sentenceTokens) ? candidate.sentenceTokens : tokenize(candidate.text)),
      ...tokenize(candidate?.source?.title),
    ]);

    if (anchors.some((token) => combined.has(token))) {
      matches += 1;
    }
  }

  if (matches === 0 || matches === candidates.length) return [];
  return anchors;
}

function positionScore(index) {
  if (index === 0) return 1.0;
  if (index === 1) return 0.8;
  if (index === 2) return 0.6;
  return 0.4;
}

function sortByScoreThenPosition(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  const credibilityA = Number.isFinite(a?.credibilityScore) ? a.credibilityScore : 0;
  const credibilityB = Number.isFinite(b?.credibilityScore) ? b.credibilityScore : 0;
  if (credibilityB !== credibilityA) return credibilityB - credibilityA;
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

function buildSourcesFromEvidence(selectedSentences) {
  const sourceRefByKey = new Map();
  const sources = [];

  for (const item of selectedSentences || []) {
    const key = sourceKey(item?.source);
    if (!key) continue;

    if (!sourceRefByKey.has(key)) {
      const ref = sources.length + 1;
      sourceRefByKey.set(key, ref);
      sources.push({
        ...item.source,
        ref,
      });

      if (sources.length >= MAX_SOURCES) break;
    }
  }

  return { sources, sourceRefByKey };
}

function buildCandidates(rows) {
  const candidates = [];
  const sentenceIndexByHash = new Map();

  function upsertCandidate(candidate) {
    const sentenceHash = normalizeText(candidate?.text || '');
    if (!sentenceHash) return;

    const existingIndex = sentenceIndexByHash.get(sentenceHash);
    if (existingIndex === undefined) {
      sentenceIndexByHash.set(sentenceHash, candidates.length);
      candidates.push(candidate);
      return;
    }

    const existing = candidates[existingIndex];
    const existingCredibility = sourceCredibilityScore(existing?.source);
    const candidateCredibility = sourceCredibilityScore(candidate?.source);

    if (candidateCredibility > existingCredibility) {
      candidates[existingIndex] = candidate;
    }
  }

  rows.slice(0, CANDIDATE_ROW_LIMIT).forEach((row, rowIndex) => {
    const source = {
      title: String(row?.title || 'Untitled').trim() || 'Untitled',
      url: String(row?.url || '#').trim() || '#',
      author: String(row?.author || 'NDLI').trim() || 'NDLI',
    };

    const titleText = String(row?.title || '').trim();
    const titleTokenCount = tokenize(titleText).length;

    if (titleText.length >= 18 && titleTokenCount >= 6) {
      upsertCandidate({
        text: titleText,
        rowIndex,
        sentenceIndex: 0,
        source,
        fromTitle: true,
      });
    }

    splitSentences(row?.desc || '').forEach((sentence, sentenceIndex) => {
      upsertCandidate({
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
      const keywordScore = keywordOverlapScoreWithTitle(queryText, candidate.text, candidate?.source?.title);
      const structureScore = positionScore(index);
      const credibilityScore = sourceCredibilityScore(candidate.source);

      return {
        ...candidate,
        embedding: sentenceEmbedding,
        credibilityScore,
        score: clamp(
          0.5 * semanticScore
          + 0.2 * keywordScore
          + 0.1 * structureScore
          + 0.2 * credibilityScore,
          0,
          1,
        ),
        sentenceTokens: tokenize(candidate.text),
      };
    })
    .sort(sortByScoreThenPosition);
}

function selectClusterRepresentativeSentences(scoredCandidates, minSentences, maxSentences, intent = 'general') {
  if (!scoredCandidates.length) return [];

  const clusters = clusterSentences(scoredCandidates);
  const representatives = clusters
    .map((cluster) => {
      cluster.sort(sortByScoreThenPosition);
      return cluster[0];
    })
    .sort(sortByScoreThenPosition);

  const sortedRepresentatives = [...representatives].sort((a, b) => b.score - a.score);
  const targetCount = clamp(intent === 'definition' ? 2 : 3, minSentences, maxSentences);

  let best;

  if (intent === 'definition') {
    best = sortedRepresentatives.slice(0, targetCount);
  } else if (intent === 'timeline') {
    best = sortedRepresentatives
      .filter((sentence) => /\b\d{4}\b/.test(sentence.text))
      .slice(0, targetCount);
  } else if (intent === 'comparison') {
    best = sortedRepresentatives
      .filter((sentence) => {
        const text = String(sentence.text || '').toLowerCase();
        return text.includes('whereas') || text.includes('while') || text.includes('however');
      })
      .slice(0, targetCount);
  } else if (intent === 'biography') {
    best = sortedRepresentatives
      .filter((sentence) => {
        const text = String(sentence.text || '').toLowerCase();
        return text.includes('born') || text.includes('was') || text.includes('leader');
      })
      .slice(0, targetCount);
  } else {
    best = sortedRepresentatives.slice(0, targetCount);
  }

  const selected = [...best];
  if (selected.length >= targetCount) return selected;

  const prioritized = prioritizeCandidatesForIntent(scoredCandidates, intent);

  for (const candidate of prioritized) {
    if (selected.length >= targetCount) break;
    if (selected.includes(candidate)) continue;
    selected.push(candidate);
  }

  return selected.slice(0, targetCount);
}

function scoreCandidatesFallback(queryText, candidates) {
  const maxRowIndex = Math.max(...candidates.map((candidate) => candidate.rowIndex), 0);
  const safeQueryText = String(queryText || '');

  return candidates
    .map((candidate) => {
      const rowScore = maxRowIndex > 0 ? 1 - (candidate.rowIndex / (maxRowIndex + 1)) : 1;
      const positionBoost = candidate.sentenceIndex === 0 ? 0.12 : 0;
      const titleBoost = candidate.fromTitle ? 0.08 : 0;
      const credibilityScore = sourceCredibilityScore(candidate.source);
      const baseScore = clamp(0.4 + rowScore * 0.5 + positionBoost + titleBoost, 0, 1);
      const keywordScore = keywordOverlapScoreWithTitle(safeQueryText, candidate.text, candidate?.source?.title);

      return {
        ...candidate,
        credibilityScore,
        score: clamp(0.45 * keywordScore + 0.35 * baseScore + 0.2 * credibilityScore, 0, 1),
        sentenceTokens: tokenize(candidate.text),
      };
    })
    .sort(sortByScoreThenPosition);
}

function cleanNarrativeSummary(summaryText) {
  let text = String(summaryText || '').trim();
  if (!text) return '';

  // Remove echoed source metadata lines like: "[1] Title — Author — https://..." or "— #".
  const lines = text.split(/\r?\n+/).map((line) => line.trim()).filter(Boolean);
  const filtered = lines.filter((line) => {
    const looksLikeMeta = /^\[\d+\]\s+.+\s—\s.+\s—\s(https?:\/\/\S+|#)\s*$/i.test(line);
    return !looksLikeMeta;
  });

  text = filtered.join(' ');
  text = text.replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
  return text;
}

function splitGeneratedSummary(summaryText) {
  return String(summaryText || '')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= MIN_GENERATED_SENTENCE_LENGTH);
}

function roundConfidence(score) {
  return Math.round(clamp(score, 0, 1) * 100) / 100;
}

function attachOverviewMeta(overview, meta) {
  if (!overview) return null;
  return {
    ...overview,
    meta: meta ? { ...meta } : undefined,
  };
}

function logNarrativeStatus(meta, requestId) {
  if (!meta) return;
  const prefix = requestId ? `[${requestId}]` : '[summarizer]';
  const payload = {
    status: meta.status,
    reason: meta.reason,
    summarizer: meta.summarizer,
    alignment: meta.alignment,
  };

  if (meta.status === 'aligned') {
    console.info(`${prefix} narrative summary aligned`, payload);
  } else {
    console.warn(`${prefix} narrative summary skipped`, payload);
  }
}

async function verifyEvidenceAlignment(generatedSentences, evidenceSentences) {
  if (!Array.isArray(generatedSentences) || generatedSentences.length === 0) return [];
  if (!Array.isArray(evidenceSentences) || evidenceSentences.length === 0) return [];

  const evidenceTextItems = evidenceSentences
    .map((item) => ({
      evidence: item,
      text: String(item?.text || '').trim(),
    }))
    .filter((item) => item.text);

  if (!evidenceTextItems.length) return [];

  const texts = [
    ...generatedSentences,
    ...evidenceTextItems.map((item) => item.text),
  ];

  const embeddings = await getEmbeddings(texts);
  if (!embeddings) return null;

  const generatedEmbeddings = embeddings.slice(0, generatedSentences.length);
  const evidenceEmbeddings = embeddings.slice(generatedSentences.length);

  return generatedSentences.map((sentence, i) => {
    let bestScore = 0;
    let bestIndex = -1;

    evidenceEmbeddings.forEach((vector, j) => {
      const score = cosineSimilarity(generatedEmbeddings[i], vector);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = j;
      }
    });

    const bestEvidence = bestIndex >= 0 ? evidenceTextItems[bestIndex].evidence : null;

    return {
      sentence,
      confidence: bestScore,
      evidence: bestEvidence,
    };
  });
}

function pickEvidenceSentences(scoredCandidates, intent, maxEvidence, queryText) {
  const target = Math.max(1, Number(maxEvidence) || 0);
  const prioritized = prioritizeCandidatesForIntent(scoredCandidates, intent);

  const anchorTokens = computeAnchorTokens(queryText, prioritized);

  function candidateMatchesAnchors(candidate) {
    if (!anchorTokens.length) return true;

    if (!Array.isArray(candidate.sentenceTokens)) {
      candidate.sentenceTokens = tokenize(candidate.text);
    }

    const combined = new Set([
      ...candidate.sentenceTokens,
      ...tokenize(candidate?.source?.title),
    ]);

    return anchorTokens.some((token) => combined.has(token));
  }

  function buildEvidence({ allowTitles, enforceAnchors }) {
    const evidence = [];
    const sourceCounter = new Map();
    const sourcePool = new Set();

    for (const candidate of prioritized) {
      if (evidence.length >= target) break;
      if (!allowTitles && candidate.fromTitle) continue;
      if (enforceAnchors && !candidateMatchesAnchors(candidate)) continue;

      const key = sourceKey(candidate.source);
      const sourceCount = sourceCounter.get(key) || 0;
      const introducesNewSource = !sourcePool.has(key);

      if (sourceCount >= MAX_SENTENCES_PER_SOURCE) continue;
      if (introducesNewSource && sourcePool.size >= MAX_SOURCES) continue;

      if (!Array.isArray(candidate.sentenceTokens)) {
        candidate.sentenceTokens = tokenize(candidate.text);
      }

      const tooSimilar = evidence.some((picked) => (
        jaccardSimilarity(candidate.sentenceTokens, picked.sentenceTokens) >= DEDUPE_SIMILARITY_THRESHOLD
      ));
      if (tooSimilar) continue;

      evidence.push(candidate);
      sourceCounter.set(key, sourceCount + 1);
      sourcePool.add(key);
    }

    return evidence;
  }

  // Prefer descriptive evidence (skip titles) and enforce anchors when available.
  let evidence = buildEvidence({ allowTitles: false, enforceAnchors: true });

  // If anchors are too strict, retry without anchor enforcement.
  if (!evidence.length) {
    evidence = buildEvidence({ allowTitles: false, enforceAnchors: false });
  }

  // If still empty, allow titles as a last resort.
  if (!evidence.length) {
    evidence = buildEvidence({ allowTitles: true, enforceAnchors: false });
  }

  return evidence;
}

async function generateNarrativeSummary({ queryText, intent, evidenceSentences, statusRef }) {
  if (!ENABLE_GENERATIVE_OVERVIEW) {
    if (statusRef) {
      statusRef.status = 'skipped';
      statusRef.reason = 'disabled';
      statusRef.summarizer = 'disabled';
    }
    return null;
  }
  if (!Array.isArray(evidenceSentences) || evidenceSentences.length === 0) {
    if (statusRef) {
      statusRef.status = 'skipped';
      statusRef.reason = 'no_evidence';
    }
    return null;
  }
  if (summarizeCapabilityKnown && !summarizeCapabilityAvailable) {
    if (statusRef) {
      statusRef.status = 'skipped';
      statusRef.reason = 'summarizer_unavailable';
      statusRef.summarizer = 'down';
    }
    return null;
  }

  const evidenceTexts = evidenceSentences
    .filter((item) => item && typeof item.text === 'string' && item.text.trim())
    .map((item) => item.text.trim());

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SUMMARIZE_SERVICE_TIMEOUT_MS);

  try {
    const response = await fetch(`${EMBEDDING_SERVICE_URL}/summarize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        texts: evidenceTexts,
        query: queryText,
        intent,
        max_new_tokens: RAG_MAX_NEW_TOKENS,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 404) {
        summarizeCapabilityKnown = true;
        summarizeCapabilityAvailable = false;
      }
      throw new Error(`Summarization failed with status ${response.status}`);
    }

    const data = await response.json();
    const summary = cleanNarrativeSummary(data?.summary);

    summarizeCapabilityKnown = true;
    summarizeCapabilityAvailable = true;

    if (statusRef) {
      statusRef.summarizer = 'up';
      statusRef.status = summary ? 'generated' : 'skipped';
      statusRef.reason = summary ? 'ok' : 'empty_summary';
    }

    return summary || null;
  } catch (error) {
    if (statusRef) {
      statusRef.status = 'failed';
      statusRef.reason = error?.name === 'AbortError'
        ? 'summarizer_timeout'
        : `summarizer_error:${error?.message || 'unknown'}`;
      statusRef.summarizer = 'down';
    }
    console.warn('[summarizer] narrative summarization failed, falling back to extractive overview', {
      message: error?.message,
      serviceUrl: EMBEDDING_SERVICE_URL,
    });
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function alignNarrativeSummaryToEvidence(narrativeSummary, evidenceSentences, statusRef) {
  const generatedSentences = splitGeneratedSummary(narrativeSummary);
  if (!generatedSentences.length) {
    if (statusRef) {
      statusRef.status = 'skipped';
      statusRef.reason = 'empty_generated_sentences';
      statusRef.alignment = 'skipped';
    }
    return null;
  }

  const alignmentResults = await verifyEvidenceAlignment(generatedSentences, evidenceSentences);
  if (!alignmentResults) {
    if (statusRef) {
      statusRef.status = 'skipped';
      statusRef.reason = 'alignment_embeddings_unavailable';
      statusRef.alignment = 'skipped';
    }
    return null;
  }

  const alignedSentences = alignmentResults.filter((item) => (
    item
    && item.evidence
    && item.confidence >= ALIGNMENT_SCORE_THRESHOLD
  ));

  if (statusRef) {
    statusRef.status = alignedSentences.length ? 'aligned' : 'skipped';
    statusRef.reason = alignedSentences.length ? 'ok' : 'alignment_filtered';
    statusRef.alignment = alignedSentences.length ? 'passed' : 'filtered';
  }

  return alignedSentences.length ? alignedSentences : null;
}

function selectBestSentences(scoredCandidates, minSentences, maxSentences, intent = 'general') {
  if (!scoredCandidates.length) return [];

  const targetCount = clamp(intent === 'definition' ? 2 : 3, minSentences, maxSentences);
  const prioritized = prioritizeCandidatesForIntent(scoredCandidates, intent);

  const selected = [];
  const sourceCounter = new Map();
  const sourcePool = new Set();

  for (const candidate of prioritized) {
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

  if (selected.length < targetCount) {
    for (const candidate of prioritized) {
      if (selected.length >= targetCount) break;
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

  if (selected.length < minSentences) {
    return selected.slice(0, minSentences);
  }

  return selected.slice(0, targetCount);
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

function buildAlignedGenerativeOverview(alignedResults, evidenceSentences) {
  if (!Array.isArray(alignedResults) || alignedResults.length === 0) return null;

  const evidenceOverview = buildOverview(evidenceSentences);
  if (!evidenceOverview) return null;

  const sourceRefByKey = new Map(
    evidenceOverview.sources.map((source) => [sourceKey(source), source.ref]),
  );

  const alignedSentenceDetails = alignedResults
    .map((item) => {
      const source = item?.evidence?.source;
      const key = sourceKey(source);
      const sourceRef = sourceRefByKey.get(key) || null;

      return {
        text: item?.sentence,
        confidence: roundConfidence(item?.confidence || 0),
        sourceRef,
        citation: sourceRef ? `[${sourceRef}]` : '',
      };
    })
    .filter((item) => item.text);

  if (!alignedSentenceDetails.length) return null;

  const snippet = alignedSentenceDetails.map((item) => item.text).join(' ');
  const snippetWithCitations = alignedSentenceDetails
    .map((item) => (item.citation ? `${item.text} ${item.citation}` : item.text))
    .join(' ');

  return {
    ...evidenceOverview,
    snippet: snippetWithCitations,
    snippetWithCitations,
    alignedSentenceDetails,
  };
}

function sourceCredibilityScore(source) {
  const title = typeof source === 'string' ? source : source?.title;
  const t = String(title || '').toLowerCase();

  if (t.includes('journal')) return 1.0;
  if (t.includes('research')) return 1.0;
  if (t.includes('conference')) return 0.95;

  if (t.includes('textbook')) return 0.9;
  if (t.includes('lecture')) return 0.85;

  if (t.includes('government')) return 0.95;
  if (t.includes('standard')) return 0.95;

  if (t.includes('archive')) return 0.8;

  return 0.7;
}

function detectIntent(query) {
  const q = String(query || '').toLowerCase().trim();

  if (q.startsWith('what is') || q.startsWith('define')) {
    return 'definition';
  }

  if (q.startsWith('why') || q.includes('cause ') || q.includes('causes ')) {
    return 'causal';
  }

  if (q.includes('timeline') || q.includes('history of')) {
    return 'timeline';
  }

  if (q.includes('difference between') || q.includes('compare')) {
    return 'comparison';
  }

  if (q.startsWith('who is') || q.startsWith('who was')) {
    return 'biography';
  }

  return 'general';
}

function prioritizeCandidatesForIntent(scoredCandidates, intent) {
  if (!Array.isArray(scoredCandidates) || scoredCandidates.length === 0) return [];

  if (intent !== 'timeline' && intent !== 'comparison' && intent !== 'biography') {
    return scoredCandidates;
  }

  const matches = [];
  const others = [];

  for (const candidate of scoredCandidates) {
    const text = String(candidate?.text || '').toLowerCase();

    let isMatch = false;
    if (intent === 'timeline') {
      isMatch = /\b\d{4}\b/.test(candidate?.text || '');
    } else if (intent === 'comparison') {
      isMatch = text.includes('whereas') || text.includes('while') || text.includes('however');
    } else if (intent === 'biography') {
      isMatch = text.includes('born') || text.includes('was') || text.includes('leader');
    }

    if (isMatch) {
      matches.push(candidate);
    } else {
      others.push(candidate);
    }
  }

  return matches.concat(others);
}

export async function generateOverview(query, rows, options = {}) {
  const queryText = String(query || '').trim();
  const safeRows = Array.isArray(rows) ? rows : [];
  const requestedMin = parsePositiveInt(options.minSentences, 2);
  const requestedMax = parsePositiveInt(options.maxSentences, 4);
  const minSentences = Math.min(requestedMin, requestedMax);
  const maxSentences = Math.max(requestedMin, requestedMax);
  const intent = detectIntent(queryText);
  const requestId = options.requestId;
  const narrativeMeta = {
    status: 'skipped',
    reason: 'not_attempted',
    summarizer: 'unknown',
    alignment: 'skipped',
  };

  if (!queryText || !safeRows.length) {
    return null;
  }

  const candidates = buildCandidates(safeRows);
  if (!candidates.length) return null;

  const texts = [queryText, ...candidates.map((candidate) => candidate.text)];
  const embeddings = await getEmbeddings(texts);
  if (embeddings) {
    const scoredCandidates = scoreCandidatesWithEmbeddings(queryText, candidates, embeddings);

    const evidenceSentences = pickEvidenceSentences(scoredCandidates, intent, RAG_EVIDENCE_SENTENCE_LIMIT, queryText);
    const narrativeSummary = await generateNarrativeSummary({
      queryText,
      intent,
      evidenceSentences,
      statusRef: narrativeMeta,
    });
    if (narrativeSummary) {
      const alignedResults = await alignNarrativeSummaryToEvidence(
        narrativeSummary,
        evidenceSentences,
        narrativeMeta,
      );
      const alignedOverview = alignedResults
        ? buildAlignedGenerativeOverview(alignedResults, evidenceSentences)
        : null;

      if (alignedOverview) {
        logNarrativeStatus(narrativeMeta, requestId);
        return attachOverviewMeta(alignedOverview, narrativeMeta);
      }
    }

    const selected = selectClusterRepresentativeSentences(scoredCandidates, minSentences, maxSentences, intent);
    logNarrativeStatus(narrativeMeta, requestId);
    return attachOverviewMeta(buildOverview(selected), narrativeMeta);
  }

  const scoredCandidates = scoreCandidatesFallback(queryText, candidates);

  const evidenceSentences = pickEvidenceSentences(scoredCandidates, intent, RAG_EVIDENCE_SENTENCE_LIMIT, queryText);
  const narrativeSummary = await generateNarrativeSummary({
    queryText,
    intent,
    evidenceSentences,
    statusRef: narrativeMeta,
  });
  if (narrativeSummary) {
    const alignedResults = await alignNarrativeSummaryToEvidence(
      narrativeSummary,
      evidenceSentences,
      narrativeMeta,
    );
    const alignedOverview = alignedResults
      ? buildAlignedGenerativeOverview(alignedResults, evidenceSentences)
      : null;

    if (alignedOverview) {
      logNarrativeStatus(narrativeMeta, requestId);
      return attachOverviewMeta(alignedOverview, narrativeMeta);
    }
  }

  const selected = selectBestSentences(scoredCandidates, minSentences, maxSentences, intent);
  logNarrativeStatus(narrativeMeta, requestId);
  return attachOverviewMeta(buildOverview(selected), narrativeMeta);
}
