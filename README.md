# Bean Cans war dashboard — setup (~10 min, free)

1. **API key**: go to https://developer.clashroyale.com → create account → My Account → Create New Key.
   - Key name: anything. Allowed IP: `45.79.218.79` (RoyaleAPI proxy). Copy the key.
2. **GitHub**: create a free repo and upload everything in this folder (keep the `api/` and `public/` folders).
3. **Vercel**: sign up free at vercel.com with GitHub → Add New Project → import the repo → before deploying, open
   Environment Variables and add:
   - `CR_API_KEY` = your key
   - `CLAN_TAG` = `#LQ89GYVG` (optional, already the default)
   - `EXCLUDE` = comma-separated player tags to hide (optional)
4. Click Deploy. You get a link like `bean-cans.vercel.app` — post it in Discord.

Updates are automatic: the page pulls fresh data (cached up to 15 min). Players who leave the clan disappear on their own.
