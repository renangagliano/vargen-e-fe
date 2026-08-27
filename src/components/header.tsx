"use client";

import Link from "next/link";
import { useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { Close, Menu } from "@/components/icons";
import { siteConfig } from "@/config/site";

const links = [
  { href: "/musicas", label: "Músicas" },
  { href: "/ano-liturgico", label: "Ano Litúrgico" },
  { href: "/videos", label: "Vídeos" },
  { href: "/sobre", label: "Sobre" },
  { href: "/contato", label: "Contato" },
];

export function Header() {
  const [open, setOpen] = useState(false);
  return <header className="site-header"><div className="container site-header__inner"><BrandMark /><nav className="desktop-nav" aria-label="Navegação principal">{links.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}</nav><a className="header-youtube" href={siteConfig.youtube} target="_blank" rel="noreferrer"><span>Canal</span> YouTube</a><a className="header-admin-link" href={siteConfig.adminUrl} aria-label="Login administrativo">◌</a><button className="menu-toggle" type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="mobile-navigation" aria-label={open ? "Fechar menu" : "Abrir menu"}>{open ? <Close /> : <Menu />}</button></div>{open && <nav id="mobile-navigation" className="mobile-nav" aria-label="Navegação móvel">{links.map((link) => <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>{link.label}</Link>)}<a href={siteConfig.adminUrl} onClick={() => setOpen(false)}>Login administrativo <span>↗</span></a><a href={siteConfig.youtube} target="_blank" rel="noreferrer">YouTube <span>↗</span></a></nav>}</header>;
}
