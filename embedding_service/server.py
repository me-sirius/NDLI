from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
import uvicorn

app = FastAPI()

model = SentenceTransformer("all-MiniLM-L6-v2")


class EmbeddingRequest(BaseModel):
    texts: list[str]


@app.post("/embed")
def embed(req: EmbeddingRequest):
    embeddings = model.encode(req.texts).tolist()
    return {"embeddings": embeddings}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)