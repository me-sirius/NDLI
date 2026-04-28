from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
import torch
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
import uvicorn

app = FastAPI()

model = SentenceTransformer("all-MiniLM-L6-v2")

SUMMARY_MODEL_NAME = "google/flan-t5-base"
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

    header = (
        "You are an academic assistant. Write a concise, factual overview grounded ONLY in the provided sources. "
        "Avoid adding facts not present in the sources."
    )

    if safe_query:
        header += f"\n\nQuery: {safe_query}"

    header += f"\nIntent: {safe_intent}"
    header += "\n\nSources (evidence):\n"

    return header + context


def generate_summary(context: str, query: str | None = None, intent: str | None = None, max_new_tokens: int = 200) -> str:
    prompt = build_prompt(context=context, query=query, intent=intent)

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
            length_penalty=1.0,
            early_stopping=True,
        )

    return summary_tokenizer.decode(outputs[0], skip_special_tokens=True).strip()


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
        max_new_tokens=req.max_new_tokens or 200,
    )
    return {"summary": summary}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)