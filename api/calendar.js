// Ping — Google Calendar availability route.
// Reads the user's private iCal feed (GOOGLE_ICAL_URL env var), parses it server-side
// (no external deps), and returns the events that fall on a requested day (?date=YYYY-MM-DD).
// Times are assumed to be US Eastern (the user's timezone) when not given in UTC.

const ICAL_URL = process.env.GOOGLE_ICAL_URL;

function unfold(text) { return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, ''); }

// Second Sunday of March .. first Sunday of November => US Eastern DST (EDT, UTC-4), else EST (UTC-5).
function nthSundayOfMonth(year, month, n) {
  let count = 0;
  for (let day = 1; day <= 31; day++) {
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (dt.getUTCMonth() !== month - 1) break;
    if (dt.getUTCDay() === 0) { count++; if (count === n) return day; }
  }
  return 1;
}
function isEDT(y, mo, d) {
  const cur = Date.UTC(y, mo - 1, d);
  const s = Date.UTC(y, 2, nthSundayOfMonth(y, 3, 2));
  const e = Date.UTC(y, 10, nthSundayOfMonth(y, 11, 1));
  return cur >= s && cur < e;
}
function etWallToUTC(y, mo, d, h, mi, s) {
  const off = isEDT(y, mo, d) ? 4 : 5;
  return new Date(Date.UTC(y, mo - 1, d, h + off, mi, s || 0));
}
const pad = n => String(n).padStart(2, '0');
function dayKeyFromParts(y, mo, d) { return `${y}-${pad(mo)}-${pad(d)}`; }

function parseICalDate(val, left) {
  const dateOnly = /VALUE=DATE/i.test(left) || /^\d{8}$/.test(val.trim());
  const m = val.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?/);
  if (!m) return null;
  const Y = +m[1], Mo = +m[2], D = +m[3];
  if (dateOnly || m[4] === undefined) {
    return { allDay: true, y: Y, mo: Mo, d: D, h: 0, mi: 0, s: 0, key: dayKeyFromParts(Y, Mo, D), utc: Date.UTC(Y, Mo - 1, D) };
  }
  const h = +m[4], mi = +m[5], s = +(m[6] || 0);
  const utc = m[7] === 'Z' ? Date.UTC(Y, Mo - 1, D, h, mi, s) : etWallToUTC(Y, Mo, D, h, mi, s).getTime();
  return { allDay: false, y: Y, mo: Mo, d: D, h, mi, s, key: dayKeyFromParts(Y, Mo, D), utc, fixedUTC: m[7] === 'Z' };
}

function parseRRule(val) {
  const r = {};
  val.split(';').forEach(p => { const [k, v] = p.split('='); if (k && v) r[k.toUpperCase()] = v; });
  const out = { freq: r.FREQ, interval: parseInt(r.INTERVAL || '1', 10) || 1 };
  if (r.UNTIL) { const p = parseICalDate(r.UNTIL, ''); if (p) out.until = p.utc; }
  if (r.COUNT) out.count = parseInt(r.COUNT, 10);
  if (r.BYDAY) out.byday = r.BYDAY.split(',').map(s => s.replace(/[-0-9]/g, '').toUpperCase());
  return out;
}

const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function weekdayOf(y, mo, d) { return new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); }
function daysBetween(a, b) { return Math.round((Date.UTC(b.y, b.mo - 1, b.d) - Date.UTC(a.y, a.mo - 1, a.d)) / 86400000); }

function parseEvents(ics) {
  const text = unfold(ics);
  const out = [];
  const blocks = text.split('BEGIN:VEVENT').slice(1);
  for (const b of blocks) {
    const body = b.split('END:VEVENT')[0];
    const ev = { summary: '(busy)', exdates: [] };
    for (const line of body.split('\n')) {
      const idx = line.indexOf(':'); if (idx < 0) continue;
      const left = line.slice(0, idx); const val = line.slice(idx + 1).trim();
      const name = left.split(';')[0].toUpperCase();
      if (name === 'SUMMARY') ev.summary = val.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/gi, ' ').replace(/\\\\/g, '\\') || '(busy)';
      else if (name === 'DTSTART') ev.start = parseICalDate(val, left);
      else if (name === 'DTEND') ev.end = parseICalDate(val, left);
      else if (name === 'RRULE') ev.rrule = parseRRule(val);
      else if (name === 'STATUS') ev.status = val.toUpperCase();
      else if (name === 'EXDATE') val.split(',').forEach(v => { const p = parseICalDate(v, left); if (p) ev.exdates.push(p.key); });
    }
    if (ev.start && ev.status !== 'CANCELLED') out.push(ev);
  }
  return out;
}

