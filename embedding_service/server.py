from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
import os
import torch
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
import uvicorn
import re
import numpy as np

app = FastAPI()

model = SentenceTransformer("all-MiniLM-L6-v2")

SUMMARY_MODEL_NAME = os.getenv("SUMMARY_MODEL_NAME", "google/flan-t5-base")
summary_tokenizer = AutoTokenizer.from_pretrained(SUMMARY_MODEL_NAME)
summary_model = AutoModelForSeq2SeqLM.from_pretrained(SUMMARY_MODEL_NAME)
summary_model.eval()
summary_device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
summary_model.to(summary_device)


class EmbeddingRequest(BaseModel):
    texts: list[str]


class SummarizeRequest(BaseModel):
    texts: list[str]
    query: str | None = None
    intent: str | None = None
    style: str | None = None
    sources: list[dict] | None = None
    max_new_tokens: int | None = None


def build_prompt(context: str, query: str | None, intent: str | None, style: str | None = None) -> str:
    safe_query = (query or "").strip()
    safe_intent = (intent or "general").strip()

    # Check if Google-style natural summary is requested
    if style and style.lower() in ("google", "natural", "conversational"):
        header = (
            "Write a comprehensive, natural-language summary that directly answers the query. "
            "Focus on the actual content, concepts, and information from the sources - NOT on metadata like 'this is a video lecture' or 'this is a chapter'. "
            "Extract and synthesize the substantive information about the topic itself. "
            "Write 4-6 descriptive sentences that explain what the topic is, how it works, its key components, and why it matters. "
            "Use a conversational but informative tone similar to Google Search's AI summaries. "
            "Do NOT use structured headings. Do NOT mention sources, citations, or document metadata. "
            "If the sources don't contain substantive information about the topic, say so clearly."
        )
        if safe_query:
            header += f"\n\nQuery: {safe_query}"
        header += "\n\nInformation from sources:\n"
        return header + context

    intent_guidance = ""
    if safe_intent == "definition":
        intent_guidance = (
            "Start with a one-sentence definition, then explain key aspects and significance. "
        )
    elif safe_intent == "causal":
        intent_guidance = (
            "Explain causes by grouping into 2–3 categories (for example: economic, political, social/ideological) if supported by the sources. "
            "Mention both underlying factors and immediate triggers when possible. "
        )
    elif safe_intent == "timeline":
        intent_guidance = (
            "Present events in chronological order and include dates only if present in the sources. "
        )
    elif safe_intent == "comparison":
        intent_guidance = (
            "Compare the items clearly by stating 2–4 concrete differences or contrasts supported by the sources. "
        )
    elif safe_intent == "biography":
        intent_guidance = (
            "Explain who the person is, key roles/contributions, and relevant time period supported by the sources. "
        )

    header = (
        "Explain the topic in structured academic format.\n\n"
        "Start with an 'Overview:' paragraph (2-4 sentences) summarizing the main idea.\n\n"
        "Return output using exactly this structure (include the headings):\n\n"
        "Overview:\n"
        "Definition:\n"
        "Process:\n"
        "Key Stages:\n"
        "Importance:\n\n"
        "Write descriptive educational paragraphs under each section based ONLY on the provided sources.\n"
        + intent_guidance
        + "Do not add facts not present in the sources. When referencing facts, include short parenthetical citations like [1] that match the source order provided.\n"
        + "Do not echo the 'Query' or 'Intent' labels.\n"
        + "If an aspect is not supported by the sources, write 'Not covered in sources.'"
    )

    if safe_query:
        header += f"\n\nQuery: {safe_query}"

    header += f"\nIntent: {safe_intent}"
    header += "\n\nSources (evidence):\n"

    # If a 'google' or 'snippet' style is requested, add instructions for a short search-style result
    if style and style.lower() in ("snippet"):
        header += (
            "\nProduce a short search-style snippet (1-3 sentences) suitable for a search results preview.\n"
            "Then provide a longer descriptive summary following the structured headings above.\n"
        )

    # Append the raw sources; caller should pass sources in order matching citations
    return header + context


def _is_too_short(summary: str) -> bool:
    words = [w for w in str(summary or "").split() if w]
    if len(words) < 80:
        return True

    sentence_marks = sum(str(summary).count(ch) for ch in [".", "!", "?"])
    return sentence_marks < 3


def _generate_once(prompt: str, max_new_tokens: int, length_penalty: float) -> str:
    inputs = summary_tokenizer(
        prompt,
        return_tensors="pt",
        truncation=True,
        max_length=1024,
    )
    inputs = {k: v.to(summary_device) for k, v in inputs.items()}

    with torch.no_grad():
        outputs = summary_model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            num_beams=4,
            length_penalty=length_penalty,
            no_repeat_ngram_size=3,
            early_stopping=True,
        )

    return summary_tokenizer.decode(outputs[0], skip_special_tokens=True).strip()


