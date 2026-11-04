// Vercel serverless function: card names, elixir costs and icons from the official API.
const BASE = 'https://proxy.royaleapi.dev/v1';
module.exports = async (req, res) => {
  try {
    const r = await fetch(BASE + '/cards', { headers: { Authorization: 'Bearer ' + process.env.CR_API_KEY } });
    if (!r.ok) throw new Error('Clash Royale API ' + r.status);
    const d = await r.json();
    const cards = {};
    for (const c of d.items) {
      cards[c.id] = { n: c.name, e: c.elixirCost ?? null, i: c.iconUrls.medium, ev: c.iconUrls.evolutionMedium || null, h: c.iconUrls.heroMedium || null };
    }
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json(cards);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