// Does the recurring event (or single event) occur on requested day R?
function occursOn(ev, R) {
  const st = ev.start;
  if (ev.exdates.includes(R.key)) return false;
  if (!ev.rrule) {
    if (st.allDay) {
      // all-day may span multiple days (DTEND exclusive)
      const startUTC = Date.UTC(st.y, st.mo - 1, st.d);
      const endUTC = ev.end ? Date.UTC(ev.end.y, ev.end.mo - 1, ev.end.d) : startUTC + 86400000;
      const rUTC = Date.UTC(R.y, R.mo - 1, R.d);
      return rUTC >= startUTC && rUTC < endUTC;
    }
    return st.key === R.key;
  }
  // recurring
  const rr = ev.rrule;
  if (rr.until && Date.UTC(R.y, R.mo - 1, R.d) > rr.until + 86400000) return false;
  const startUTC = Date.UTC(st.y, st.mo - 1, st.d);
  const rUTC = Date.UTC(R.y, R.mo - 1, R.d);
  if (rUTC < startUTC) return false;
  const diff = daysBetween(st, R);
  if (rr.freq === 'DAILY') return diff % rr.interval === 0;
  if (rr.freq === 'WEEKLY') {
    const byday = rr.byday && rr.byday.length ? rr.byday : [WD[weekdayOf(st.y, st.mo, st.d)]];
    if (!byday.includes(WD[weekdayOf(R.y, R.mo, R.d)])) return false;
    const weeks = Math.floor(diff / 7);
    return weeks % rr.interval === 0;
  }
  if (rr.freq === 'MONTHLY') return R.d === st.d && (((R.y - st.y) * 12 + (R.mo - st.mo)) % rr.interval === 0);
  if (rr.freq === 'YEARLY') return R.d === st.d && R.mo === st.mo && ((R.y - st.y) % rr.interval === 0);
  return false;
}

function buildOccurrence(ev, R) {
  const st = ev.start;
  if (st.allDay) return { summary: ev.summary, allDay: true, start: null, end: null };
  const durMs = ev.end ? Math.max(0, ev.end.utc - st.utc) : 30 * 60000;
  let startMs;
  if (!ev.rrule) {
    startMs = st.utc; // single event: exact parsed instant
  } else {
    // recurring: rebuild the start on the requested day from the wall-clock components
    startMs = (st.fixedUTC ? new Date(Date.UTC(R.y, R.mo - 1, R.d, st.h, st.mi, st.s)) : etWallToUTC(R.y, R.mo, R.d, st.h, st.mi, st.s)).getTime();
  }
  return { summary: ev.summary, allDay: false, start: new Date(startMs).toISOString(), end: new Date(startMs + durMs).toISOString() };
}

async function getEventsForDay(dateStr) {
  const res = await fetch(ICAL_URL);
  if (!res.ok) throw new Error(`iCal fetch ${res.status}`);
  const ics = await res.text();
  const events = parseEvents(ics);
  const [Y, Mo, D] = dateStr.split('-').map(Number);
  const R = { y: Y, mo: Mo, d: D, key: dayKeyFromParts(Y, Mo, D) };
  const day = [];
  for (const ev of events) { if (occursOn(ev, R)) day.push(buildOccurrence(ev, R)); }
  day.sort((a, b) => (a.allDay ? -1 : b.allDay ? 1 : a.start.localeCompare(b.start)));
  return day;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!ICAL_URL) return res.status(500).json({ error: 'Missing GOOGLE_ICAL_URL env var' });
  try {
    const date = (req.query && req.query.date) || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    const events = await getEventsForDay(date);
    return res.status(200).json({ date, events });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

export { parseEvents, occursOn, buildOccurrence, parseICalDate };
