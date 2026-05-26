// Nahida AI — API v2 (CommonJS, Vercel Serverless)
// 3-layer: analysis → deep scholarly answer → session title generation

const GROQ_BASE = "https://api.groq.com/openai/v1/chat/completions";

async function groqCall(apiKey, messages, model, maxTokens, temp) {
  const resp = await fetch(GROQ_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: temp })
  });
  if (!resp.ok) {
    let msg = "Groq API error " + resp.status;
    try { const e = await resp.json(); if (e.error && e.error.message) msg = e.error.message; } catch(_){}
    throw new Error(msg);
  }
  const d = await resp.json();
  return d.choices[0].message.content;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-groq-key");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = (req.headers && req.headers["x-groq-key"]) || process.env.GROQ_API_KEY || "";
  if (!apiKey.trim()) return res.status(500).json({ error: "GROQ_API_KEY not configured in Vercel environment variables." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch(_){ body = {}; } }

  const question    = body && body.question ? String(body.question).trim() : "";
  const sessionMsgs = (body && Array.isArray(body.sessionMessages)) ? body.sessionMessages : [];
  const genTitle    = body && body.genTitle === true;

  if (!question && !genTitle) return res.status(400).json({ error: "Question is required" });

  // ── TITLE GENERATION MODE ───────────────────────────────────────────────
  if (genTitle && sessionMsgs.length >= 2) {
    const summary = sessionMsgs.slice(0, 6).map(m => m.role + ": " + m.content.substring(0, 120)).join("\n");
    const titlePrompt = "Based on this Islamic Q&A session, generate a SHORT title in Bangla (4-6 words max). " +
      "Output ONLY the title, nothing else, no quotes.\n\nSession:\n" + summary;
    try {
      const title = await groqCall(apiKey, [{ role: "user", content: titlePrompt }], "llama-3.1-8b-instant", 40, 0.3);
      return res.json({ title: title.trim().replace(/^["']|["']$/g, "") });
    } catch(e) {
      return res.json({ title: "ইসলামিক আলোচনা" });
    }
  }

  // ── LAYER 1: Question analysis (fast) ───────────────────────────────────
  const analysisPrompt =
    "Analyze this Islamic question. Reply ONLY with valid JSON, no markdown.\n" +
    "Schema: {\"respondIn\":\"bangla|english\",\"isBanglish\":true|false," +
    "\"questionMeaning\":\"meaning in English\",\"topics\":[\"topic\"]," +
    "\"primarySources\":[\"quran\",\"bukhari\",\"muslim\"],\"complexity\":\"simple|moderate|complex\"}\n\n" +
    "DETECTION: Banglish = Bangla words in English letters (namaz, roja, wudu, dua, hajj, zakat, " +
    "jannat, jahannam, iman, nikah, talaq, halal, haram, tawbah, quran, hadith, sunnah, farz, " +
    "sunnot, makruh, haram, fiqh, isha, fajr, zuhr, asr, maghrib, takbir, taslim, tasbih, " +
    "ghusl, tayammum, qibla, masjid, imam, khutbah, sadaqah, mahr) → isBanglish=true, respondIn=bangla\n" +
    "Real English → respondIn=english | Bangla script → respondIn=bangla\n\n" +
    "Question: " + question.substring(0, 300);

  let analysis = {
    respondIn: "bangla", isBanglish: true, questionMeaning: question,
    topics: ["general Islamic question"],
    primarySources: ["quran", "bukhari", "muslim"], complexity: "moderate"
  };
  try {
    const raw = await groqCall(apiKey, [{ role: "user", content: analysisPrompt }], "llama-3.1-8b-instant", 280, 0.1);
    Object.assign(analysis, JSON.parse(raw.replace(/```json|```/g, "").trim()));
  } catch(_) {}

  // ── LAYER 2: Deep scholarly answer ──────────────────────────────────────
  const inBangla = analysis.respondIn === "bangla";
  const langRule = inBangla
    ? "CRITICAL: Write your ENTIRE response in Bangla script (বাংলা). User typed Banglish — understand fully, respond in fluent Bangla only. No English except Arabic Islamic terms."
    : "Respond in clear scholarly English.";

  const systemPrompt =
    "You are Nahida AI — a deeply learned Islamic scholar AI with mastery of classical and contemporary Islamic sciences.\n\n" +
    "Sources you draw from:\n" +
    "• Al-Quranul Karim — all 114 Surahs, Arabic text, meaning, full tafsir context\n" +
    "• Sahih Bukhari (7563 hadiths) • Sahih Muslim (7500 hadiths)\n" +
    "• Sunan Abu Dawud • Jami at-Tirmidhi • Sunan Ibn Majah • Sunan an-Nasai\n" +
    "• Tafsir: Ibn Kathir, Al-Tabari, Al-Qurtubi, Al-Baghawi, As-Sa'di\n" +
    "• Scholars: Imam Abu Hanifa, Imam Malik, Imam Shafi'i, Imam Ahmad ibn Hanbal\n" +
    "• Contemporary: Ibn Baz, Ibn Uthaymin, Yusuf al-Qaradawi, Mufti Taqi Usmani\n\n" +
    langRule + "\n\n" +
    "ACCURACY NON-NEGOTIABLES:\n" +
    "1. NEVER fabricate hadith numbers. If unsure, cite the book name only and write 'প্রায়' or 'approximately'.\n" +
    "2. Quran citation: সূরা [Name] [Surah#]:[Ayah#] — e.g. সূরা আল-বাকারা ২:১৮৫\n" +
    "3. Hadith citation: সহিহ বুখারী, কিতাবু [Book name] or Sahih Bukhari, Book of [Topic]\n" +
    "4. When scholars of different madhabs differ, note it honestly.\n" +
    "5. Tone: warm, caring, patient — like explaining to a beloved mother.\n\n" +
    "RESPONSE STRUCTURE — always follow all 6 sections:\n\n" +
    "بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ\n\n" +
    "▌সরাসরি উত্তর\n" +
    "[2-3 sentences: clear, direct answer]\n\n" +
    "📖 কুরআনের আলো\n" +
    "[Relevant Quran ayah(s) with Surah:Ayah citation and brief explanation of the verse's meaning in context]\n\n" +
    "📚 হাদিসের প্রমাণ\n" +
    "[2-3 relevant hadiths with source citation. Include the wisdom behind each hadith.]\n\n" +
    "🕌 বিদ্বানদের ব্যাখ্যা\n" +
    "[What major scholars like Imam Ibn Kathir, Ibn Baz, Mufti Taqi Usmani, or relevant classical/modern scholar said. Include at least one classical and one contemporary view.]\n\n" +
    "⚠️ প্রচলিত ভুল ধারণা\n" +
    "[Common misconceptions people have about this topic, and what the correct Islamic position actually is. Be gentle but clear.]\n\n" +
    "✅ আমলের নির্দেশনা\n" +
    "[Practical step-by-step guidance for daily life. Warm, encouraging, easy to follow.]\n\n" +
    "--- context ---\n" +
    "Topics: " + analysis.topics.join(", ") + "\n" +
    "Question meaning: " + analysis.questionMeaning;

  // Build full session history as messages for persistent memory
  const histMessages = [];
  for (let i = 0; i < sessionMsgs.length; i++) {
    const m = sessionMsgs[i];
    if (m.role === "user" || m.role === "assistant") {
      histMessages.push({ role: m.role, content: String(m.content).substring(0, 2000) });
    }
  }

  const messages = [{ role: "system", content: systemPrompt }]
    .concat(histMessages)
    .concat([{ role: "user", content: question }]);

  let answer;
  try {
    answer = await groqCall(apiKey, messages, "llama-3.3-70b-versatile", 2200, 0.2);
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }

  return res.json({ answer, analysis });
};
