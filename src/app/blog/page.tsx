import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { SectionHeading } from "@/components/section-heading";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata("Blog", "Reflexões e bastidores sobre música católica, Escritura e Ano Litúrgico.", "/blog");

export default function BlogPage() { return <><section className="page-hero"><div className="container"><Breadcrumbs items={[{ label: "Blog" }]} /><p className="eyebrow">Palavra para ler</p><h1>Em breve,<br /><span>novas histórias.</span></h1><p className="page-hero__copy">Um espaço para reflexões, bastidores e conversas sobre a música que nasce da liturgia.</p></div></section><section className="page-content"><div className="container"><div className="simple-card"><SectionHeading eyebrow="Editorial" title="Estamos preparando o próximo capítulo" >Enquanto isso, conheça as músicas e percorra o Ano Litúrgico em canções.</SectionHeading><Link className="button button--gold" href="/musicas" style={{ marginTop: 30 }}>Explorar músicas <span className="button__icon">↗</span></Link></div></div></section></>; }
