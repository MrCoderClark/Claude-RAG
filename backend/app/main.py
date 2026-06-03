from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import chat

app = FastAPI(title="RAG Chat API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router)


@app.get("/health")
async def health():
    return {"status": "healthy"}
