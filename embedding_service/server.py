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

    # 🌟 Layer 2: Audience Persona Mapping
    # 'style' will now receive the domain ID ('se', 'he', 'rs') from your Node backend
    domain_persona = {
        "se": "Explain like a friendly school teacher. Use simple analogies, avoid complex jargon, and keep sentences engaging for students.",
        "he": "Explain like a university professor. Use formal academic language and provide a balanced, thorough overview of the subject.",
        "rs": "Explain like a peer reviewer for a scientific journal. Be highly technical, focus on data and methodology, and use precise terminology.",
        "default": "Provide a clear, factual, and balanced academic summary."
    }
    
    # Determine the persona based on the domain (passed in 'style')
    persona = domain_persona.get(style.lower() if style else "default", domain_persona["default"])

    # If the user wants the "Google-style" conversational summary (Natural Language)
    if style and style.lower() in ("se", "google", "natural", "conversational"):
        header = (
            f"{persona}\n\n"
            "Write a comprehensive, natural-language summary that directly answers the query. "
            "Focus on the actual content and concepts - NOT on metadata like 'this is a video' or 'this is a chapter'. "
            "Extract and synthesize the substantive information. Write 4-6 descriptive sentences. "
            "Do NOT use structured headings. Do NOT mention document metadata. "
            "When referencing facts, include parenthetical citations like [1] to match the source order."
        )
        if safe_query:
            header += f"\n\nQuery: {safe_query}"
        header += "\n\nInformation from sources:\n"
        return header + context

    # Otherwise, use the "Structured Academic" format
    intent_guidance = ""
    if safe_intent == "definition":
        intent_guidance = "Start with a one-sentence definition, then explain key aspects and significance. "
    elif safe_intent == "causal":
        intent_guidance = "Explain causes by grouping into 2–3 categories if supported by the sources. "
    elif safe_intent == "timeline":
        intent_guidance = "Present events in chronological order and include dates only if present in the sources. "
    elif safe_intent == "comparison":
        intent_guidance = "Compare the items clearly by stating 2–4 concrete differences supported by the sources. "
    elif safe_intent == "biography":
        intent_guidance = "Explain who the person is, key roles/contributions, and relevant time period. "

    header = (
        f"{persona}\n\n"
        "Explain the topic in structured academic format using exactly this structure (include the headings):\n\n"
        "Overview:\n"
        "Definition:\n"
        "Process:\n"
        "Key Stages:\n"
        "Importance:\n\n"
        "Write descriptive educational paragraphs under each section based ONLY on the provided sources.\n"
        + intent_guidance
        + "Do not add facts not present in the sources. Include parenthetical citations like [1].\n"
        + "If an aspect is not supported, write 'Not covered in sources.'"
    )

    if safe_query:
        header += f"\n\nQuery: {safe_query}"

    header += f"\nIntent: {safe_intent}"
    header += "\n\nSources (evidence):\n"

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
    if not req.texts or not str(req.query).strip():
        return {
            "summary": "Please provide a valid query and sources.", 
            "snippet": "", 
            "highlights": []
        }

    # 🌟 THE GATEKEEPER: We use the Reranker to grade the PHP script's documents
    pairs = [[req.query, text] for text in req.texts]
    scores = reranker.predict(pairs)
    
    valid_texts = []
    for text, score in zip(req.texts, scores):
        # BGE Reranker outputs raw logits. 
        # Usually > 0 means highly relevant, < 0 means increasingly irrelevant.
        # -2.0 is a great threshold to aggressively block complete garbage (like airplanes for a banking query).
        if score > -2.0: 
            valid_texts.append(text)
            
    # If the PHP script sent us ONLY garbage, we abort before Gemma even starts!
    if not valid_texts:
        return {
            "summary": "We could not find highly relevant academic documents for this query. Please try rephrasing your search.",
            "snippet": "",
            "highlights": []
        }

    # If we have valid documents, we proceed as normal (but only using the good ones!)
    combined_context = "\n".join([str(t) for t in valid_texts if str(t).strip()])
    
    # We also only highlight from the valid texts
    highlights = extractive_highlights(valid_texts, req.query, top_k=2)

    # Now Gemma 4 only reads the filtered, highly-relevant context
    summary = generate_summary(
        combined_context,
        query=req.query,
        intent=req.intent,
        style=req.style,
        max_new_tokens=req.max_new_tokens or 800,
    )

    # Build a short search-style snippet (for the fallback preview)
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