export const DEMO_DOCUMENT = `# Atlas Research Notes

## Executive overview
Atlas is a fictional research platform built to help teams turn dense internal knowledge into fast, traceable answers. The platform combines document ingestion, semantic retrieval, source-grounded responses, and clear citations.

## Architecture
The ingestion pipeline extracts text from uploaded PDFs or Markdown documents, divides it into overlapping chunks, creates embeddings for each chunk, and stores the chunks alongside their source metadata.

At query time, the application embeds the question and compares it against the document chunks using cosine similarity. The most relevant passages are sent to the answer generator, which must ground its response in those passages.

## Why overlap matters
Chunk overlap preserves context that would otherwise be lost when a paragraph or sentence crosses a chunk boundary. A 10–15% overlap is a useful starting point for long-form technical documents.

## Evaluation
The retrieval layer should be evaluated with a labeled set of questions and source passages. Useful metrics include recall@k, precision@k, and whether a generated answer is grounded in the retrieved evidence.

## Security
Every document and query result is scoped to the owning workspace. Further hardening would add signed upload URLs, row-level database policies, and prompt-injection safeguards.`;
