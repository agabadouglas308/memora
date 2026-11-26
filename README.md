# Memora: AI Second Brain

Memora is a document Q&A workspace: upload knowledge, ask questions, and inspect the source passages behind each answer.

**Live static demo:** https://agabadouglas308.github.io/second-brain/

## What is here

- **Next.js app**: document ingestion, overlapping text chunks, persisted documents and chunks in SQLite, ranked retrieval, streaming answers, and citations.
- **GitHub Pages demo**: an interactive browser-only preview in [`docs/`](./docs/). It runs without a server and supports text and Markdown uploads. Browser demo data stays in memory and is cleared on refresh.

GitHub Pages only hosts static files; it cannot run the Next.js API routes or SQLite database. Use the Pages site as a product demo, and run the full app locally or deploy it to a Node.js host for server-backed ingestion and persistence.

## Run the full app locally

Requirements: Node.js 20+ and `pdftotext` (Poppler) available on `PATH` for PDF ingestion.

```bash
npm install
npx prisma db push
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The document API seeds a sample Atlas research note into an empty database.

## Retrieval notes

The current implementation uses normalized, hashed token vectors with cosine similarity, followed by extractive answer selection from retrieved text. This keeps local development independent of paid model APIs; it is a lightweight baseline rather than a hosted LLM or production-grade embedding model. Replace the embedding and answer-generation functions in [`src/lib/rag.ts`](./src/lib/rag.ts) to connect a model provider.

## Deploy the static demo

The GitHub Actions workflow publishes `docs/` to GitHub Pages whenever changes are pushed to `main`. Enable **Settings → Pages → Build and deployment → GitHub Actions** once for the repository.
