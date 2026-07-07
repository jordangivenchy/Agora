import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

/* Agora — the in-debate AI assistant. Answers fact-check and background
   questions for both debaters, concisely and with named sources.
   Requires ANTHROPIC_API_KEY in .env.local; returns a setup hint until
   one is configured. */

const AGORA_SYSTEM = `You are Agora, the neutral in-debate AI assistant on AgoraSphere, a live debate platform. Both debaters and the audience see your answers, so you never take a side on the motion.

Rules:
- Answer in 2 to 4 sentences. Debates move fast; be precise and quotable.
- When you state a fact or statistic, name your source inline: the study, author, institution, or dataset, with a year when you know it (e.g. "Finland's 2017-18 basic income pilot, per Kela's final report").
- If you are not confident, say so plainly and say what is uncertain. Never fabricate a citation.
- If a claim is contested in the literature, say what each side of the evidence shows.
- You may be asked to fact-check something a debater just said; assess the claim as stated, not the debater.
- Plain text only — no markdown headers or bullet lists; this renders in a small chat panel and is also read aloud.`;

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error: "no_key",
        answer:
          "Agora's knowledge engine isn't connected yet — add an ANTHROPIC_API_KEY to .env.local and restart the server, and I'll answer with sourced facts.",
      },
      { status: 503 }
    );
  }

  let question = "";
  let motion = "";
  try {
    const body = await req.json();
    question = String(body.question ?? "").slice(0, 2000);
    motion = String(body.motion ?? "").slice(0, 300);
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!question.trim()) {
    return NextResponse.json({ error: "empty_question" }, { status: 400 });
  }

  const client = new Anthropic();
  try {
    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      system: AGORA_SYSTEM,
      messages: [
        {
          role: "user",
          content: motion
            ? `Motion under debate: "${motion}"\n\nQuestion: ${question}`
            : question,
        },
      ],
    });

    if (message.stop_reason === "refusal") {
      return NextResponse.json({
        answer: "I can't help with that question, but I'm happy to fact-check claims about the motion.",
      });
    }

    const answer = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    return NextResponse.json({ answer: answer || "I don't have a useful answer to that — try rephrasing?" });
  } catch (err) {
    console.error("[agora] API call failed:", err);
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { error: "bad_key", answer: "Agora's API key looks invalid — check ANTHROPIC_API_KEY in .env.local." },
        { status: 503 }
      );
    }
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "rate_limited", answer: "I'm getting a lot of questions right now — try again in a few seconds." },
        { status: 429 }
      );
    }
    return NextResponse.json(
      { error: "upstream", answer: "Something went wrong reaching my knowledge engine — try again." },
      { status: 502 }
    );
  }
}
