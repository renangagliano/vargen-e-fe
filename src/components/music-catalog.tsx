"use client";

import { useMemo, useState } from "react";
import type { Song } from "@/data/songs";
import { MusicCard } from "@/components/music-card";
import { seasons } from "@/data/seasons";
import { Search } from "@/components/icons";

export function MusicCatalog({ songs }: { songs: Song[] }) {
  const [query, setQuery] = useState("");
  const [season, setSeason] = useState("all");
  const [year, setYear] = useState("all");
  const [celebration, setCelebration] = useState("all");
  const celebrations = useMemo(() => [...new Set(songs.map((song) => song.celebration))], [songs]);
  const filtered = useMemo(() => songs.filter((song) => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return (!normalized || `${song.title} ${song.celebration} ${song.scripture.join(" ")}`.toLocaleLowerCase("pt-BR").includes(normalized)) && (season === "all" || song.liturgicalSeason === season) && (year === "all" || song.liturgicalYear === year) && (celebration === "all" || song.celebration === celebration);
  }), [songs, query, season, year, celebration]);
  return <div><div className="filters"><label className="filter-control" style={{ display: "flex", alignItems: "center", gap: 8 }}><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar música..." aria-label="Buscar música" style={{ width: "100%", border: 0, outline: 0, color: "inherit", background: "transparent" }} /></label><select className="filter-control" value={season} onChange={(event) => setSeason(event.target.value)} aria-label="Filtrar por tempo litúrgico"><option value="all">Todos os tempos</option>{seasons.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select><select className="filter-control" value={year} onChange={(event) => setYear(event.target.value)} aria-label="Filtrar por ano litúrgico"><option value="all">Todos os anos</option>{["A", "B", "C"].map((item) => <option key={item} value={item}>Ano {item}</option>)}</select><select className="filter-control" value={celebration} onChange={(event) => setCelebration(event.target.value)} aria-label="Filtrar por celebração"><option value="all">Todas as celebrações</option>{celebrations.map((item) => <option key={item} value={item}>{item}</option>)}</select></div><p className="catalog-result-count">{filtered.length} {filtered.length === 1 ? "música encontrada" : "músicas encontradas"}</p>{filtered.length ? <div className="music-grid">{filtered.map((song) => <MusicCard key={song.slug} song={song} />)}</div> : <div className="catalog-empty">Nenhuma música corresponde aos filtros. Tente outra busca.</div>}</div>;
}
