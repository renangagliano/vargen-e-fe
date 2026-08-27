export const siteConfig = {
  siteName: "Vargen & Fé | Música Católica",
  shortName: "Vargen & Fé",
  tagline: "A Bíblia transformada em música.",
  description:
    "Vargen & Fé transforma as Escrituras e a Liturgia Católica em música, unindo Classic Rock, Melodic Rock, fé e Palavra em uma jornada pelo Ano Litúrgico.",
  domain: "https://vargenefe.com.br",
  email: "contato@vargenefe.com.br",
  youtube: "https://www.youtube.com/@vargenefe",
  instagram: "https://www.instagram.com/vargen.fe/",
  tiktok: "https://www.tiktok.com/@vargen.fe",
  adminUrl: process.env.NEXT_PUBLIC_ADMIN_URL?.trim() || "/admin/login",
  spotify: null,
  appleMusic: null,
  creator: "Renan Gagliano",
  locale: "pt-BR",
} as const;

export type SocialKey = "youtube" | "instagram" | "tiktok" | "spotify" | "appleMusic";

export const socialLinks = [
  { key: "youtube" as const, label: "YouTube", href: siteConfig.youtube, icon: "youtube" },
  { key: "instagram" as const, label: "Instagram", href: siteConfig.instagram, icon: "instagram" },
  { key: "tiktok" as const, label: "TikTok", href: siteConfig.tiktok, icon: "tiktok" },
  { key: "spotify" as const, label: "Spotify", href: siteConfig.spotify, icon: "spotify" },
  { key: "appleMusic" as const, label: "Apple Music", href: siteConfig.appleMusic, icon: "apple" },
].filter((social) => social.href);

export function absoluteUrl(path = "") {
  return `${siteConfig.domain}${path}`;
}
