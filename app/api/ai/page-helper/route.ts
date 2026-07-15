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

    let reply = "";

    try {
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
        console.warn("OpenRouter API failed, attempting Gemini fallback. OpenRouter error:", errText);
        throw new Error(`OpenRouter failed: ${response.statusText}`);
      }

      const data = await response.json();
      reply = data.choices?.[0]?.message?.content?.trim() || "";
    } catch (openRouterErr: any) {
      console.warn("OpenRouter failed or threw error. Falling back to direct Gemini API...", openRouterErr);
      try {
        reply = await callGeminiFallback(apiMessages, action);
        console.log("Direct Gemini fallback API call succeeded!");
      } catch (geminiErr: any) {
        console.error("Gemini fallback also failed:", geminiErr);
        return NextResponse.json(
          { error: `Both OpenRouter and Gemini backup APIs failed. OpenRouter error: ${openRouterErr.message}. Gemini error: ${geminiErr.message}` },
          { status: 502 }
        );
      }
    }

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

function formatMessagesForGemini(apiMessages: any[]) {
  const systemMsg = apiMessages.find((m) => m.role === "system");
  const systemInstruction = systemMsg
    ? { parts: [{ text: systemMsg.content }] }
    : undefined;

  const chatMessages = apiMessages.filter((m) => m.role !== "system");
  const contents = chatMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  return { systemInstruction, contents };
}

async function callGeminiFallback(apiMessages: any[], action: string) {
  const rawKey = process.env.Gemini_API_Key || process.env.GEMINI_API_KEY;
  if (!rawKey) {
    throw new Error("Gemini backup API key is not configured.");
  }
  const geminiApiKey = rawKey.trim();

  const { systemInstruction, contents } = formatMessagesForGemini(apiMessages);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${geminiApiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents,
      systemInstruction,
      generationConfig: {
        temperature: action === "ask_book" ? 0.5 : 0.3,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Gemini API direct error response:", errText);
    throw new Error(`Gemini API call failed: ${response.statusText} (${response.status})`);
  }

  const data = await response.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
  return reply;
}
