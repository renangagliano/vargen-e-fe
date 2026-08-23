import { Play } from "@/components/icons";

export function VideoCard({ title, label, href }: { title: string; label: string; href: string }) {
  return <a className="video-card" href={href} target="_blank" rel="noreferrer"><div className="video-card__visual"><span className="video-card__play"><Play size={19} /></span><span className="video-card__mark">V&F</span></div><div className="video-card__info"><span>{label}</span><h3>{title}</h3><span className="video-card__watch">Assistir ↗</span></div></a>;
}
