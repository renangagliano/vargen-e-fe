"use client";

import { FormEvent, useState } from "react";
import { siteConfig } from "@/config/site";

export function ContactForm() {
  const [status, setStatus] = useState<"idle" | "success">("idle");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const subject = String(form.get("subject") ?? "Contato pelo site").trim();
    const body = [`Nome: ${String(form.get("name") ?? "").trim()}`, `E-mail: ${String(form.get("email") ?? "").trim()}`, "", String(form.get("message") ?? "").trim()].join("\n");
    window.location.href = `mailto:${siteConfig.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setStatus("success");
    event.currentTarget.reset();
  }

  return <form className="contact-form" onSubmit={submit}><div className="form-field"><label htmlFor="name">Nome</label><input id="name" name="name" required minLength={2} autoComplete="name" /></div><div className="form-field"><label htmlFor="email">E-mail</label><input id="email" name="email" type="email" required autoComplete="email" /></div><div className="form-field"><label htmlFor="subject">Assunto</label><input id="subject" name="subject" required minLength={3} /></div><div className="form-field"><label htmlFor="message">Mensagem</label><textarea id="message" name="message" required minLength={10} rows={5} /></div><button className="button button--gold" type="submit">Abrir e-mail<span className="button__icon">↗</span></button>{status === "success" && <p className="form-success" role="status">Seu aplicativo de e-mail foi aberto. Se necessário, escreva diretamente para <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>.</p>}</form>;
}
