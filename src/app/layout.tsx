import type { Metadata } from "next";
import Script from "next/script";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { JsonLd } from "@/components/json-ld";
import { siteConfig } from "@/config/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.domain),
  title: { default: siteConfig.siteName, template: `%s | ${siteConfig.shortName}` },
  description: siteConfig.description,
  applicationName: siteConfig.shortName,
  keywords: ["música católica", "rock católico", "música bíblica", "ano litúrgico", "Bíblia em música"],
  authors: [{ name: siteConfig.shortName }],
  creator: siteConfig.creator,
  alternates: { canonical: siteConfig.domain },
  icons: { icon: "/brand/logo-mark.png" },
  openGraph: { title: siteConfig.siteName, description: siteConfig.description, url: siteConfig.domain, siteName: siteConfig.shortName, locale: "pt_BR", type: "website", images: [{ url: "/brand/youtube-banner.png", width: 2048, height: 1024, alt: siteConfig.siteName }] },
  twitter: { card: "summary_large_image", title: siteConfig.siteName, description: siteConfig.description, images: ["/brand/youtube-banner.png"] },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const organization = { "@context": "https://schema.org", "@type": "MusicGroup", name: siteConfig.shortName, description: siteConfig.description, url: siteConfig.domain, genre: ["Classic Rock", "Melodic Rock", "Música Católica"], sameAs: [siteConfig.youtube] };
  const website = { "@context": "https://schema.org", "@type": "WebSite", name: siteConfig.siteName, url: siteConfig.domain, inLanguage: "pt-BR" };
  return <html lang="pt-BR"><body><Header /><main>{children}</main><Footer /><JsonLd data={organization} /><JsonLd data={website} />{process.env.NEXT_PUBLIC_GA_ID && <Script src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_ID}`} strategy="afterInteractive" />}{process.env.NEXT_PUBLIC_GA_ID && <Script id="ga4" strategy="afterInteractive">{`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)};gtag('js',new Date());gtag('config','${process.env.NEXT_PUBLIC_GA_ID}')`}</Script>}</body></html>;
}
