
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.SOCIALCRAWL_API_KEY;
  const handle = process.env.INSTAGRAM_HANDLE;

  if (!apiKey || !handle) {
    return res.status(500).json({
      error: "Server configuration is missing"
    });
  }

  try {
    const endpoint = new URL(
      "https://www.socialcrawl.dev/v1/instagram/profile/posts"
    );
    endpoint.searchParams.set("handle", handle);

    const response = await fetch(endpoint, {
      headers: { "x-api-key": apiKey }
    });

    const result = await response.json();

    if (!response.ok || result.success === false) {
      return res.status(502).json({
        error: "Socialcrawl could not return Instagram posts"
      });
    }

    return res.status(200).json(result);
  } catch {
    return res.status(502).json({
      error: "Unable to load the Instagram feed"
    });
  }
}
