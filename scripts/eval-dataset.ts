export const EVAL_CORPUS = `# Platform overview
Atlas is a research platform that turns dense internal notes into fast, traceable answers. Teams upload knowledge and ask questions in plain language.

# Ingestion
The ingestion pipeline extracts text from uploaded PDFs, Markdown, and plain text files. It then divides the text into overlapping chunks before storing them.

# Chunking
Chunk overlap preserves context that would otherwise be lost when a sentence crosses a boundary. A ten to fifteen percent overlap is a useful starting point.

# Retrieval
At query time the application compares the question with stored chunks using cosine similarity. The highest scoring passages become the cited evidence for the answer.

# Evaluation
The retrieval layer is evaluated with a labeled set of questions and passages. Useful metrics include recall@k, precision@k, and mean reciprocal rank.

# Security
Every document and query result must be scoped to the owning workspace. Production deployments add authentication and signed upload URLs.

# Deployment
The server needs Node.js 20 or newer and pdftotext from Poppler for PDF uploads. The static demo runs on GitHub Pages without a backend.

# Local models
Ollama provides local embeddings and streamed generation, so development works without a paid model provider.

# Billing
Invoices are issued monthly and every plan includes a seven day trial. Payment details are managed by the billing administrator.

# Roadmap
The next release adds shared workspaces, folder imports, and an audit log. Dates are revisited at the end of each quarter.

# Support
Customers reach support through the help desk. Response time depends on the plan and the severity of the issue.

# Accessibility
The interface supports keyboard navigation and screen readers. Every control has an accessible label and visible focus state.`;

export type EvalCase = { question: string; answer: string };

export const EVAL_CASES: EvalCase[] = [
  { question: "What is Atlas?", answer: "research platform" },
  { question: "Why does chunk overlap matter?", answer: "preserves context" },
  { question: "How should retrieval be evaluated?", answer: "recall@k" },
  { question: "What does ingestion extract from files?", answer: "extracts text" },
  { question: "How are queries compared with chunks?", answer: "cosine similarity" },
  { question: "Who owns each document?", answer: "owning workspace" },
  { question: "What is required to deploy the server?", answer: "pdftotext" },
  { question: "Which local runtime provides embeddings?", answer: "Ollama" },
  { question: "How often are invoices issued?", answer: "monthly" },
  { question: "What comes in the next release?", answer: "audit log" },
  { question: "Where do customers reach support?", answer: "help desk" },
  { question: "How does the interface support keyboard users?", answer: "accessible label" },
];
