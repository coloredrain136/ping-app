const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisSet(value) {
  const res = await fetch(`${UPSTASH_URL}/set/ping_reminders/${encodeURIComponent(value)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  return res.json();
}

async function redisGet() {
  const res = await fetch(`${UPSTASH_URL}/get/ping_reminders`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  const data = await res.json();
  return data.result;
}

async function redisSetPost(value) {
  const res = await fetch(`${UPSTASH_URL}/set/ping_reminders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([value])
  });
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    try {
      const { reminders } = req.body;
      if (!Array.isArray(reminders)) return res.status(400).json({ error: 'Invalid data' });
      const payload = encodeURIComponent(JSON.stringify(reminders));
      const setRes = await fetch(`${UPSTASH_URL}/set/ping_reminders/${payload}`, {
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
      });
      const result = await setRes.json();
      return res.status(200).json({ ok: true, result });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'GET') {
    try {
      const raw = await redisGet();
      const reminders = raw ? JSON.parse(raw) : [];
      const now = new Date();
      const upcoming = reminders.filter(r => {
        if (r.done || !r.time) return false;
        const t = new Date(r.time);
        const diffMs = t - now;
        return diffMs >= -60000 && diffMs <= 8 * 60 * 60 * 1000;
      });
      return res.status(200).json({ reminders, upcoming });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
