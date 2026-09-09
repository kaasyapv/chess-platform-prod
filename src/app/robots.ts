import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // App + API surfaces are session-gated; keep crawlers on the marketing pages
      disallow: ["/api/", "/ceo/", "/manager/", "/coach/", "/student/", "/onboarding"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
