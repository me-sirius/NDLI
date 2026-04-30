from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
import os
import torch
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
import uvicorn

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
    max_new_tokens: int | None = None


def build_prompt(context: str, query: str | None, intent: str | None) -> str:
    safe_query = (query or "").strip()
    safe_intent = (intent or "general").strip()

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
        "Return output using exactly this structure (include the headings):\n\n"
        "Definition:\n"
        "Process:\n"
        "Key Stages:\n"
        "Importance:\n\n"
        "Write concise educational paragraphs under each section based ONLY on the provided sources.\n"
        + intent_guidance
        + "Do not add facts not present in the sources. Do not use bullet points. Do not include citations like [1]. "
        + "Do not echo the 'Query' or 'Intent' labels.\n"
        + "If an aspect is not supported by the sources, write 'Not covered in sources.'"
    )

    if safe_query:
        header += f"\n\nQuery: {safe_query}"

    header += f"\nIntent: {safe_intent}"
    header += "\n\nSources (evidence):\n"

    return header + context


def _is_too_short(summary: str) -> bool:
    words = [w for w in str(summary or "").split() if w]
    if len(words) < 55:
        return True

    sentence_marks = sum(str(summary).count(ch) for ch in [".", "!", "?"])
    return sentence_marks < 2


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


def generate_summary(context: str, query: str | None = None, intent: str | None = None, max_new_tokens: int = 600) -> str:
    prompt = build_prompt(context=context, query=query, intent=intent)
    summary = _generate_once(prompt, max_new_tokens=max_new_tokens, length_penalty=1.15)

    if _is_too_short(summary):
        longer_prompt = prompt + "\n\nEnsure a longer Overview is produced covering all sections."
        summary_retry = _generate_once(
            longer_prompt,
            max_new_tokens=max(max_new_tokens, 600),
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
    summary = generate_summary(
        combined_context,
        query=req.query,
        intent=req.intent,
        max_new_tokens=req.max_new_tokens or 600,
    )
    return {"summary": summary}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)