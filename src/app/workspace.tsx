"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUp, BookOpen, Check, ChevronRight, FileText, Link2, Menu,
  MoreHorizontal, Plus, Search, Sparkles, Trash2, X,
} from "lucide-react";

type DocumentItem = {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: string;
  _count: { chunks: number };
};

type Citation = {
  id: string;
  documentId: string;
  documentName: string;
  position: number;
  text: string;
  score: number;
};

type Message = {
  role: "user" | "assistant";
  content: string;
};

const suggestions = [
  "What is the Atlas platform?",
  "Why is chunk overlap important?",
  "How should retrieval be evaluated?",
];

export default function Workspace() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  async function loadDocuments() {
    const response = await fetch("/api/documents");
    const data = await response.json();
    setDocuments(data.documents ?? []);
  }

  useEffect(() => { loadDocuments(); }, []);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function upload(file: File) {
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/documents", { method: "POST", body: form });
    if (response.ok) await loadDocuments();
    else {
      const data = await response.json();
      alert(data.error ?? "Upload failed");
    }
    setUploading(false);
  }

  async function removeDocument(id: string) {
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    await loadDocuments();
  }

  async function ask(value = question) {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    setQuestion("");
    setLoading(true);
    setMessages((current) => [...current, { role: "user", content: trimmed }]);

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: trimmed }),
    });

    if (!response.ok || !response.body) {
      setLoading(false);
      setMessages((current) => [...current, { role: "assistant", content: "I could not answer that request. Please try again." }]);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let content = "";
    setMessages((current) => [...current, { role: "assistant", content: "" }]);

    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      content += decoder.decode(chunk, { stream: true });
      const marker = content.indexOf("__CITATIONS__");
      if (marker !== -1) {
        const answer = content.slice(0, marker);
        try {
          const found = JSON.parse(content.slice(marker + "__CITATIONS__".length)) as Citation[];
          setCitations(found);
        } catch {}
        setMessages((current) => {
          const next = [...current];
          next[next.length - 1] = { role: "assistant", content: answer };
          return next;
        });
      } else {
        setMessages((current) => {
          const next = [...current];
          next[next.length - 1] = { role: "assistant", content };
          return next;
        });
      }
    }
    setLoading(false);
  }

  return (
    <main className="h-[100dvh] overflow-hidden bg-[#f7f7f4] text-[#171816]">
      <div className="flex h-full">
        <aside className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} fixed inset-y-0 left-0 z-50 flex w-[278px] flex-col border-r border-[#dedfd8] bg-[#efefe9] transition-transform duration-300 lg:relative lg:translate-x-0`}>
          <div className="flex h-[68px] items-center justify-between px-5">
            <div className="flex items-center gap-2.5">
              <div className="grid h-8 w-8 place-items-center rounded-[9px] bg-[#1d201b] text-[#dfff6d]">
                <Sparkles size={16} strokeWidth={2.2} />
              </div>
              <span className="text-[17px] font-semibold tracking-[-0.02em]">Memora</span>
            </div>
            <button onClick={() => setSidebarOpen(false)} className="rounded-md p-1.5 text-[#777a72] lg:hidden" aria-label="Close sidebar"><X size={18} /></button>
          </div>
          <div className="px-3">
            <button onClick={() => fileInput.current?.click()} className="flex h-11 w-full items-center gap-2.5 rounded-[10px] border border-[#d1d3cb] bg-white px-3 text-[13px] font-semibold shadow-sm transition hover:border-[#b7baaf]">
              <Plus size={16} />{uploading ? "Ingesting..." : "Add knowledge"}
            </button>
            <input ref={fileInput} type="file" accept=".pdf,.txt,.md,.markdown" className="hidden" onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} />
          </div>
          <div className="mt-6 px-5">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#92958b]">Library</p>
              <span className="rounded-full bg-[#dedfd8] px-2 py-0.5 text-[10px] font-bold text-[#777a72]">{documents.length}</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-3">
            {documents.map((document) => (
              <div key={document.id} className="group mb-1 flex items-center gap-2.5 rounded-[9px] px-2.5 py-2.5 hover:bg-white/70">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] border border-[#dcddd5] bg-white text-[#777b70]"><FileText size={15} /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold">{document.name}</p>
                  <p className="mt-0.5 text-[10px] text-[#969990]">{document._count.chunks} chunks</p>
                </div>
                <button onClick={() => removeDocument(document.id)} className="hidden rounded-md p-1.5 text-[#999c92] hover:bg-[#ecece6] hover:text-[#8a3f32] group-hover:block" aria-label={`Delete ${document.name}`}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
          <div className="border-t border-[#dedfd8] p-3">
            <div className="flex items-center gap-2.5 rounded-[9px] px-2 py-2">
              <div className="grid h-8 w-8 place-items-center rounded-full bg-[#dfff6d] text-[11px] font-bold">AD</div>
              <div className="min-w-0 flex-1"><p className="text-[12px] font-semibold">Personal workspace</p><p className="text-[10px] text-[#969990]">Local demo</p></div>
              <MoreHorizontal size={16} className="text-[#969990]" />
            </div>
          </div>
        </aside>
        {sidebarOpen && <button className="fixed inset-0 z-40 bg-black/20 lg:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close menu" />}

        <section className="flex min-w-0 flex-1 flex-col bg-white">
          <header className="flex h-[68px] shrink-0 items-center justify-between border-b border-[#ebebe6] px-4 lg:px-7">
            <div className="flex items-center gap-3">
              <button onClick={() => setSidebarOpen(true)} className="rounded-md p-2 text-[#777a72] lg:hidden" aria-label="Open sidebar"><Menu size={19} /></button>
              <div><p className="text-[13px] font-semibold">Knowledge chat</p><p className="mt-0.5 hidden text-[10px] text-[#969990] sm:block">Grounded answers across {documents.length} documents</p></div>
            </div>
            <div className="flex items-center gap-2">
              <button className="hidden items-center gap-2 rounded-[8px] border border-[#e1e2dc] px-3 py-2 text-[11px] font-semibold text-[#777a72] sm:flex"><Search size={13} />Search</button>
              <button onClick={() => { setMessages([]); setCitations([]); }} className="rounded-[8px] border border-[#e1e2dc] px-3 py-2 text-[11px] font-semibold text-[#777a72] hover:bg-[#f7f7f4]">New chat</button>
            </div>
          </header>

          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex-1 overflow-y-auto">
                {messages.length === 0 ? (
                  <div className="mx-auto flex h-full max-w-[760px] flex-col justify-center px-5 pb-16">
                    <div className="mb-7 grid h-11 w-11 place-items-center rounded-[12px] border border-[#e1e2dc] bg-[#f7f7f4]"><Sparkles size={19} strokeWidth={1.8} /></div>
                    <h1 className="max-w-[620px] text-[32px] font-semibold leading-[1.12] tracking-[-0.04em] sm:text-[42px]">What do you want to know?</h1>
                    <p className="mt-3 max-w-[540px] text-[14px] leading-6 text-[#858980]">Ask a question across your documents. Answers include exact source passages you can verify.</p>
                    <div className="mt-8 grid gap-2 sm:grid-cols-3">
                      {suggestions.map((suggestion) => (
                        <button key={suggestion} onClick={() => ask(suggestion)} className="group flex min-h-[92px] flex-col justify-between rounded-[12px] border border-[#e4e5df] p-3.5 text-left text-[12px] font-semibold leading-5 transition hover:-translate-y-0.5 hover:border-[#caccc3] hover:shadow-sm">
                          <span>{suggestion}</span><ChevronRight size={14} className="self-end text-[#aaaDA3] transition group-hover:translate-x-0.5" />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto max-w-[760px] px-5 py-8">
                    {messages.map((message, index) => (
                      <div key={index} className={`mb-7 flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                        {message.role === "assistant" ? (
                          <div className="max-w-[680px]">
                            <div className="mb-2.5 flex items-center gap-2"><div className="grid h-6 w-6 place-items-center rounded-[7px] bg-[#1d201b] text-[#dfff6d]"><Sparkles size={12} /></div><span className="text-[11px] font-bold">Memora</span></div>
                            <div className="whitespace-pre-wrap text-[14px] leading-7 text-[#3d4038]">{message.content}</div>
                          </div>
                        ) : (
                          <div className="max-w-[78%] rounded-[14px] rounded-br-[4px] bg-[#eff1e9] px-4 py-3 text-[13px] leading-6">{message.content}</div>
                        )}
                      </div>
                    ))}
                    {loading && <div className="mb-7 flex items-center gap-1.5 pl-1 text-[#969990]"><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#969990]" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#969990] [animation-delay:120ms]" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#969990] [animation-delay:240ms]" /></div>}
                    <div ref={chatEnd} />
                  </div>
                )}
              </div>
              <div className="shrink-0 px-4 pb-4 sm:px-7 sm:pb-6">
                <form onSubmit={(event) => { event.preventDefault(); ask(); }} className="mx-auto flex max-w-[760px] items-end gap-2 rounded-[15px] border border-[#dfe1da] bg-white p-2 shadow-[0_8px_30px_rgba(35,38,31,0.08)] focus-within:border-[#bdc0b5]">
                  <button type="button" onClick={() => fileInput.current?.click()} className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] text-[#858980] hover:bg-[#f2f3ee]" aria-label="Upload document"><Plus size={17} /></button>
                  <textarea
                    rows={1}
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ask(); } }}
                    placeholder="Ask across your knowledge..."
                    className="max-h-28 min-h-9 flex-1 resize-none border-0 bg-transparent px-1 py-2 text-[13px] outline-none placeholder:text-[#aaaDA3]"
                  />
                  <button type="submit" disabled={!question.trim() || loading} className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-[#1d201b] text-[#dfff6d] disabled:bg-[#e7e8e2] disabled:text-[#aaaDA3]"><ArrowUp size={16} strokeWidth={2.3} /></button>
                </form>
                <p className="mt-2 hidden text-center text-[9px] text-[#aaaDA3] sm:block">Memora can make mistakes. Verify important information.</p>
              </div>
            </div>

            <aside className="hidden w-[300px] shrink-0 border-l border-[#ebebe6] bg-[#fbfbf8] xl:block">
              <div className="flex h-[58px] items-center border-b border-[#ebebe6] px-5"><div className="flex items-center gap-2"><Link2 size={14} className="text-[#858980]" /><p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#858980]">Sources</p></div></div>
              <div className="h-[calc(100%-58px)] overflow-y-auto p-3">
                {citations.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center px-8 text-center"><div className="mb-3 grid h-9 w-9 place-items-center rounded-[10px] border border-[#e4e5df] bg-white text-[#aaaDA3]"><BookOpen size={16} /></div><p className="text-[12px] font-semibold">Source passages</p><p className="mt-1.5 text-[10px] leading-4 text-[#969990]">Retrieved citations will appear here after a question.</p></div>
                ) : (
                  citations.map((citation, index) => (
                    <article key={citation.id} className="mb-2 rounded-[10px] border border-[#e4e5df] bg-white p-3.5">
                      <div className="mb-2.5 flex items-center justify-between"><div className="flex min-w-0 items-center gap-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#eff1e9] text-[9px] font-bold">{index + 1}</span><p className="truncate text-[10px] font-semibold">{citation.documentName}</p></div><span className="ml-2 text-[9px] text-[#969990]">{Math.round(citation.score * 100)}%</span></div>
                      <p className="line-clamp-5 text-[11px] leading-5 text-[#686b62]">{citation.text}</p>
                      <div className="mt-3 flex items-center gap-1.5 border-t border-[#f0f0ec] pt-2.5 text-[9px] text-[#969990]"><Check size={10} />Chunk {citation.position + 1}</div>
                    </article>
                  ))
                )}
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
