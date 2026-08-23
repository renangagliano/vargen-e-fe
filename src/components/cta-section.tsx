import { Button } from "@/components/button";

export function CtaSection({ eyebrow = "Caminhe conosco", title, copy, href = "/musicas", label = "Conheça as músicas" }: { eyebrow?: string; title: string; copy: string; href?: string; label?: string }) {
  return <section className="cta-section"><div className="cta-section__line" aria-hidden="true" /><div className="container cta-section__inner"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><div><p>{copy}</p><Button href={href}>{label}</Button></div></div></section>;
}
