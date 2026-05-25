// Nahida AI — Islamic Q&A API (CommonJS, Vercel Serverless)
// Two-layer thinking: Layer 1 = fast analysis, Layer 2 = deep scholarly answer

const GROQ_BASE = "https://api.groq.com/openai/v1/chat/completions";

async function groqCall(apiKey, messages, model, maxTokens, temp) {
  const resp = await fetch(GROQ_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      max_tokens: maxTokens,
      temperature: temp
    })
  });

  if (!resp.ok) {
    let errMsg = "Groq API error " + resp.status;
    try {
      const e = await resp.json();
      if (e && e.error && e.error.message) errMsg = e.error.message;
    } catch (_) {}
    throw new Error(errMsg);
  }

  const d = await resp.json();
  return d.choices[0].message.content;
}

module.exports = async function handler(req, res) {
  // CORS preflight
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-groq-key");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // API key: client header takes priority, fallback to env
  const apiKey = (req.headers && req.headers["x-groq-key"]) || process.env.GROQ_API_KEY || "";
  if (!apiKey || apiKey.trim() === "") {
    return res.status(500).json({
      error: "API key missing. Set GROQ_API_KEY in Vercel → Settings → Environment Variables, then Redeploy."
    });
  }

  let body = req.body;
  // Vercel sometimes gives raw string for body
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }

  const question = body && body.question ? String(body.question).trim() : "";
  const convHistory = (body && Array.isArray(body.conversationHistory)) ? body.conversationHistory : [];

  if (!question) return res.status(400).json({ error: "Question is required" });

  // ─── LAYER 1: Question analysis (fast, cheap model) ────────────────────
  const analysisPrompt =
    "Analyze this Islamic question. Reply ONLY with valid JSON — no markdown fences, no explanation.\n" +
    "Schema: {\"respondIn\":\"bangla|english\",\"isBanglish\":true|false," +
    "\"questionMeaning\":\"meaning in English\",\"topics\":[\"topic1\"],\"primarySources\":[\"quran\",\"bukhari\",\"muslim\"]," +
    "\"complexity\":\"simple|moderate|complex\"}\n\n" +
    "Detection rules:\n" +
    "- Banglish = Bangla words spelled with English letters. Examples: namaz, roja, dua, wudu, ghusl, " +
    "quran e ki ache, Allah ke, jannat, jahannam, hajj, zakat, nikah, talaq, halal, haram, " +
    "tawbah, iman, salat, sawm, shahada, tasbih, takbir, taslim, isha, fajr, zuhr, asr, maghrib " +
    "→ set isBanglish=true, respondIn=bangla\n" +
    "- Real English sentences → respondIn=english\n" +
    "- Bangla script (বাংলা) → respondIn=bangla\n\n" +
    "Question: " + question.substring(0, 300);

  let analysis = {
    respondIn: "bangla",
    isBanglish: true,
    questionMeaning: question,
    topics: ["general Islamic question"],
    primarySources: ["quran", "bukhari", "muslim"],
    complexity: "moderate"
  };

  try {
    const raw = await groqCall(
      apiKey,
      [{ role: "user", content: analysisPrompt }],
      "llama-3.1-8b-instant",
      280,
      0.1
    );
    const cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    Object.assign(analysis, parsed);
  } catch (_) {
    // Layer 1 failed — use defaults, still proceed to Layer 2
  }

  // ─── LAYER 2: Deep scholarly answer (large model) ──────────────────────
  const langRule = analysis.respondIn === "bangla"
    ? "CRITICAL LANGUAGE RULE: Write your ENTIRE response in Bangla script (বাংলা). " +
      "The user is typing in Banglish (Bangla using English letters). Understand their meaning fully, " +
      "then respond in clear, beautiful, fluent Bangla. Never use English words except for Arabic Islamic terms."
    : "Respond in clear, scholarly English.";

  const systemPrompt =
    "You are Nahida AI — a deeply knowledgeable and caring Islamic scholar AI.\n\n" +
    "Your knowledge sources:\n" +
    "• Al-Quranul Karim — all 114 Surahs with tafsir context\n" +
    "• Sahih Bukhari — all 97 books, ~7563 hadiths\n" +
    "• Sahih Muslim — all 56 books, ~7500 hadiths\n" +
    "• Sunan Abu Dawud, Jami at-Tirmidhi, Sunan Ibn Majah, Sunan an-Nasai\n" +
    "• Tafsir Ibn Kathir, Al-Tabari, Al-Qurtubi\n" +
    "• Hanafi, Maliki, Shafi'i, Hanbali fiqh\n\n" +
    langRule + "\n\n" +
    "ACCURACY RULES (non-negotiable):\n" +
    "1. NEVER fabricate hadith numbers. If uncertain of exact hadith number, write 'প্রায়' (approximately) or cite only the book name.\n" +
    "2. Cite Quran as: সূরা [নাম] [X]:[Y] — e.g. সূরা আল-বাকারা ২:১৮৫\n" +
    "3. Cite Hadith as: সহিহ বুখারী, কিতাবু [বিষয়] — e.g. সহিহ বুখারী, কিতাবুস সাওম\n" +
    "4. If major scholars disagree, briefly note it.\n" +
    "5. Be warm and caring — like a wise elder explaining to a beloved family member.\n\n" +
    "RESPONSE FORMAT (use exactly this structure):\n" +
    "بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ\n\n" +
    "[Direct, clear answer to the question]\n\n" +
    "📖 কুরআনের দলিল:\n" +
    "[Quranic verse(s) with citation]\n\n" +
    "📚 হাদিসের দলিল:\n" +
    "[Hadith evidence with citation]\n\n" +
    "✅ বাস্তব নির্দেশনা:\n" +
    "[Practical, actionable guidance]\n\n" +
    "--- Internal context (do not show to user) ---\n" +
    "Topics: " + analysis.topics.join(", ") + "\n" +
    "Sources to prioritize: " + analysis.primarySources.join(", ") + "\n" +
    "Question meaning: " + analysis.questionMeaning;

  const histMessages = [];
  const recentHist = convHistory.slice(-4);
  for (let i = 0; i < recentHist.length; i++) {
    if (recentHist[i].q) histMessages.push({ role: "user", content: recentHist[i].q });
    if (recentHist[i].a) histMessages.push({ role: "assistant", content: recentHist[i].a });
  }

  const messages = [{ role: "system", content: systemPrompt }]
    .concat(histMessages)
    .concat([{ role: "user", content: question }]);

  let answer;
  try {
    answer = await groqCall(apiKey, messages, "llama-3.3-70b-versatile", 1500, 0.2);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  return res.json({ answer: answer, analysis: analysis });
};
