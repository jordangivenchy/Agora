import Anthropic from "@anthropic-ai/sdk";

/* Model-agnostic AI layer. The orchestrator (/api/agora) talks only to
   generateAnswer(); which vendor serves the request is decided here.

   Order: Gemini (primary, cheapest per token) → Claude (fallback, the
   previously wired provider with the same tuned persona). Either can be
   disabled by omitting its key. If both fail, the route serves the Supabase
   response cache — so the chat box keeps answering even when every AI vendor
   is down (stale answers beat no answers mid-debate).

   Gemini is called over raw REST rather than @google/genai so this file has no
   hard dependency on a package that may not be installed yet; the endpoint is
   stable v1beta generateContent. */

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateParams {
  system: string;
  history: ChatTurn[];
  question: string;
  maxOutputTokens?: number;
}

export interface GenerateResult {
  answer: string;
  provider: "gemini" | "anthropic";
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export class NoProviderConfiguredError extends Error {
  constructor() {
    super("No AI provider configured — set GEMINI_API_KEY and/or ANTHROPIC_API_KEY");
    this.name = "NoProviderConfiguredError";
  }
}

export class AllProvidersFailedError extends Error {
  constructor(public causes: { provider: string; error: unknown }[]) {
    super("All AI providers failed");
    this.name = "AllProvidersFailedError";
  }
}

// "latest" alias: Google retires pinned versions for new keys (2.5-flash 404s
// on keys created after mid-2026); the rolling alias tracks the current flash.
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-latest";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";
const DEFAULT_MAX_TOKENS = 1024;
const GEMINI_TIMEOUT_MS = 20_000;

async function callGemini(params: GenerateParams): Promise<GenerateResult> {
  // 429/5xx from Gemini are usually momentary demand spikes; one short retry
  // rescues most of them without holding the chatbox open long enough to matter.
  try {
    return await callGeminiOnce(params);
  } catch (err) {
    if (err instanceof Error && /Gemini (429|5\d\d)/.test(err.message)) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      return await callGeminiOnce(params);
    }
    throw err;
  }
}

async function callGeminiOnce(params: GenerateParams): Promise<GenerateResult> {
  const key = process.env.GEMINI_API_KEY!;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

  const contents = [
    ...params.history.map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.content }],
    })),
    { role: "user", parts: [{ text: params.question }] },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: params.system }] },
        contents,
        generationConfig: {
          maxOutputTokens: params.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Gemini ${res.status}: ${detail.slice(0, 300)}`);
    }

    const data = await res.json();
    const answer: string = (data.candidates?.[0]?.content?.parts ?? [])
      .map((part: { text?: string }) => part.text ?? "")
      .join("")
      .trim();
    if (!answer) throw new Error(`Gemini returned no text (finishReason: ${data.candidates?.[0]?.finishReason ?? "unknown"})`);

    return {
      answer,
      provider: "gemini",
      model: GEMINI_MODEL,
      inputTokens: data.usageMetadata?.promptTokenCount ?? null,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropic(params: GenerateParams): Promise<GenerateResult> {
  const client = new Anthropic();
  const stream = client.messages.stream({
    model: ANTHROPIC_MODEL,
    max_tokens: params.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
    system: params.system,
    messages: [
      ...params.history.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: "user" as const, content: params.question },
    ],
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    // A refusal is an answer, not an outage — don't cascade to the fallback.
    return {
      answer:
        "I can't help with that question, but I'm happy to fact-check claims about the motion.",
      provider: "anthropic",
      model: ANTHROPIC_MODEL,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    };
  }

  const answer = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  if (!answer) throw new Error("Anthropic returned no text");

  return {
    answer,
    provider: "anthropic",
    model: ANTHROPIC_MODEL,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
}

export function configuredProviders(): ("gemini" | "anthropic")[] {
  const providers: ("gemini" | "anthropic")[] = [];
  if (process.env.GEMINI_API_KEY) providers.push("gemini");
  if (process.env.ANTHROPIC_API_KEY) providers.push("anthropic");
  return providers;
}

export async function generateAnswer(params: GenerateParams): Promise<GenerateResult> {
  const providers = configuredProviders();
  if (providers.length === 0) throw new NoProviderConfiguredError();

  const causes: { provider: string; error: unknown }[] = [];
  for (const provider of providers) {
    try {
      return provider === "gemini" ? await callGemini(params) : await callAnthropic(params);
    } catch (error) {
      console.error(`[agora] ${provider} failed:`, error);
      causes.push({ provider, error });
    }
  }
  throw new AllProvidersFailedError(causes);
}
