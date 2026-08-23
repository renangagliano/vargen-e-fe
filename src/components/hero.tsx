import Image from "next/image";
import { Button } from "@/components/button";
import { Badge } from "@/components/badge";
import { Play } from "@/components/icons";
import { siteConfig } from "@/config/site";

export function Hero() {
  return <section className="hero"><div className="hero__halo" aria-hidden="true" /><div className="hero__grain" aria-hidden="true" /><div className="hero__brand-art" aria-hidden="true"><Image src="/brand/logo-mark.png" alt="" fill sizes="(max-width: 700px) 48vw, 380px" priority /></div><div className="container hero__content"><Badge>Projeto de música católica</Badge><h1>Vargen <span>&</span> Fé</h1><p className="hero__kicker">Música Católica</p><p className="hero__tagline">{siteConfig.tagline}</p><p className="hero__description">Uma jornada musical pelas Escrituras e pelo Ano Litúrgico da Igreja Católica, unindo a força do rock à profundidade da fé.</p><div className="hero__actions"><Button href="/musicas">Ouça as músicas</Button><Button href={siteConfig.youtube} variant="outline" external><Play size={15} /> Inscreva-se no YouTube</Button></div><div className="hero__meta"><span>Classic rock</span><i /> <span>Palavra & liturgia</span><i /> <span>Desde 2024</span></div></div><div className="hero__cross" aria-hidden="true">†</div><div className="hero__caption" aria-hidden="true">PALAVRA<br /><span>EM MOVIMENTO</span></div></section>;
}
