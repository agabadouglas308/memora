# Memora: AI Second Brain

[![CI](https://github.com/agabadouglas308/memora/actions/workflows/ci.yml/badge.svg)](https://github.com/agabadouglas308/memora/actions/workflows/ci.yml)

Memora is a document Q&A workspace: upload knowledge, ask questions, and inspect the source passages behind each answer. Accounts keep each user's documents and conversations separate.

**Live static demo:** https://agabadouglas308.github.io/second-brain/

## What is here

- **Next.js app**: document ingestion, overlapping text chunks, persisted documents and chunks in SQLite, ranked retrieval, streamed answers, and citations.
- **Accounts**: email and password registration, salted scrypt hashes, signed HTTP-only session cookies, and per-user scoping on every document, chunk, and message query.
- **Chat history**: conversations are saved in SQLite and restored on reload. "New chat" clears them.
- **GitHub Pages demo**: an interactive browser-only preview in [`docs/`](./docs/). It uses the same chunking, embedding, and cosine pipeline as the server, but keeps data in memory so it is cleared on refresh.
- **Tests**: 86 Vitest cases covering chunking, embeddings, retrieval, authentication, rate limiting, all API routes, chat-only hosted providers with local embeddings, runtime fallback, and malformed input handling.
- **Evaluation harness**: a labeled question set with recall@k, precision@k, MRR, and groundedness, runnable with `npm run eval`.

GitHub Pages only hosts static files; it cannot run the Next.js API routes or SQLite database. Use the Pages site as a product demo, and run the full app locally or deploy it to a Node.js host for server-backed ingestion and persistence.

## Architecture

```
Browser ──session cookie──> Next.js API ──Prisma──> SQLite
   │                            │
   │                       auth: scrypt + HMAC
   │                            │
   └──streamed answer──── hybrid retrieval
                          ├── hashed or Ollama embeddings (cosine)
                          └── BM25 keyword scores
                                   │
                            top 5 chunks ──> extractive or Ollama generation
                                   │
                            citations + stored messages
```

Every query is scoped to the signed-in user. The static demo omits auth and persistence but runs the same chunking, embedding, and hybrid scoring code in the browser.

## Run the full app locally

Requirements: Node.js 20+ and `pdftotext` (Poppler) available on `PATH` for PDF ingestion.

```bash
npm install
npx prisma db push
npm test
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), register an account, and the document API seeds a sample Atlas research note into your empty library.

Set `SESSION_SECRET` (see `.env.example`) for real deployments. Without it, development uses a fixed fallback secret; production refuses to start.

## Run with Docker

`docker compose up --build` starts the app on port 3000 with `pdftotext` included and the SQLite schema created on first boot. The database lives in a named volume so it survives container restarts.

## Authentication

Passwords are hashed with scrypt and a random salt. Sessions are HMAC-signed cookies containing a user id and expiry, marked `httpOnly`, `SameSite=Lax`, and `Secure` in production. Every document, chunk, and message query is scoped to the signed-in user; the API returns 401 for anonymous requests and never exposes another user's data. The first account created inherits any documents from an older, unauthenticated database.

## Model providers

Memora picks a provider in this order:

1. **Hosted API** (primary): set `LLM_API_KEY` in `.env.local`. Any OpenAI-compatible `/chat/completions` API works. `LLM_BASE_URL` and `LLM_MODEL` choose the endpoint and chat model. The key is read only from the environment and sent in an `Authorization` header; it is never written to source or logs.
2. **Ollama** (fallback): if no hosted chat is available, set `OLLAMA_MODEL` to use a local Ollama instance. Install Ollama and pull a chat and embedding model, for example `ollama pull llama3.2` and `ollama pull nomic-embed-text`. `OLLAMA_HOST` and `OLLAMA_EMBED_MODEL` can be overridden.
3. **Built-in baseline** (final fallback): with neither configured, the app uses hashed token vectors and extractive answers and needs no external service.

### Using Groq

Groq serves chat completions but has no embeddings endpoint, so keep embeddings local:

```env
LLM_API_KEY=gsk_your_key_here
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=llama-3.3-70b-versatile
LLM_EMBED_MODEL=none
```

`LLM_EMBED_MODEL=none` tells the app to index documents with the built-in local embeddings while still sending chat requests to Groq. For a provider that does offer `/embeddings`, set `LLM_EMBED_MODEL` to its model name and optionally override `LLM_EMBED_BASE_URL` if it differs from `LLM_BASE_URL`.

Placeholder values such as `your-api-key-here` are treated as unset, so copying `.env.example` without editing it safely falls through to Ollama or the baseline. If a hosted request fails at runtime (bad key, rate limit, or network timeout), the app catches it, marks the hosted provider unavailable for five minutes, and falls through to the next provider without failing the request. Documents and queries are tagged with the provider that actually indexed them, so results stay consistent. If every provider fails, the API returns a 502 with a generic message instead of crashing. After switching providers, restart the app and re-upload your documents.

Chunks record which embedding model created them, and retrieval only considers chunks from the active model. Switching modes against an existing database leaves old chunks out of results until they are re-ingested; the app shows a warning in the chat panel when that happens.

The demo note is seeded only once, on a database that has never been seeded. Deleting every document leaves the library empty rather than recreating it. Documents and their chunks are written in one transaction, so an interrupted upload cannot leave a document with no chunks.

## Retrieval notes

- Text is split into 900-character chunks with 180-character overlap.
- In the default mode, embeddings are normalized 384-dimensional hashed token vectors. Tokens are lightly stemmed so "evaluate" and "evaluation" land in the same bucket. This is a lightweight baseline rather than a hosted LLM or a production embedding model.
- Retrieval is hybrid: a weighted fusion of cosine similarity and BM25 keyword scores (0.6 / 0.4 by default). In hash mode an in-process token index caches parsed vectors and limits scoring to chunks sharing a root token with the question; in Ollama mode all chunks are scored so semantic matches without shared words are not lost. A multi-node or very large deployment would replace this with pgvector and server-side ANN search.
- With Ollama configured, embeddings come from `/api/embed` and answers stream from `/api/chat`. The UI receives citations after the generated answer, and both messages are persisted.

## Evaluation

`npm run eval` runs 12 labeled questions against an 8-chunk corpus with distractor sections. It reports per-question and mean recall@3, precision@3, MRR, and whether the answer text is verbatim grounded in a retrieved chunk. The current baseline scores **0.96 recall@3, 1.00 MRR, 0.92 grounded** and fails the command if mean recall drops below 0.70 (`EVAL_MIN_RECALL`). Chunk size, overlap, and the threshold can be overridden with `EVAL_CHUNK_SIZE`, `EVAL_OVERLAP`, and `EVAL_MIN_RECALL`.

## API

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/auth/register`, `/api/auth/login` | POST | Create an account or sign in |
| `/api/auth/logout` | POST | Clear the session |
| `/api/auth/me` | GET | Read the signed-in user |
| `/api/documents` | GET, POST | List documents and seed the demo note; upload a file |
| `/api/documents/:id` | DELETE | Remove a document |
| `/api/chat` | GET, POST, DELETE | Read history, ask a question, clear history |

All routes except registration and login require a session.

## Deploy the static demo

The GitHub Actions workflow publishes `docs/` to GitHub Pages whenever changes are pushed to `main`. Enable **Settings → Pages → Build and deployment → GitHub Actions** once for the repository.

## License

MIT. See [LICENSE](./LICENSE).
