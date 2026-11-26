import { answerFromContext, chunkText, embedText } from "../src/lib/rag";
import { rankChunks } from "../src/lib/retrieval";
import { EVAL_CASES, EVAL_CORPUS } from "./eval-dataset";

const chunkSize = Number(process.env.EVAL_CHUNK_SIZE ?? 400);
const overlap = Number(process.env.EVAL_OVERLAP ?? 80);
const limit = 3;
const minimumRecall = Number(process.env.EVAL_MIN_RECALL ?? 0.7);

const chunks = chunkText(EVAL_CORPUS, chunkSize, overlap).map((text, position) => ({
  id: `chunk-${position}`,
  text,
  position,
  embedding: JSON.stringify(embedText(text)),
  documentId: "corpus",
  documentName: "eval-corpus.md",
}));

let recall = 0;
let precision = 0;
let reciprocalRank = 0;
let grounded = 0;

const rows: string[] = [];

for (const testCase of EVAL_CASES) {
  const phrase = testCase.answer.toLowerCase();
  const relevant = new Set(
    chunks.filter((chunk) => chunk.text.toLowerCase().includes(phrase)).map((chunk) => chunk.position)
  );
  const ranked = rankChunks(testCase.question, chunks, embedText(testCase.question), { limit });
  const hits = ranked
    .map((result, index) => (relevant.has(result.position) ? index + 1 : 0))
    .filter((rank) => rank > 0);

  const caseRecall = relevant.size ? hits.length / relevant.size : 0;
  const casePrecision = hits.length / limit;
  const caseRank = hits.length ? 1 / hits[0] : 0;
  recall += caseRecall;
  precision += casePrecision;
  reciprocalRank += caseRank;

  const answer = answerFromContext(
    testCase.question,
    ranked.map((result) => ({ text: result.text, documentName: result.documentName }))
  );
  const answerBody = answer
    .split("\n\n")[0]
    .replace(/^Based on your knowledge base,\s*/, "")
    .trim()
    .toLowerCase();
  const caseGrounded = ranked.some((result) =>
    result.text.toLowerCase().replace(/\s+/g, " ").includes(answerBody.slice(0, 60))
  ) ? 1 : 0;
  grounded += caseGrounded;

  rows.push(
    `| ${testCase.question} | ${caseRecall.toFixed(2)} | ${casePrecision.toFixed(2)} | ${caseRank.toFixed(2)} | ${caseGrounded ? "yes" : "no"} |`
  );
}

const total = EVAL_CASES.length;
console.log(`Corpus: ${chunks.length} chunks (size ${chunkSize}, overlap ${overlap})\n`);
console.log("| Question | Recall@3 | Precision@3 | RR | Grounded |");
console.log("| --- | --- | --- | --- | --- |");
console.log(rows.join("\n"));
console.log(
  `\nMean recall@3 ${(recall / total).toFixed(2)} | mean precision@3 ${(precision / total).toFixed(2)} | MRR ${(reciprocalRank / total).toFixed(2)} | grounded ${(grounded / total).toFixed(2)}`
);

if (recall / total < minimumRecall) {
  console.error(`\nRecall@3 below the ${minimumRecall.toFixed(2)} threshold.`);
  process.exit(1);
}
