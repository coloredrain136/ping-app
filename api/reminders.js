// Ping — Upstash sync API route
// Stores the full reminders array under a single key and returns it,
// plus an `upcoming` slice (due within 8h) for the future notification Shortcut.

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// Robust Upstash REST call: command sent as a JSON array in the POST body.
// Avoids URL-length / encoding problems that come from stuffing JSON into the path.
async function redis(command) {
  const res = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(command)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstash ${res.status}: ${text}`);
  }
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
      const { reminders } = req.body || {};
      if (!Array.isArray(reminders)) return res.status(400).json({ error: 'reminders must be an array' });
      await redis(['SET', 'ping_reminders', JSON.stringify(reminders)]);
      return res.status(200).json({ ok: true, count: reminders.length });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'GET') {
    try {
      const raw = await redis(['GET', 'ping_reminders']);
      const reminders = raw ? JSON.parse(raw) : [];
      const now = Date.now();
      const upcoming = reminders.filter(r => {
        if (r.deleted || r.done || !r.time) return false;
        const diff = new Date(r.time).getTime() - now;
        return diff >= -60000 && diff <= 8 * 60 * 60 * 1000;
      });
      return res.status(200).json({ reminders, upcoming });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
