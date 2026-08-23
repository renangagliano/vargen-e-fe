import { Breadcrumbs } from "@/components/breadcrumbs";
import { SeasonCard } from "@/components/season-card";
import { SectionHeading } from "@/components/section-heading";
import { CtaSection } from "@/components/cta-section";
import { seasons } from "@/data/seasons";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata("Ano Litúrgico", "Percorra os tempos e celebrações do Ano Litúrgico através das músicas de Vargen & Fé.", "/ano-liturgico");

export default function LiturgicalYearPage() { return <><section className="page-hero"><div className="container"><Breadcrumbs items={[{ label: "Ano Litúrgico" }]} /><p className="eyebrow">A liturgia em movimento</p><h1>Uma jornada<br /><span>em canções.</span></h1><p className="page-hero__copy">O Ano Litúrgico organiza o tempo da Igreja. Aqui, ele ganha uma trilha sonora para acompanhar cada passo.</p></div></section><section className="section"><div className="container"><SectionHeading eyebrow="Escolha um tempo" title="Caminhe pela liturgia" >Encontre músicas inspiradas nas leituras, festas e mistérios celebrados ao longo do ano.</SectionHeading><div className="season-grid" style={{ marginTop: 48 }}>{seasons.map((season, index) => <SeasonCard key={season.slug} season={season} index={index} />)}</div></div></section><CtaSection title="Cada domingo tem uma história." copy="Conheça o catálogo completo e filtre as músicas pelo tempo litúrgico que você procura." /></>; }
