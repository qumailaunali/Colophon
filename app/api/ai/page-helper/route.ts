import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { action, text, messages } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Missing or invalid page text." }, { status: 400 });
    }

    if (!action || (action !== "summarize" && action !== "flashcards" && action !== "ask_book")) {
      return NextResponse.json({ error: "Invalid action. Must be 'summarize', 'flashcards', or 'ask_book'." }, { status: 400 });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OpenRouter API key is not configured on the server." }, { status: 500 });
    }

    // Set up chat payload messages
    let apiMessages: any[] = [];
    if (action === "ask_book") {
      if (!Array.isArray(messages)) {
        return NextResponse.json({ error: "Missing or invalid messages history array." }, { status: 400 });
      }
      const systemPrompt = `You are a helpful reading assistant. You are answering questions about the text of the book page displayed below.

Page Text:
${text}

Instructions:
1. Rely ONLY on the provided Page Text to answer the question. If the answer cannot be found in the text, explain that it is not mentioned on this page.
2. Be concise, clear, and direct.
3. Keep the tone helpful and friendly.`;

      apiMessages = [
        { role: "system", content: systemPrompt },
        ...messages.map((m: any) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content || ""
        }))
      ];
    } else {
      const systemPrompt = `You are an expert reading assistant. You will be given the text of a single page of a book. Your task is to output a clean JSON object based on the user's requested action ('summarize' or 'flashcards').
            
If action is 'summarize', output EXACTLY a JSON object with a 'summary' key mapping to an array of 2-3 concise summary sentences/points:
{
  "summary": [
    "Concise summary point 1.",
    "Concise summary point 2.",
    "Concise summary point 3."
  ]
}

If action is 'flashcards', output EXACTLY a JSON object with a 'flashcards' key mapping to an array of 3 useful study questions and answers:
{
  "flashcards": [
    { "question": "What is ...?", "answer": "..." },
    { "question": "How did ...?", "answer": "..." },
    { "question": "Why does ...?", "answer": "..." }
  ]
}

Do not wrap the JSON output in markdown code blocks. Return ONLY the raw JSON string.`;

      apiMessages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Action: ${action}\n\nPage Text:\n${text}` }
      ];
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Colophon",
      },
      body: JSON.stringify({
        model: "openrouter/free",
        messages: apiMessages,
        temperature: action === "ask_book" ? 0.5 : 0.3,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenRouter API error:", errText);
      return NextResponse.json({ error: `API request failed: ${response.statusText}` }, { status: 502 });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || "";

    if (action === "ask_book") {
      return NextResponse.json({ answer: reply });
    }

    // Clean up code blocks if the model wrapped JSON anyway
    let cleanedReply = reply;
    if (cleanedReply.startsWith("```json")) {
      cleanedReply = cleanedReply.substring(7);
    }
    if (cleanedReply.startsWith("```")) {
      cleanedReply = cleanedReply.substring(3);
    }
    if (cleanedReply.endsWith("```")) {
      cleanedReply = cleanedReply.substring(0, cleanedReply.length - 3);
    }
    cleanedReply = cleanedReply.trim();

    try {
      const parsed = JSON.parse(cleanedReply);
      return NextResponse.json(parsed);
    } catch (parseErr) {
      console.error("Failed to parse AI response as JSON. Raw reply:", reply);
      return NextResponse.json({ error: "AI model failed to return valid JSON format." }, { status: 500 });
    }
  } catch (err: any) {
    console.error("Page helper API error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
