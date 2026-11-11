// Post-war reports: builds one dated report per completed war, stores it permanently,
// and returns the full archive. Needs the same Upstash storage used for MVP totals.
const TAG = (process.env.CLAN_TAG || '#LQ89GYVG').toUpperCase();
const BASE = 'https://proxy.royaleapi.dev/v1';
const RURL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const RTOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const EXCLUDE = (process.env.EXCLUDE || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

async function cr(path) {
  const r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + process.env.CR_API_KEY } });
  if (!r.ok) throw new Error(`Clash Royale API ${r.status}`);
  return r.json();
}
async function redis(cmd) {
  const r = await fetch(RURL, { method: 'POST', headers: { Authorization: 'Bearer ' + RTOK }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error('Storage: ' + j.error);
  return j.result;
}
const COUNT_WAR = "if redis.call('SADD',KEYS[1],ARGV[1])==1 then for i=2,#ARGV do redis.call('HINCRBY',KEYS[2],ARGV[i],1) end return 1 else return 0 end";
const when = x => new Date(x.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2}).*/, '$1-$2-$3T$4:$5:$6Z'));

// Same permanent MVP counting as api/mvp.js (safe to run from either place, each war counts once).
async function ensureMvp(log, cfg) {
  if (!(await redis(['GET', 'mvp:init']))) {
    for (const b of cfg.baseline) await redis(['HSET', 'mvp:counts', b.tag.toUpperCase(), String(b.count)]);
    const ids = log.items.map(w => w.createdDate);
    if (ids.length) await redis(['SADD', 'mvp:seen', ...ids]);
    await redis(['SET', 'mvp:init', '1']);
  }
  for (const w of [...log.items].reverse()) {
    const st = w.standings.find(s => s.clan.tag.toUpperCase() === TAG);
    const ps = (st && st.clan.participants) || [];
    const max = Math.max(0, ...ps.map(p => p.fame));
    const tags = max > 0 ? ps.filter(p => p.fame === max).map(p => p.tag.toUpperCase()) : [];
    if (tags.length) await redis(['EVAL', COUNT_WAR, '2', 'mvp:seen', 'mvp:counts', w.createdDate, ...tags]);
    else await redis(['SADD', 'mvp:seen', w.createdDate]);
  }
  const flat = await redis(['HGETALL', 'mvp:counts']);
  const counts = {};
  for (let i = 0; i < flat.length; i += 2) counts[flat[i]] = Number(flat[i + 1]);
  return counts;
}

