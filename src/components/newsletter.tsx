"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Mail } from "@/components/icons";
import { siteConfig } from "@/config/site";

export function Newsletter() {
  const [status, setStatus] = useState<"idle" | "success">("idle");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    window.location.href = `mailto:${siteConfig.email}?subject=${encodeURIComponent("Quero receber novidades do Vargen & Fé")}&body=${encodeURIComponent(`Olá! Quero receber novidades do projeto.\n\nMeu e-mail: ${email}`)}`;
    setStatus("success");
    event.currentTarget.reset();
  }
  return <section className="newsletter"><div className="container newsletter__inner"><div><span className="newsletter__icon"><Mail size={20} /></span><p className="eyebrow">Fique por perto</p><h2>Receba novos lançamentos</h2><p>Uma mensagem quando uma nova música nascer da Palavra. Sem excesso, só o essencial.</p></div><form onSubmit={submit} className="newsletter__form"><label htmlFor="newsletter-email">Seu melhor e-mail</label><div className="newsletter__input"><input id="newsletter-email" name="email" type="email" required placeholder="voce@email.com" /><button type="submit" aria-label="Abrir e-mail para assinar"><ArrowRight size={20} /></button></div><small>Seu aplicativo de e-mail será aberto para confirmar a inscrição.</small>{status === "success" && <p className="form-success" role="status">Mensagem preparada. Envie o e-mail para concluir.</p>}</form></div></section>;
}
