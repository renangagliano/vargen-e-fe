import { MusicCatalog } from "@/components/music-catalog";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { createMetadata } from "@/lib/metadata";
import { songs } from "@/data/songs";

export const metadata = createMetadata("Músicas católicas", "Explore o catálogo de músicas católicas de Vargen & Fé por tempo litúrgico, ano, celebração e referência bíblica.", "/musicas");

export default function MusicPage() { return <><section className="page-hero"><div className="container"><Breadcrumbs items={[{ label: "Músicas" }]} /><p className="eyebrow">Catálogo Vargen & Fé</p><h1>Canções para<br /><span>cada tempo.</span></h1><p className="page-hero__copy">Uma coleção em construção, nascida do Evangelho de domingo e das celebrações que marcam a caminhada da Igreja.</p></div></section><section className="page-content"><div className="container"><MusicCatalog songs={songs} /></div></section></>; }
