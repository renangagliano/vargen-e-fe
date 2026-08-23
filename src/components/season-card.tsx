import Link from "next/link";
import type { Season } from "@/data/seasons";
import { ArrowUpRight } from "@/components/icons";

export function SeasonCard({ season, index = 0 }: { season: Season; index?: number }) {
  return <Link href={`/ano-liturgico/${season.slug}`} className="season-card" style={{ "--season-accent": season.accent } as React.CSSProperties}><span className="season-card__number">0{index + 1}</span><span className="season-card__symbol" aria-hidden="true">{season.symbol}</span><span className="season-card__eyebrow">{season.eyebrow}</span><h3>{season.name}</h3><span className="season-card__arrow"><ArrowUpRight size={16} /></span></Link>;
}
