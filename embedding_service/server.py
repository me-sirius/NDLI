from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer, CrossEncoder
from huggingface_hub import InferenceClient
import os
import uvicorn
import re
import numpy as np

app = FastAPI()

# 1. Load Embedding Model
print("Loading Embedding model...")
model = SentenceTransformer("all-MiniLM-L6-v2")

# 2. Setup the Gemma 4 API Client (The "Industrial Kitchen")
print("Setting up Gemma 4 API Client...")
HF_TOKEN = os.getenv("HF_TOKEN")
# If the token is missing, the code will still run, but generation will fail safely
llm_client = InferenceClient(
    "google/gemma-4-26B-A4B-it", 
    token=HF_TOKEN,
)

# 3. Load Reranker Model (The "Senior Professor")
print("Loading Reranker model (BAAI/bge-reranker-large)...")
reranker = CrossEncoder('BAAI/bge-reranker-large', max_length=512)
print("All models loaded successfully!")


class EmbeddingRequest(BaseModel):
    texts: list[str]

class SummarizeRequest(BaseModel):
    texts: list[str]
    query: str | None = None
    intent: str | None = None
    style: str | None = None
    sources: list[dict] | None = None
    max_new_tokens: int | None = None

class RerankRequest(BaseModel):
    query: str
    texts: list[str]
    top_k: int = 5


def build_prompt(context: str, query: str | None, intent: str | None, style: str | None = None) -> str:
    safe_query = (query or "").strip()
    safe_intent = (intent or "general").strip()

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
        intent_guidance = "Start with a one-sentence definition, then explain key aspects and significance. "
    elif safe_intent == "causal":
        intent_guidance = "Explain causes by grouping into 2–3 categories if supported by the sources. "
    elif safe_intent == "timeline":
        intent_guidance = "Present events in chronological order and include dates only if present in the sources. "
    elif safe_intent == "comparison":
        intent_guidance = "Compare the items clearly by stating 2–4 concrete differences or contrasts supported by the sources. "
    elif safe_intent == "biography":
        intent_guidance = "Explain who the person is, key roles/contributions, and relevant time period supported by the sources. "

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

    if style and style.lower() in ("snippet"):
        header += (
            "\nProduce a short search-style snippet (1-3 sentences) suitable for a search results preview.\n"
            "Then provide a longer descriptive summary following the structured headings above.\n"
        )

    return header + context


def _is_too_short(summary: str) -> bool:
    words = [w for w in str(summary or "").split() if w]
    if len(words) < 80:
        return True

    sentence_marks = sum(str(summary).count(ch) for ch in [".", "!", "?"])
    return sentence_marks < 3


def _generate_once(prompt: str, max_new_tokens: int) -> str:
    # Gemma loves conversational formats, so we set it up like a chat!
    messages = [
        {"role": "system", "content": "You are a highly intelligent academic tutor for the National Digital Library of India. Answer queries using strictly the provided source text."},
        {"role": "user", "content": prompt}
    ]
    
    try:
        # We make the API call to Hugging Face Serverless
        response = llm_client.chat_completion(
            messages=messages,
            max_tokens=max_new_tokens,
            temperature=0.3, # Keeps the AI factual and prevents hallucination
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"[LLM Error]: {e}")
        return "Not enough information could be processed to generate a summary at this time."


def _split_sentences(text: str) -> list[str]:
    if not text:
        return []
    parts = re.split(r'(?<=[.!?])\s+', text.strip())
    return [p.strip() for p in parts if p.strip()]


def extractive_highlights(texts: list[str], query: str | None = None, top_k: int = 2) -> list[list[dict]]:
    if not texts:
        return []

    all_sentences = []
    src_map = []
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
        q_emb = np.mean(sent_emb, axis=0)

    norms = np.linalg.norm(sent_emb, axis=1) * (np.linalg.norm(q_emb) + 1e-12)
    sims = (sent_emb @ q_emb) / norms

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
    summary = _generate_once(prompt, max_new_tokens=max_new_tokens)

    if _is_too_short(summary):
        longer_prompt = prompt + "\n\nEnsure a longer Overview is produced covering all sections. Expand on each heading with supporting details from the sources."
        summary_retry = _generate_once(longer_prompt, max_new_tokens=max(max_new_tokens, 800))
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

    # We enforce generation here to use our shiny new LLM!
    summary = generate_summary(
        combined_context,
        query=req.query,
        intent=req.intent,
        style=req.style,
        max_new_tokens=req.max_new_tokens or 800,
    )

    top_sentence = None
    top_score = -1.0
    for src_h in highlights:
        for h in src_h:
            if h.get("score", 0) > top_score:
                top_score = h.get("score", 0)
                top_sentence = h.get("text")

    snippet = (top_sentence or "")[:400]

    return {"summary": summary, "snippet": snippet, "highlights": highlights}


@app.post("/rerank")
def rerank(req: RerankRequest):
    if not req.texts or not str(req.query).strip():
        return {"results": []}

    # Format the data into pairs of [query, text] for the cross-encoder
    pairs = [[req.query, text] for text in req.texts]
    
    # Predict returns a raw score for each pair
    scores = reranker.predict(pairs)

    # Combine the texts with their new scores
    results = [
        {"text": text, "score": float(score)}
        for text, score in zip(req.texts, scores)
    ]
    
    # Sort them so the highest score is at the top
    results.sort(key=lambda x: x["score"], reverse=True)

    return {"results": results[:req.top_k]}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)