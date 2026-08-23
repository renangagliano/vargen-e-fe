import Image from "next/image";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Button } from "@/components/button";
import { siteConfig } from "@/config/site";
import { seasons } from "@/data/seasons";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata("Playlists", "Playlists de Vargen & Fé para acompanhar o Ano Litúrgico, momentos de oração e escuta.", "/playlists");

export default function PlaylistsPage() { return <><section className="page-hero"><div className="container"><Breadcrumbs items={[{ label: "Playlists" }]} /><p className="eyebrow">Escute em sequência</p><h1>Uma faixa<br /><span>puxa a outra.</span></h1><p className="page-hero__copy">Playlists para deixar a música acompanhar o ritmo da liturgia e da vida.</p></div></section><section className="page-content"><div className="container"><div className="playlist-list">{seasons.slice(0, 6).map((season) => <article className="playlist-item" key={season.slug}><div className="playlist-item__art"><Image src="/brand/placeholder-artwork.svg" alt="" fill sizes="130px" /></div><div><p className="eyebrow">Playlist Vargen & Fé</p><h2>{season.name}</h2><p>Canções para acompanhar o tempo de {season.name.toLocaleLowerCase("pt-BR")}.</p></div><Button href={siteConfig.youtube} variant="outline" external>Ouvir</Button></article>)}</div></div></section></>; }
