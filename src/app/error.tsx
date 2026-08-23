"use client";

import { useEffect } from "react";
import { Button } from "@/components/button";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) { useEffect(() => { console.error(error); }, [error]); return <section className="status-page"><div className="container"><p className="eyebrow">Algo saiu do ritmo</p><h1>Vamos<br />tentar de novo.</h1><p>Ocorreu um erro inesperado. Recarregue esta página ou volte ao início.</p><div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}><button className="button button--outline" type="button" onClick={() => reset()}>Tentar novamente</button><Button href="/">Voltar ao início</Button></div></div></section>; }
