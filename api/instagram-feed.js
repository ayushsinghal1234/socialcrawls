const BASE_URL = "https://www.socialcrawl.dev";

const POSTS_PATH =
  process.env.SOCIALCRAWL_POSTS_PATH || "/v1/instagram/profile/posts";

// Optional. Only set this env var if SocialCrawl has a separate reels endpoint.
const REELS_PATH = process.env.SOCIALCRAWL_REELS_PATH || "";

function pickArray(result) {
  if (Array.isArray(result)) return result;
  const candidates = [
    result?.data?.items,
    result?.data?.posts,
    result?.data,
    result?.items,
    result?.posts
  ];
  return candidates.find(Array.isArray) || [];
}

function firstString(...values) {
  const found = values.find((v) => typeof v === "string" && v.length > 0);
  return found || "";
}

function normalize(rawItem, forcedType) {
  const post = rawItem?.post || rawItem;
  if (!post || typeof post !== "object") return null;

  const content = post.content || {};
  const mediaUrl = Array.isArray(content.media_urls)
    ? firstString(...content.media_urls)
    : firstString(content.media_urls);

  const mediaType = String(post.ext?.media_type || "").toLowerCase();
  const isVideo =
    mediaType === "video" ||
    /\.mp4(\?|$)/i.test(mediaUrl) ||
    forcedType === "reel";

  const videoUrl = isVideo ? mediaUrl : "";

  const thumbnail = isVideo
    ? firstString(content.thumbnail_url)
    : firstString(content.thumbnail_url, mediaUrl);

  const url = firstString(post.url);

  if (!url || !thumbnail) return null;

  
return {
  id: String(post.id || url),
  type: isVideo ? "reel" : "post",
  url,
  thumbnail,
  videoUrl,
  caption: firstString(content.text).slice(0, 200),
  author: firstString(post.author?.username),
  name: firstString(
    post.author?.display_name,
    post.author?.username
  ),
  avatar: firstString(post.author?.avatar_url),
  likes: Number(post.engagement?.likes) || 0,
  comments: Number(post.engagement?.comments) || 0,
  timestamp: Number(new Date(post.published_at)) || 0
};

}

async function fetchList(path, apiKey, handle) {
  const url = new URL(path, BASE_URL);
  url.searchParams.set("handle", handle);

  const upstream = await fetch(url, { headers: { "x-api-key": apiKey } });
  const text = await upstream.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, status: upstream.status, error: "Non-JSON response" };
  }

  return { ok: upstream.ok, status: upstream.status, json };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.SOCIALCRAWL_API_KEY;
  const handle = process.env.INSTAGRAM_HANDLE;

  if (!apiKey || !handle) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({
      error: "Missing environment variables",
      hasApiKey: Boolean(apiKey),
      hasInstagramHandle: Boolean(handle)
    });
  }

  try {
    const [postsResult, reelsResult] = await Promise.allSettled([
      fetchList(POSTS_PATH, apiKey, handle),
      REELS_PATH ? fetchList(REELS_PATH, apiKey, handle) : Promise.resolve(null)
    ]);

    const posts = postsResult.status === "fulfilled" ? postsResult.value : null;
    const reels = reelsResult.status === "fulfilled" ? reelsResult.value : null;

    // Raw response for troubleshooting: /api/instagram-feed?debug=1
    if (req.query?.debug === "1") {
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({
        postsStatus: posts?.status,
        reelsStatus: reels?.status,
        postsRaw: posts?.json,
        reelsRaw: reels?.json
      });
    }

    if (!posts?.ok && !reels?.ok) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(502).json({
        error: "SocialCrawl request failed",
        postsStatus: posts?.status,
        reelsStatus: reels?.status
      });
    }

    const items = [
      ...(posts?.ok ? pickArray(posts.json) : []).map((i) => normalize(i)),
      ...(reels?.ok ? pickArray(reels.json) : []).map((i) =>
        normalize(i, "reel")
      )
    ].filter(Boolean);

    const seen = new Set();
    const unique = items.filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });

    unique.sort((a, b) => b.timestamp - a.timestamp);

    res.setHeader(
      "Cache-Control",
      "s-maxage=1800, stale-while-revalidate=3600"
    );
    return res.status(200).json({ items: unique });
  } catch (error) {
    console.error("Instagram feed error:", error);
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ error: "Backend request failed" });
  }
}