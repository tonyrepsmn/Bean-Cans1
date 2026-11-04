// Vercel serverless function: rebuilds each member's war decks from their recent war battles.
const TAG = (process.env.CLAN_TAG || '#LQ89GYVG').toUpperCase();
const EXCLUDE = (process.env.EXCLUDE || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const BASE = 'https://proxy.royaleapi.dev/v1';

async function cr(path) {
  const r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + process.env.CR_API_KEY } });
  if (!r.ok) throw new Error(`Clash Royale API ${r.status}`);
  return r.json();
}
async function pool(items, size, fn) {
  const out = []; let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) { const k = next++; out[k] = await fn(items[k]); }
  }));
  return out;
}
const isWar = b => {
  const t = b.type || '', gm = (b.gameMode && b.gameMode.name) || '';
  return t === 'riverRaceDuel' || t === 'riverRaceDuelColosseum' ||
    (t === 'riverRacePvP' && (b.deckSelection === 'warDeckPick' || /^CW_/.test(gm)));
};

module.exports = async (req, res) => {
  try {
    const members = await cr(`/clans/${encodeURIComponent(TAG)}/members`);
    const list = members.items.filter(m => !EXCLUDE.includes(m.tag.toUpperCase()));
    const players = await pool(list, 25, async m => {
      try {
        const log = await cr(`/players/${encodeURIComponent(m.tag)}/battlelog`);
        const seen = new Map(); let warBattles = 0;
        for (const b of log) { // newest first
          if (!isWar(b)) continue;
          const cards = (b.team && b.team[0] && b.team[0].cards) || [];
          warBattles++;
          // A duel lists 8 cards per game played, so split into decks of 8.
          for (let i = 0; i + 8 <= cards.length; i += 8) {
            const deck = cards.slice(i, i + 8);
            const key = deck.map(c => c.id).sort((a, b) => a - b).join(',');
            if (!seen.has(key)) {
              const slots = deck.map(c => (c.evolutionLevel ? 1 : 0));
              seen.set(key, { ids: deck.map(c => c.id), slots: slots.some(Boolean) ? slots : null });
            }
          }
        }
        return { name: m.name, tag: m.tag, decks: [...seen.values()].slice(0, 4), warBattles };
      } catch (e) {
        return { name: m.name, tag: m.tag, decks: [], warBattles: 0, error: true };
      }
    });
    players.sort((a, b) => a.name.localeCompare(b.name));
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.status(200).json({ players, updated: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
