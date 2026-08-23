import { Breadcrumbs } from "@/components/breadcrumbs";
import { Button } from "@/components/button";
import { VideoCard } from "@/components/video-card";
import { SectionHeading } from "@/components/section-heading";
import { siteConfig } from "@/config/site";
import { featuredSong } from "@/data/songs";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata("Vídeos", "Assista aos lançamentos e vídeos de Vargen & Fé no YouTube.", "/videos");

export default function VideosPage() { const videos = [{ title: featuredSong.title, label: "Lançamento em destaque", href: featuredSong.youtubeUrl }, { title: "Acompanhe a jornada pelo Ano Litúrgico", label: "Playlist oficial", href: siteConfig.youtube }, { title: "Canções para a sua caminhada", label: "No canal Vargen & Fé", href: siteConfig.youtube }]; return <><section className="page-hero"><div className="container"><Breadcrumbs items={[{ label: "Vídeos" }]} /><p className="eyebrow">Canal oficial</p><h1>Som e imagem<br /><span>em movimento.</span></h1><p className="page-hero__copy">Lançamentos, versões e encontros com a Palavra no canal @vargenefe.</p></div></section><section className="page-content"><div className="container"><SectionHeading eyebrow="Assista" title="Vídeos para ouvir com os olhos" >O canal é parte da jornada: um espaço para lançar, compartilhar e conversar.</SectionHeading><div className="video-list" style={{ marginTop: 45 }}>{videos.map((video) => <VideoCard key={video.title} {...video} />)}</div><div style={{ marginTop: 40 }}><Button href={siteConfig.youtube} external>Visitar o canal</Button></div></div></section></>; }
