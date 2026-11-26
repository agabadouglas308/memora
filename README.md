# Memora: AI Second Brain

Memora is a document Q&A workspace: upload knowledge, ask questions, and inspect the source passages behind each answer.

**Live static demo:** https://agabadouglas308.github.io/second-brain/

## What is here

- **Next.js app**: document ingestion, overlapping text chunks, persisted documents and chunks in SQLite, ranked retrieval, streamed answers, and citations.
- **Chat history**: conversations are saved in SQLite and restored on reload. "New chat" clears them.
- **GitHub Pages demo**: an interactive browser-only preview in [`docs/`](./docs/). It uses the same chunking, embedding, and cosine pipeline as the server, but keeps data in memory so it is cleared on refresh.
- **Tests**: 32 Vitest cases covering chunking, embeddings, retrieval, both API routes, and both provider modes.

GitHub Pages only hosts static files; it cannot run the Next.js API routes or SQLite database. Use the Pages site as a product demo, and run the full app locally or deploy it to a Node.js host for server-backed ingestion and persistence.

## Run the full app locally

Requirements: Node.js 20+ and `pdftotext` (Poppler) available on `PATH` for PDF ingestion.

```bash
npm install
npx prisma db push
npm test
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The document API seeds a sample Atlas research note into an empty database.

## Optional: use a real model

By default Memora runs without any external service: hashed token vectors for retrieval and extractive answers built from the retrieved passages. To use a local Ollama instance for embeddings and token-by-token generation:

1. Install Ollama, then pull a chat model and an embedding model, for example `ollama pull llama3.2` and `ollama pull nomic-embed-text`.
2. Copy `.env.example` to `.env.local` and set `OLLAMA_MODEL`. `OLLAMA_HOST` and `OLLAMA_EMBED_MODEL` can be overridden too.
3. Restart the app and re-upload your documents.

Chunks record which embedding model created them, and retrieval only considers chunks from the active model. Switching modes against an existing database therefore leaves old chunks out of results until they are re-ingested.

## Retrieval notes

- Text is split into 900-character chunks with 180-character overlap.
- In the default mode, embeddings are normalized 384-dimensional hashed token vectors. This is a lightweight baseline rather than a hosted LLM or a production embedding model.
- An in-process token index caches parsed vectors and limits cosine scoring to chunks that share a token with the question. A multi-node or very large deployment would replace this with pgvector and server-side ANN search.
- With Ollama configured, embeddings come from `/api/embed` and answers stream from `/api/chat`. The UI receives citations after the generated answer, and both messages are persisted.

## API

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/documents` | GET, POST | List documents and seed the demo note; upload a file |
| `/api/documents/:id` | DELETE | Remove a document |
| `/api/chat` | GET, POST, DELETE | Read history, ask a question, clear history |

## Deploy the static demo

The GitHub Actions workflow publishes `docs/` to GitHub Pages whenever changes are pushed to `main`. Enable **Settings → Pages → Build and deployment → GitHub Actions** once for the repository.

## License

MIT. See [LICENSE](./LICENSE).
