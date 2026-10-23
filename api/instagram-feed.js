const BASE_URL = "https://www.socialcrawl.dev";

// Change these paths if SocialCrawl's docs show different endpoints.
const POSTS_PATH =
  process.env.SOCIALCRAWL_POSTS_PATH || "/v1/instagram/profile/posts";
const REELS_PATH =
  process.env.SOCIALCRAWL_REELS_PATH || "/v1/instagram/profile/reels";

function pickArray(result) {
  if (Array.isArray(result)) return result;
  const candidates = [
    result?.data,
    result?.data?.items,
    result?.data?.posts,
    result?.data?.reels,
    result?.items,
    result?.posts,
    result?.reels,
    result?.results
  ];
  return candidates.find(Array.isArray) || [];
}

function firstString(...values) {
  return values.find((v) => typeof v === "string" && v.length > 0) || "";
}

function normalize(rawItem, forcedType) {
  const post = rawItem?.post || rawItem?.node || rawItem;
  if (!post || typeof post !== "object") return null;

  const shortcode = firstString(post.shortcode, post.code);

  let url = firstString(
    post.url,
    post.permalink,
    post.post_url,
    post.link,
    post.shortcode_url
  );

  const videoUrl = firstString(
    post.video_url,
    post.video?.url,
    post.video_versions?.[0]?.url,
    post.ext?.video_url
  );

  const isReel =
    forcedType === "reel" ||
    post.product_type === "clips" ||
    post.media_type === "REEL" ||
    /\/reels?\//.test(url);

  if (!url && shortcode) {
    url = `https://www.instagram.com/${isReel ? "reel" : "p"}/${shortcode}/`;
  }

  const thumbnail = firstString(
    post.thumbnail_url,
    post.image_url,
    post.display_url,
    post.thumbnail,
    post.cover_url,
    post.image,
    post.media_url,
    post.image_versions2?.candidates?.[0]?.url,
    post.ext?.image_url
  );

  if (!url || !thumbnail) return null;

  const isVideo = isReel || post.is_video === true || Boolean(videoUrl);

  const timestamp =
    post.taken_at_timestamp ||
    post.taken_at ||
    post.timestamp ||
    post.created_at ||
    0;

  return {
    id: String(post.id || shortcode || url),
    type: isReel ? "reel" : isVideo ? "video" : "post",
    url,
    thumbnail,
    videoUrl,
    caption: firstString(
      post.caption,
      post.caption?.text,
      post.text,
      post.description
    ).slice(0, 200),
    timestamp: Number(new Date(timestamp)) || Number(timestamp) || 0
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

  const debug = req.query?.debug === "1";

  try {
    const [postsResult, reelsResult] = await Promise.allSettled([
      fetchList(POSTS_PATH, apiKey, handle),
      fetchList(REELS_PATH, apiKey, handle)
    ]);

    const posts = postsResult.status === "fulfilled" ? postsResult.value : null;
    const reels = reelsResult.status === "fulfilled" ? reelsResult.value : null;

    if (debug) {
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

    // Remove duplicates, then sort newest first.
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