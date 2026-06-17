=// Ping — AI smart-capture route (Google Gemini, free tier)
// Takes a raw reminder note and returns a cleaner title, optional subtasks, and an optional note.
// The API key stays server-side (Vercel env var) and is never exposed to the browser.

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-2.5-flash'; // free-tier model. If you ever get a "model not found" error, swap this line.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!GEMINI_KEY) return res.status(500).json({ error: 'Missing GEMINI_API_KEY env var' });

  try {
    const { text } = req.body || {};
    if (!text || !text.trim()) return res.status(400).json({ error: 'No text provided' });

    const prompt = [
      'You help tidy up a quick personal reminder note.',
      'Given the raw note below, return:',
      '- title: a clear, concise, actionable version (imperative voice, ideally under 8 words, no trailing punctuation). If the note is already clean, return it mostly as-is.',
      '  Capitalize the title in Title Case: capitalize the first word, the last word, and all major words. Keep minor words lowercase (a, an, the, and, but, or, nor, for, to, of, in, on, at, by, up, as, vs, via) UNLESS they are the first or last word. Example: "discuss diploma payment with parents" -> "Discuss Diploma Payment with Parents".',
      '- subtasks: 2 to 6 short concrete steps, ONLY if the note clearly implies multiple steps. If it is a simple one-off, return an empty array. Do not invent busywork.',
      '- note: one short line of useful context ONLY if it genuinely helps. Otherwise an empty string.',
      'Keep everything brief and practical.',
      '',
      'Raw note: """' + text.trim() + '"""'
    ].join('\n');

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING' },
            subtasks: { type: 'ARRAY', items: { type: 'STRING' } },
            note: { type: 'STRING' }
          },
          required: ['title']
        }
      }
    };

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify(body)
    });

    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: `Gemini ${r.status}: ${t.slice(0, 300)}` });
    }

    const data = await r.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    return res.status(200).json({
      title: typeof parsed.title === 'string' ? parsed.title.trim() : '',
      subtasks: Array.isArray(parsed.subtasks) ? parsed.subtasks.filter(s => typeof s === 'string' && s.trim()).slice(0, 8) : [],
      note: typeof parsed.note === 'string' ? parsed.note.trim() : ''
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
