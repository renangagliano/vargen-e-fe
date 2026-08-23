import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { MusicCard } from "@/components/music-card";
import { Button } from "@/components/button";
import { getSeason, seasons } from "@/data/seasons";
import { getSongsBySeason } from "@/data/songs";
import { createMetadata } from "@/lib/metadata";

export async function generateStaticParams() { return seasons.map((season) => ({ season: season.slug })); }
export async function generateMetadata({ params }: { params: Promise<{ season: string }> }) { const { season: slug } = await params; const season = getSeason(slug); return season ? createMetadata(`${season.name} — Ano Litúrgico`, `${season.description} Conheça as músicas de Vargen & Fé para ${season.name}.`, `/ano-liturgico/${slug}`) : {}; }

export default async function SeasonPage({ params }: { params: Promise<{ season: string }> }) { const { season: slug } = await params; const season = getSeason(slug); if (!season) notFound(); const seasonSongs = getSongsBySeason(slug); return <><section className="page-content"><div className="container"><Breadcrumbs items={[{ label: "Ano Litúrgico", href: "/ano-liturgico" }, { label: season.name }]} /><div className="season-detail"><aside className="season-detail__aside"><span className="season-detail__aside-symbol" aria-hidden="true">{season.symbol}</span><p className="eyebrow">{season.eyebrow}</p><h1>{season.name}</h1><p>{season.description}</p><Button href="/musicas" variant="text">Ver todo o catálogo</Button></aside><div className="season-detail__songs"><p>{seasonSongs.length ? `${seasonSongs.length} ${seasonSongs.length === 1 ? "música" : "músicas"} para este tempo litúrgico.` : "Novas músicas para este tempo estão a caminho."}</p>{seasonSongs.length ? <div className="music-grid">{seasonSongs.map((song) => <MusicCard key={song.slug} song={song} />)}</div> : <div className="catalog-empty">Enquanto novas canções são preparadas, explore os outros tempos do Ano Litúrgico.</div>}</div></div></div></section></>; }
