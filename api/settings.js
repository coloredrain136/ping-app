// Ping — settings sync route. Stores the whole settings object under one key (last-write-wins).
// Reuses the same Upstash credentials as the reminders route — no new env var needed.

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(command) {
  const res = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Upstash ${res.status}: ${t}`); }
  const data = await res.json();
  return data.result;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    try {
      const { settings } = req.body || {};
      if (!settings || typeof settings !== 'object') return res.status(400).json({ error: 'settings must be an object' });
      await redis(['SET', 'ping_settings', JSON.stringify(settings)]);
      return res.status(200).json({ ok: true });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  if (req.method === 'GET') {
    try {
      const raw = await redis(['GET', 'ping_settings']);
      const settings = raw ? JSON.parse(raw) : null;
      return res.status(200).json({ settings });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