async function buildPost(log, members, counts, nick) {
  const wars = log.items.slice(0, 10); // newest first
  const w = wars[0], id = w.createdDate;
  const st = w.standings.find(s => s.clan.tag.toUpperCase() === TAG);
  const label = (n => `${n.getUTCMonth() + 1}/${n.getUTCDate()}`)(when(id));
  const roster = members.items.filter(m => !EXCLUDE.includes(m.tag.toUpperCase()));
  const nameOf = (tag, fallback) => nick[tag.toUpperCase()] || fallback;

  const players = roster.map(m => {
    const tag = m.tag.toUpperCase(), scores = [];
    let fame = 0, decks = 0;
    wars.forEach(x => {
      const s = x.standings.find(q => q.clan.tag.toUpperCase() === TAG);
      const p = s && s.clan.participants.find(q => q.tag.toUpperCase() === tag);
      if (p && p.decksUsed > 0) { scores.push(p.fame); fame += p.fame; decks += p.decksUsed; } else scores.push(null);
    });
    let streak = 0;
    for (const v of scores) { if (v != null && v >= 3000) streak++; else break; }
    return { tag, name: nameOf(tag, m.name), scores, decks, avg: decks ? fame / decks : null, streak };
  });

  const ps = (st && st.clan.participants) || [];
  const max = Math.max(0, ...ps.map(p => p.fame));
  const mvps = max > 0 ? ps.filter(p => p.fame === max).map(p => ({ tag: p.tag.toUpperCase(), name: nameOf(p.tag, p.name), fame: p.fame })) : [];
  const mvpTags = new Set(mvps.map(m => m.tag));

  // Movement compared with the previous report's top 10
  const prevId = (await redis(['ZREVRANGE', 'post:index', '0', '0']))[0];
  let prevRank = null;
  if (prevId) {
    const prev = JSON.parse(await redis(['GET', 'post:' + prevId]));
    prevRank = new Map(prev.top10.map(m => [m.tag, m.rank]));
  }
  const top10 = players.filter(p => p.avg != null).sort((a, b) => b.avg - a.avg).slice(0, 10).map((p, i) => ({
    rank: i + 1, tag: p.tag, name: p.name, avg: Math.round(p.avg), score10: Math.round(p.avg * 16),
    last: p.scores[0], streak: p.streak, mvp: mvpTags.has(p.tag),
    move: prevRank ? (prevRank.has(p.tag) ? prevRank.get(p.tag) - (i + 1) : 'new') : null
  }));
  const threeK = players.filter(p => p.scores[0] != null && p.scores[0] >= 3000)
    .sort((a, b) => b.scores[0] - a.scores[0] || a.name.localeCompare(b.name))
    .map(p => ({ tag: p.tag, name: p.name, score: p.scores[0], streak: p.streak }));

  const current = new Set(roster.map(m => m.tag.toUpperCase()));
  const board = Object.entries(counts).filter(([t]) => current.has(t.toUpperCase()))
    .map(([t, c]) => ({ tag: t.toUpperCase(), name: nameOf(t, (roster.find(m => m.tag.toUpperCase() === t.toUpperCase()) || {}).name || t), count: c }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  board.forEach(r => (r.rank = 1 + board.filter(o => o.count > r.count).length));

  return {
    id, label, date: when(id).toISOString().slice(0, 10),
    standing: st ? { rank: st.rank, fame: st.clan.fame, trophyChange: st.trophyChange, of: w.standings.length } : null,
    top10, threeK, mvps, mvpBoard: board, note: '', created: Date.now()
  };
}

module.exports = async (req, res) => {
  try {
    if (!RURL || !RTOK) throw new Error('Storage is not connected yet');

    // Leader's note: needs the ADMIN_KEY password set in Vercel.
    if (req.method === 'POST') {
      const { id, note, key } = req.body || {};
      if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) return res.status(403).json({ error: 'Wrong password' });
      const raw = await redis(['GET', 'post:' + id]);
      if (!raw) return res.status(404).json({ error: 'Report not found' });
      const post = JSON.parse(raw);
      post.note = String(note || '').slice(0, 4000);
      await redis(['SET', 'post:' + id, JSON.stringify(post)]);
      return res.status(200).json({ ok: true });
    }

    const [log, members, cfg] = await Promise.all([
      cr(`/clans/${encodeURIComponent(TAG)}/riverracelog?limit=10`),
      cr(`/clans/${encodeURIComponent(TAG)}/members`),
      fetch(`https://${req.headers.host}/mvps.json`).then(r => r.json())
    ]);
    const nick = {};
    for (const b of cfg.baseline) nick[b.tag.toUpperCase()] = b.name;
    const counts = await ensureMvp(log, cfg);

    // Create the report for the latest completed war the first time it is seen.
    if (log.items.length && !(await redis(['EXISTS', 'post:' + log.items[0].createdDate]))) {
      const post = await buildPost(log, members, counts, nick);
      const made = await redis(['SET', 'post:' + post.id, JSON.stringify(post), 'NX']);
      if (made) await redis(['ZADD', 'post:index', String(when(post.id).getTime()), post.id]);
    }

    const ids = await redis(['ZREVRANGE', 'post:index', '0', '-1']);
    const raw = ids.length ? await redis(['MGET', ...ids.map(i => 'post:' + i)]) : [];
    const posts = raw.filter(Boolean).map(s => JSON.parse(s));
    const ua = req.headers['user-agent'] || '';
    res.setHeader('Cache-Control', ua.startsWith('vercel-cron') ? 'no-store' : 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ posts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
