import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/config/site";
import { songs } from "@/data/songs";
import { seasons } from "@/data/seasons";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap { const pages = ["", "/sobre", "/musicas", "/ano-liturgico", "/videos", "/playlists", "/blog", "/contato", "/privacidade", "/termos"]; return [...pages.map((path) => ({ url: absoluteUrl(path), lastModified: new Date(), changeFrequency: "monthly" as const, priority: path === "" ? .9 : .6 })), ...songs.map((song) => ({ url: absoluteUrl(`/musicas/${song.slug}`), lastModified: new Date(song.releaseDate), changeFrequency: "yearly" as const, priority: song.featured ? .8 : .6 })), ...seasons.map((season) => ({ url: absoluteUrl(`/ano-liturgico/${season.slug}`), lastModified: new Date(), changeFrequency: "monthly" as const, priority: .6 }))]; }
