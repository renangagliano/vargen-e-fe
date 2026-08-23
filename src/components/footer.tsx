import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { Mail } from "@/components/icons";
import { SocialLinks } from "@/components/social-links";
import { siteConfig } from "@/config/site";

export function Footer() {
  return <footer className="site-footer"><div className="container"><div className="site-footer__top"><div><BrandMark /><p className="site-footer__tagline">{siteConfig.tagline}</p><SocialLinks compact /></div><div className="footer-links"><div><p className="footer-label">Explore</p><Link href="/sobre">Sobre</Link><Link href="/musicas">Músicas</Link><Link href="/ano-liturgico">Ano Litúrgico</Link><Link href="/videos">Vídeos</Link></div><div><p className="footer-label">Fale conosco</p><a href={`mailto:${siteConfig.email}`}><Mail size={15} /> {siteConfig.email}</a><Link href="/contato">Contato</Link></div></div></div><div className="site-footer__bottom"><span>© Vargen & Fé</span><div><Link href="/privacidade">Privacidade</Link><Link href="/termos">Termos</Link></div><span>Rock. Fé. Palavra.</span></div></div></footer>;
}
