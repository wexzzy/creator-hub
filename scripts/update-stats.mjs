// Обновляет stats.json данными из YouTube, Instagram и TikTok.
// Запуск: node scripts/update-stats.mjs   (нужен Node 20+, без зависимостей)
// Если платформа не настроена или API вернул ошибку, остаётся её прошлое значение.

import { readFile, writeFile } from "node:fs/promises";

const FILE = new URL("../stats.json", import.meta.url);
const env = process.env;
const prev = JSON.parse(await readFile(FILE, "utf8").catch(() => "{}"));
prev.platforms ??= {};
prev.history ??= [];

async function getJson(url, init) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

const fetchers = {
  // YouTube Data API v3. Нужны YT_API_KEY и YT_CHANNEL_ID (начинается с UC...)
  async youtube() {
    if (!env.YT_API_KEY || !env.YT_CHANNEL_ID) return null;
    const url = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${env.YT_CHANNEL_ID}&key=${env.YT_API_KEY}`;
    const s = (await getJson(url)).items?.[0]?.statistics;
    if (!s) throw new Error("канал не найден");
    return { followers: +s.subscriberCount, posts: +s.videoCount, views: +s.viewCount };
  },

  // Instagram API with Instagram Login. Нужен только IG_ACCESS_TOKEN
  // (токен из App Dashboard, живёт 60 дней; аккаунт Business или Creator)
  async instagram() {
    if (!env.IG_ACCESS_TOKEN) return null;
    const url = `https://graph.instagram.com/v21.0/me?fields=followers_count,media_count&access_token=${env.IG_ACCESS_TOKEN}`;
    const s = await getJson(url);
    return { followers: s.followers_count, posts: s.media_count };
  },

  // TikTok API. Нужны TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REFRESH_TOKEN
  // (приложение с доступом к user.info.stats)
  async tiktok() {
    if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET || !env.TIKTOK_REFRESH_TOKEN) return null;
    const tok = await getJson("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: env.TIKTOK_CLIENT_KEY,
        client_secret: env.TIKTOK_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: env.TIKTOK_REFRESH_TOKEN,
      }),
    });
    if (tok.refresh_token && tok.refresh_token !== env.TIKTOK_REFRESH_TOKEN) {
      console.warn("TikTok выдал новый refresh_token. Обновите секрет TIKTOK_REFRESH_TOKEN.");
    }
    const info = await getJson(
      "https://open.tiktokapis.com/v2/user/info/?fields=follower_count,video_count",
      { headers: { Authorization: `Bearer ${tok.access_token}` } }
    );
    const u = info.data?.user;
    if (!u) throw new Error("нет данных пользователя");
    return { followers: u.follower_count, posts: u.video_count };
  },
};

const platforms = { ...prev.platforms };
let okCount = 0;
for (const [name, run] of Object.entries(fetchers)) {
  try {
    const res = await run();
    if (res) { platforms[name] = { ...platforms[name], ...res }; okCount++; console.log(`✓ ${name}`, res); }
    else console.log(`- ${name}: не настроено, пропускаю`);
  } catch (e) {
    console.warn(`✗ ${name}: ${e.message}. Оставляю прошлое значение.`);
  }
}

const today = new Date().toISOString().slice(0, 10);
const point = { date: today };
for (const k of Object.keys(platforms)) point[k] = platforms[k].followers;
const history = prev.history.filter((h) => h.date !== today).concat(point).slice(-26);

await writeFile(FILE, JSON.stringify({ updated: new Date().toISOString(), platforms, history }, null, 2) + "\n");
if (okCount === 0) { console.error("Ни одна платформа не обновилась."); process.exitCode = 1; }
