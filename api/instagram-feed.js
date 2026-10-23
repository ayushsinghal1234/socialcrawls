
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.SOCIALCRAWL_API_KEY;
  const handle = process.env.INSTAGRAM_HANDLE;

  if (!apiKey || !handle) {
    return res.status(500).json({
      error: "Missing environment variables",
      hasApiKey: Boolean(apiKey),
      hasInstagramHandle: Boolean(handle)
    });
  }

  try {
    const url = new URL(
      "https://www.socialcrawl.dev/v1/instagram/profile/posts"
    );
    url.searchParams.set("handle", handle);

    const upstream = await fetch(url, {
      headers: { "x-api-key": apiKey }
    });

    const body = await upstream.text();

    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return res.status(502).json({
        error: "Socialcrawl returned non-JSON data",
        upstreamStatus: upstream.status
      });
    }

    if (!upstream.ok) {
      return res.status(502).json({
        error: "Socialcrawl API request failed",
        upstreamStatus: upstream.status,
        details: data
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error("Instagram feed error:", error);
    return res.status(502).json({
      error: "Backend request failed"
    });
  }
}
