export type Season = {
  slug: string;
  name: string;
  shortName: string;
  eyebrow: string;
  description: string;
  accent: string;
  symbol: string;
};

export const seasons: Season[] = [
  { slug: "12-meses", name: "12 Meses com Deus", shortName: "12 Meses", eyebrow: "Atravessar", description: "Uma canção para cada mês, guardando gratidão, esperança e oração ao longo do ano.", accent: "#8d6a3d", symbol: "◐" },
  { slug: "7-dias", name: "7 Dias com Deus", shortName: "7 Dias", eyebrow: "Superar", description: "Uma sequência de músicas para caminhar com fé, força e superação durante a semana.", accent: "#a47c3d", symbol: "✦" },
  { slug: "advento", name: "Advento", shortName: "Advento", eyebrow: "Esperar", description: "A esperança acende uma luz no escuro e prepara o coração para a chegada do Salvador.", accent: "#7c5b36", symbol: "✦" },
  { slug: "natal", name: "Natal", shortName: "Natal", eyebrow: "Nascer", description: "A Palavra se faz carne: o mistério de Deus que escolhe habitar entre nós.", accent: "#b28b44", symbol: "✧" },
  { slug: "tempo-comum", name: "Tempo Comum", shortName: "Tempo Comum", eyebrow: "Caminhar", description: "A fé vivida no cotidiano, com os olhos atentos aos gestos e às palavras de Jesus.", accent: "#63705c", symbol: "◌" },
  { slug: "quaresma", name: "Quaresma", shortName: "Quaresma", eyebrow: "Retornar", description: "Um caminho de silêncio, conversão e confiança que conduz ao coração da Páscoa.", accent: "#51465e", symbol: "◒" },
  { slug: "semana-santa", name: "Semana Santa", shortName: "Semana Santa", eyebrow: "Entregar", description: "A paixão de Cristo contemplada com reverência, presença e esperança.", accent: "#4c3f48", symbol: "†" },
  { slug: "pascoa", name: "Páscoa", shortName: "Páscoa", eyebrow: "Renascer", description: "A noite se abre em luz. A ressurreição é o centro vivo da nossa esperança.", accent: "#b99c63", symbol: "☼" },
  { slug: "tempo-pascal", name: "Tempo Pascal", shortName: "Tempo Pascal", eyebrow: "Viver", description: "A alegria do Ressuscitado continua pulsando na comunidade e no mundo.", accent: "#8d7b4d", symbol: "◉" },
  { slug: "pentecostes", name: "Pentecostes", shortName: "Pentecostes", eyebrow: "Respirar", description: "O sopro do Espírito reúne, envia e transforma a vida em testemunho.", accent: "#a95e36", symbol: "≋" },
  { slug: "solenidades", name: "Solenidades", shortName: "Solenidades", eyebrow: "Celebrar", description: "Grandes festas da fé, da Virgem Maria e dos santos que caminham conosco.", accent: "#8b713a", symbol: "✚" },
  { slug: "anunciacao", name: "Anunciação", shortName: "Anunciação", eyebrow: "Dizer sim", description: "O mistério da encarnação contemplado através da presença, do sim e da vida em família.", accent: "#8c6d54", symbol: "✧" },
];

export function getSeason(slug: string) {
  return seasons.find((season) => season.slug === slug);
}
