import Image from "next/image";
import Link from "next/link";
import { Hero } from "@/components/hero";
import { Button } from "@/components/button";
import { SectionHeading } from "@/components/section-heading";
import { SeasonCard } from "@/components/season-card";
import { MusicCard } from "@/components/music-card";
import { VideoCard } from "@/components/video-card";
import { Newsletter } from "@/components/newsletter";
import { CtaSection } from "@/components/cta-section";
import { JsonLd } from "@/components/json-ld";
import { featuredSong, songs } from "@/data/songs";
import { seasons } from "@/data/seasons";
import { siteConfig, absoluteUrl } from "@/config/site";

export default function Home() {
  const videos = [
    { title: featuredSong.title, label: "Lançamento em destaque", href: featuredSong.youtubeUrl },
    { title: "Acompanhe a jornada pelo Ano Litúrgico", label: "Playlist Vargen & Fé", href: siteConfig.youtube },
    { title: "Inscreva-se e caminhe conosco", label: "Canal oficial", href: siteConfig.youtube },
  ];
  const recording = { "@context": "https://schema.org", "@type": "MusicRecording", name: featuredSong.title, byArtist: { "@type": "MusicGroup", name: siteConfig.shortName }, inLanguage: "pt-BR", url: absoluteUrl(`/musicas/${featuredSong.slug}`), datePublished: featuredSong.releaseDate, genre: "Música católica / Classic Rock" };
  return <><Hero /><section className="section"><div className="container feature-grid"><div className="feature-art"><Image src={featuredSong.thumbnail} alt={`Arte de ${featuredSong.title}`} fill priority sizes="(max-width: 920px) 100vw, 52vw" /><div className="feature-art__overlay" /><div className="feature-art__label"><small>Faixa em destaque</small>{featuredSong.title}</div></div><div className="feature-info"><p className="eyebrow">Agora em escuta</p><h2>{featuredSong.title}</h2><p>{featuredSong.description}</p><div className="feature-info__refs">{featuredSong.scripture.map((ref) => <span key={ref}>{ref}</span>)}</div><div className="feature-info__actions" style={{ marginTop: 30 }}><Button href={`/musicas/${featuredSong.slug}`}>Conheça a faixa</Button><Button href={featuredSong.youtubeUrl} variant="text" external>Ouvir no YouTube</Button></div></div></div></section><section className="section section--tight journey"><div className="container"><div className="journey__header"><SectionHeading eyebrow="Um ano em canções" title="A jornada litúrgica" >Músicas para acompanhar o tempo da Igreja — da espera do Advento à alegria da Páscoa.</SectionHeading><Button href="/ano-liturgico" variant="outline">Explorar o ano</Button></div><div className="season-grid">{seasons.map((season, index) => <SeasonCard key={season.slug} season={season} index={index} />)}</div></div></section><section className="section"><div className="container"><div className="catalog-header"><SectionHeading eyebrow="Catálogo" title="Músicas para caminhar" >Cada faixa nasce de uma celebração, uma leitura, uma pergunta.</SectionHeading><Link className="catalog-header__link" href="/musicas">Ver todo o catálogo ↗</Link></div><div className="music-grid">{songs.slice(0, 6).map((song) => <MusicCard key={song.slug} song={song} />)}</div></div></section><section className="section section--dark"><div className="container story-grid"><div className="story-pull">Cada música<br />nasce da<br /><em>Palavra.</em></div><div className="story-copy"><p>Vargen & Fé transforma a Escritura e a liturgia em canções para ouvir, contemplar e levar para a vida real.</p><p>O projeto percorre o <strong>Ano Litúrgico</strong> com a linguagem do Classic Rock e do Melodic Rock, criando pontes entre o Evangelho de domingo e o cotidiano de quem escuta.</p><p>Vargen & Fé é um projeto musical criado por <strong>Renan Gagliano</strong>. A marca permanece no centro: uma jornada de fé, música e Palavra.</p><Button href="/sobre" variant="text">Conheça o projeto</Button></div></div></section><section className="section"><div className="container"><SectionHeading eyebrow="No YouTube" title="Assista. Escute. Compartilhe." >Vídeos, lançamentos e canções para acompanhar a caminhada.</SectionHeading><div className="video-strip">{videos.map((video) => <VideoCard key={video.title} {...video} />)}</div><div style={{ textAlign: "center", marginTop: 38 }}><Button href={siteConfig.youtube} variant="outline" external>Inscreva-se no canal</Button></div></div></section><Newsletter /><CtaSection title="Domingo após domingo, caminhe conosco pelas Escrituras." copy="Encontre uma música para o tempo que você está vivendo e deixe a Palavra ganhar novos contornos." /><JsonLd data={recording} /></>;
}
