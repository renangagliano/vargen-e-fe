import Link from "next/link";
import Image from "next/image";
import type { Song } from "@/data/songs";
import { Badge } from "@/components/badge";
import { ArrowUpRight, Play } from "@/components/icons";
import { getSeason } from "@/data/seasons";

export function MusicCard({ song }: { song: Song }) {
  const season = getSeason(song.liturgicalSeason);
  return <article className="music-card"><Link href={`/musicas/${song.slug}`} className="music-card__art"><Image src={song.thumbnail} alt={`Capa da música ${song.title}`} fill sizes="(max-width: 700px) 88vw, (max-width: 1100px) 42vw, 280px" /><span className="music-card__play"><Play size={17} /></span></Link><div className="music-card__body"><div className="music-card__topline"><Badge>{season?.shortName}</Badge><span className="music-card__year">Ano {song.liturgicalYear}</span></div><h3><Link href={`/musicas/${song.slug}`}>{song.title}</Link></h3><p>{song.celebration}</p><div className="music-card__footer"><span>{song.scripture[0] ?? "Escuta disponível no site"}</span>{song.videoId ? <a href={song.youtubeUrl} target="_blank" rel="noreferrer" aria-label={`Assistir ${song.title} no YouTube`}><Play size={13} /> YouTube</a> : <span className="music-card__site-audio">Áudio no site</span>}<Link href={`/musicas/${song.slug}`} aria-label={`Abrir ${song.title}`}><ArrowUpRight size={16} /></Link></div></div></article>;
}
