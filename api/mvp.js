// Permanent MVP counter. Stored in Upstash Redis (connected through Vercel Storage).
// Each completed war is counted exactly once: its top scorer(s) get +1 and the war is marked as seen.
const TAG = (process.env.CLAN_TAG || '#LQ89GYVG').toUpperCase();
const BASE = 'https://proxy.royaleapi.dev/v1';
const RURL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const RTOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

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
// Atomic: only if this war was never seen before, mark it seen and add +1 to each MVP.
const COUNT_WAR = "if redis.call('SADD',KEYS[1],ARGV[1])==1 then for i=2,#ARGV do redis.call('HINCRBY',KEYS[2],ARGV[i],1) end return 1 else return 0 end";

module.exports = async (req, res) => {
  try {
    if (!RURL || !RTOK) throw new Error('Storage is not connected yet');
    const log = await cr(`/clans/${encodeURIComponent(TAG)}/riverracelog?limit=10`);

    // One-time setup: load your current totals and mark every war already in the log as counted.
    if (!(await redis(['GET', 'mvp:init']))) {
      const cfg = await (await fetch(`https://${req.headers.host}/mvps.json`)).json();
      for (const b of cfg.baseline) await redis(['HSET', 'mvp:counts', b.tag.toUpperCase(), String(b.count)]);
      const ids = log.items.map(w => w.createdDate);
      if (ids.length) await redis(['SADD', 'mvp:seen', ...ids]);
      await redis(['SET', 'mvp:init', '1']);
    }

    // From then on: any war not seen before is counted once (oldest first).
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
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ counts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