def _split_sentences(text: str) -> list[str]:
    # Simple sentence splitter; keeps punctuation
    if not text:
        return []
    parts = re.split(r'(?<=[.!?])\s+', text.strip())
    return [p.strip() for p in parts if p.strip()]


def extractive_highlights(texts: list[str], query: str | None = None, top_k: int = 2) -> list[list[dict]]:
    # For each source text, return top_k sentences most similar to query (or overall when query missing)
    if not texts:
        return []

    # Prepare embeddings
    # Flatten sentences per source and keep mapping
    all_sentences = []
    src_map = []  # (source_index, sentence_index)
    for si, t in enumerate(texts):
        sents = _split_sentences(t)
        for sj, s in enumerate(sents):
            all_sentences.append(s)
            src_map.append((si, sj))

    if not all_sentences:
        return [[] for _ in texts]

    sent_emb = model.encode(all_sentences, convert_to_numpy=True)

    if query and str(query).strip():
        q_emb = model.encode([query], convert_to_numpy=True)[0]
    else:
        # use mean embedding of all sentences as proxy
        q_emb = np.mean(sent_emb, axis=0)

    # cosine similarities
    norms = np.linalg.norm(sent_emb, axis=1) * (np.linalg.norm(q_emb) + 1e-12)
    sims = (sent_emb @ q_emb) / norms

    # collect per-source
    per_source = {i: [] for i in range(len(texts))}
    for idx, ((si, sj), score) in enumerate(zip(src_map, sims)):
        per_source[si].append((score, all_sentences[idx]))

    results = []
    for i in range(len(texts)):
        items = per_source.get(i, [])
        items.sort(key=lambda x: x[0], reverse=True)
        sel = []
        for score, sent in items[:top_k]:
            sel.append({"text": sent, "score": float(score)})
        results.append(sel)

    return results


def build_extractive_summary(query: str | None, highlights: list[list[dict]], max_sentences: int = 3) -> str:
    # Prefer the strongest non-duplicate sentences from the source highlights.
    candidates: list[tuple[float, str]] = []
    seen: set[str] = set()

    for source_items in highlights:
        for item in source_items:
            sentence = str(item.get("text", "")).strip()
            if not sentence:
                continue
            normalized = sentence.lower()
            if normalized in seen:
                continue
            seen.add(normalized)
            candidates.append((float(item.get("score", 0.0)), sentence))

    candidates.sort(key=lambda item: item[0], reverse=True)
    chosen = [sentence for _, sentence in candidates[:max_sentences]]

    if not chosen:
        return "Not enough information in the sources to generate a summary."

    return " ".join(chosen)


def generate_summary(context: str, query: str | None = None, intent: str | None = None, style: str | None = None, max_new_tokens: int = 800) -> str:
    prompt = build_prompt(context=context, query=query, intent=intent, style=style)
    summary = _generate_once(prompt, max_new_tokens=max_new_tokens, length_penalty=1.15)

    if _is_too_short(summary):
        longer_prompt = prompt + "\n\nEnsure a longer Overview is produced covering all sections. Expand on each heading with supporting details from the sources."
        summary_retry = _generate_once(
            longer_prompt,
            max_new_tokens=max(max_new_tokens, 800),
            length_penalty=1.25,
        )
        if len(summary_retry) > len(summary):
            summary = summary_retry

    return summary.strip()


@app.post("/embed")
def embed(req: EmbeddingRequest):
    embeddings = model.encode(req.texts).tolist()
    return {"embeddings": embeddings}


@app.post("/summarize")
def summarize(req: SummarizeRequest):
    combined_context = "\n".join([str(t) for t in (req.texts or []) if str(t).strip()])
    highlights = extractive_highlights(req.texts or [], req.query, top_k=2)

    use_extractive_summary = bool(req.style and req.style.lower() in ("google", "snippet", "natural", "conversational"))

    # Prefer an extractive summary for search-style results so we surface actual source content.
    if use_extractive_summary:
        summary = build_extractive_summary(req.query, highlights, max_sentences=4)
    else:
        summary = generate_summary(
            combined_context,
            query=req.query,
            intent=req.intent,
            style=req.style,
            max_new_tokens=req.max_new_tokens or 800,
        )

    # Build a short search-style snippet: pick highest-scoring highlighted sentence across sources
    top_sentence = None
    top_score = -1.0
    for src_h in highlights:
        for h in src_h:
            if h.get("score", 0) > top_score:
                top_score = h.get("score", 0)
                top_sentence = h.get("text")

    snippet = (top_sentence or "")[:400]

    return {"summary": summary, "snippet": snippet, "highlights": highlights}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)