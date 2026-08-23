import type { Metadata } from "next";
import { absoluteUrl, siteConfig } from "@/config/site";

export function createMetadata(title: string, description: string, path = ""): Metadata {
  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(path) },
    openGraph: { title, description, url: absoluteUrl(path), siteName: siteConfig.shortName, locale: "pt_BR", type: "website", images: [{ url: absoluteUrl("/brand/og-default.svg"), width: 1200, height: 630, alt: siteConfig.siteName }] },
    twitter: { card: "summary_large_image", title, description, images: [absoluteUrl("/brand/og-default.svg")] },
  };
}
