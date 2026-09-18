import type { MetadataRoute } from "next";

/** The whole portal sits behind a sign-in, so nothing here belongs in a search index. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
