// Vercel serverless function: pulls war history and returns dashboard-ready JSON.
const TAG = (process.env.CLAN_TAG || '#LQ89GYVG').toUpperCase();
const EXCLUDE = (process.env.EXCLUDE || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const BASE = 'https://proxy.royaleapi.dev/v1'; // RoyaleAPI proxy (static IP 45.79.218.79)
const DECKS_PER_WAR = 16;

async function cr(path) {
  const r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + process.env.CR_API_KEY } });
  if (!r.ok) throw new Error(`Clash Royale API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
const enc = encodeURIComponent(TAG);
const rank = (arr, key) => {
  const sorted = [...arr].sort((a, b) => (b[key] ?? -1) - (a[key] ?? -1));
  sorted.forEach((p, i) => (p['rank_' + key] = i + 1));
};

module.exports = async (req, res) => {
  try {
    const [log, members, clan] = await Promise.all([
      cr(`/clans/${enc}/riverracelog?limit=10`),
      cr(`/clans/${enc}/members`),
      cr(`/clans/${enc}`)
    ]);
    const wars = log.items.slice(0, 10); // newest first = War 1
    const current = new Map(members.items.map(m => [m.tag.toUpperCase(), m.name]));
    // Only current members appear; anyone who left drops off automatically.
    const players = [...current].filter(([t]) => !EXCLUDE.includes(t)).map(([tag, name]) => {
      const scores = [];
      let fame10 = 0, decks10 = 0, fame5 = 0, decks5 = 0;
      wars.forEach((w, i) => {
        const st = w.standings.find(s => s.clan.tag.toUpperCase() === TAG);
        const p = st && st.clan.participants.find(x => x.tag.toUpperCase() === tag);
        if (p && p.decksUsed > 0) {
          scores.push(Math.round((p.fame / p.decksUsed) * DECKS_PER_WAR));
          fame10 += p.fame; decks10 += p.decksUsed;
          if (i < 5) { fame5 += p.fame; decks5 += p.decksUsed; }
        } else scores.push(null);
      });
      return {
        name, tag, wars: scores, decks: decks10,
        score10: decks10 ? Math.round((fame10 / decks10) * DECKS_PER_WAR) : null,
        score5: decks5 ? Math.round((fame5 / decks5) * DECKS_PER_WAR) : null
      };
    });
    rank(players, 'score10'); rank(players, 'score5');
    players.sort((a, b) => (b.score10 ?? -1) - (a.score10 ?? -1));
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    res.status(200).json({
      clan: { name: clan.name, tag: TAG, members: clan.members },
      warDates: wars.map(w => w.createdDate), players, updated: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
