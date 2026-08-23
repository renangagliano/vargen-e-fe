import { Breadcrumbs } from "@/components/breadcrumbs";
import { ContactForm } from "@/components/contact-form";
import { Mail } from "@/components/icons";
import { siteConfig } from "@/config/site";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata("Contato", "Entre em contato com Vargen & Fé para falar sobre o projeto, músicas e parcerias.", "/contato");

export default function ContactPage() { return <><section className="page-hero"><div className="container"><Breadcrumbs items={[{ label: "Contato" }]} /><p className="eyebrow">Vamos conversar</p><h1>A Palavra<br /><span>aproxima.</span></h1><p className="page-hero__copy">Dúvidas, convites, parcerias ou só uma mensagem: será um prazer receber você.</p></div></section><section className="page-content"><div className="container contact-grid"><div className="contact-details"><h2>Fale com a gente.</h2><p>Para assuntos do projeto, imprensa, eventos e colaborações, escreva pelo formulário ou diretamente para o nosso e-mail.</p><a className="contact-email" href={`mailto:${siteConfig.email}`}><Mail size={18} /> {siteConfig.email}</a></div><ContactForm /></div></section></>; }
