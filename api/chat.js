const GROQ_BASE = 'https://api.groq.com/openai/v1/chat/completions';

async function groqCall(apiKey, messages, model, maxTokens, temperature = 0.2) {
  const res = await fetch(GROQ_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Groq API error: ${res.status}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = req.headers['x-groq-key'] || process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY not set. Please add it in Settings or configure it in Vercel environment variables.' });

  const { question, conversationHistory = [] } = req.body;
  if (!question?.trim()) return res.status(400).json({ error: 'Question is required.' });

  // ── LAYER 1: Fast question analysis (llama-3.1-8b-instant) ────────────────
  // Detects language, Banglish, topics, and which Islamic sources to prioritize.
  const analysisPrompt = `You are an Islamic question analyzer. Given a user question, output ONLY valid JSON (no markdown, no explanation):

{
  "respondIn": "bangla" or "english",
  "isBanglish": true or false,
  "questionMeaning": "English translation if banglish, else repeat the question",
  "topics": ["list of Islamic topics like namaz, zakat, nikah, etc"],
  "primarySources": ["quran", "bukhari", "muslim", "tirmidhi", "abudawud"],
  "complexity": "simple" or "moderate" or "complex",
  "needsFiqh": true or false,
  "searchAngles": ["angle1", "angle2"]
}

DETECTION RULES:
- If user types Bangla words in English letters (banglish), examples: "namaz ki", "roja rakhar niyom", "dua kora ki", "quran e ki ache", "Allah ke", "jannat kemon", "ki kore namaz pora jay" → isBanglish=true, respondIn=bangla
- If actual English → respondIn=english
- If Bangla script → respondIn=bangla

User question: "${question.replace(/"/g, '\\"')}"`;

  let analysis = {
    respondIn: 'bangla',
    isBanglish: true,
    questionMeaning: question,
    topics: ['general Islamic question'],
    primarySources: ['quran', 'bukhari', 'muslim'],
    complexity: 'moderate',
    needsFiqh: false,
    searchAngles: ['Islamic ruling', 'Quranic guidance']
  };

  try {
    const raw = await groqCall(
      apiKey,
      [{ role: 'user', content: analysisPrompt }],
      'llama-3.1-8b-instant',
      350,
      0.1
    );
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    analysis = { ...analysis, ...parsed };
  } catch (_) {
    // Use defaults — don't block the answer
  }

  // ── LAYER 2: Scholarly deep answer (llama-3.3-70b-versatile) ──────────────
  const langInstruction = analysis.respondIn === 'bangla'
    ? `IMPORTANT: Respond ENTIRELY in Bangla script (বাংলা). The user typed in English letters (Banglish) but means Bangla — understand it fully and respond in pure, fluent Bangla. Never use English words in your answer except for Arabic/Islamic terms.`
    : `Respond in clear, scholarly English.`;

  const scholarSystem = `You are Nahida AI — a deeply knowledgeable Islamic scholar AI with mastery over:
• The Holy Quran — all 114 Surahs, Arabic text, meaning, and context
• Sahih Bukhari — all 97 books and 7,563 hadiths  
• Sahih Muslim — all 56 books and ~7,500 hadiths
• Sunan Abu Dawud, Tirmidhi, Ibn Majah, An-Nasai (the four Sunan)
• Classical Tafsir: Ibn Kathir, Al-Tabari, Al-Qurtubi, Al-Baghawi
• Islamic Fiqh: Hanafi, Maliki, Shafi'i, Hanbali madhabs

${langInstruction}

ACCURACY RULES (most important):
1. NEVER fabricate specific hadith numbers. If uncertain of exact number, say "প্রায়" (approximately) or cite only the book name.
2. Always cross-reference: if Quran says X, find supporting hadith. If hadith says X, find Quranic basis.
3. Mention if scholars have differing opinions — this is honest scholarship.
4. Cite Quran as: সূরা [নাম] [X]:[Y] or Surah [Name] [X]:[Y]
5. Cite hadith as: সহিহ বুখারী, কিতাবুল [বিষয়], হাদিস নং [X] or Sahih Bukhari, Book of [Topic], Hadith [X]

RESPONSE STRUCTURE:
بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ

[Direct answer — clear and concise]

[Quranic evidence with citation]

[Hadith evidence with citation]

[If relevant: scholarly opinions / madhab differences]

[Practical guidance — warm, caring tone]

Question context identified: ${analysis.topics?.join(', ')} | Sources: ${analysis.primarySources?.join(', ')}
Original meaning: ${analysis.questionMeaning}`;

  const history = conversationHistory.slice(-6).flatMap(h => [
    { role: 'user', content: h.q },
    { role: 'assistant', content: h.a }
  ]);

  let answer;
  try {
    answer = await groqCall(
      apiKey,
      [
        { role: 'system', content: scholarSystem },
        ...history,
        { role: 'user', content: question }
      ],
      'llama-3.3-70b-versatile',
      1600,
      0.2
    );
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  return res.json({ answer, analysis });
}
