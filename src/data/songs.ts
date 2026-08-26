import { siteConfig } from "@/config/site";

export type Song = {
  title: string;
  slug: string;
  liturgicalSeason: string;
  celebration: string;
  liturgicalYear: "A" | "B" | "C";
  scripture: string[];
  youtubeUrl: string;
  spotifyUrl: string | null;
  appleMusicUrl: string | null;
  audioUrl: string;
  thumbnail: string;
  description: string;
  releaseDate: string;
  featured: boolean;
  videoId?: string;
};

type TrackSeed = readonly [category: string, title: string, videoId?: string];

const tracks: TrackSeed[] = [
  ["7 Dias com Deus  Fé, Força e Superação", "Domingo - Tudo esta completo", "jgAIViHiKIc"],
  ["7 Dias com Deus  Fé, Força e Superação", "Quarta-feira - A terra voltara a florescer", "mHOnHmnuh4U"],
  ["7 Dias com Deus  Fé, Força e Superação", "Quinta-feira - Luzes para o caminho", "S6Soi3yVWAA"],
  ["7 Dias com Deus  Fé, Força e Superação", "Sabado - A sua imagem", "AqzQkdLv9sM"],
  ["7 Dias com Deus  Fé, Força e Superação", "Segunda-feira - Que haja luz", "A5edaH75D64"],
  ["7 Dias com Deus  Fé, Força e Superação", "Sexta-feira - Feitos para ir alem", "FdD7_tkgxwk"],
  ["7 Dias com Deus  Fé, Força e Superação", "Terca-feira - Entre o ceu e as aguas", "_T_g9ElI0Cg"],
  ["Advento", "Alegria que Liberta", "Cms1utfbzes"],
  ["Advento", "Vigilância", "52F3ysbRwjM"],
  ["Advento", "Voz no Deserto", "sQnp_TwuFbc"],
  ["Anunciação", "Deus Conosco", "37jILc6zKdo"],
  ["Anunciação", "Sob o Mesmo Teto — Sagrada Família", "bZUbEKCssK4"],
  ["Domingo da Páscoa", "A Minha Paz Vos Dou", "vJIad9pC9qA"],
  ["Domingo da Páscoa", "Como Eu Vos Amei", "cyDyA6thL0A"],
  ["Domingo da Páscoa", "Meu Senhor e Meu Deus", "x52OnBZQyLk"],
  ["Domingo da Páscoa", "Ninguém Vai Me Arrancar de Tuas Mãos", "EFb_oAzvu9s"],
  ["Domingo da Páscoa", "Que Todos Sejam Um", "Nn9SEZLVA3I"],
  ["Domingo da Páscoa", "Tu Me Amas", "zhIqxz6oIjo"],
  ["Domingo da Páscoa", "Viu e Acreditou", "Wa7gB0JBziA"],
  ["Domingo de Ramos e da Paixão", "Em Tuas Mãos", "sYUMYwCoBNE"],
  ["Quaresma", "Deixa-a Ainda Este Ano", "ea9ftq1765A"],
  ["Quaresma", "Escutai-O", "uh2Gg7JeM9Y"],
  ["Quaresma", "Está Escrito", "GZHJTAWtUqI"],
  ["Quaresma", "Eu Também Não Te Condeno", "r7qMWg0qesA"],
  ["Quaresma", "Quando Ainda Estava Longe", "3OQiObdPoJU"],
  ["Solenidades", "Eu Sou a Ressurreição e a Vida", "IFWujghupbA"],
  ["Solenidades", "Fazei Tudo o Que Ele Vos Disser", "3pU3ppm9OrA"],
  ["Solenidades", "Guardei a Fé", "EdYt5rUWxh0"],
  ["Solenidades", "Minha Alma Engrandece o Senhor", "Rav8VyTl1fY"],
  ["Solenidades", "Sereis Minhas Testemunhas", "0vUWZXNhJS0"],
  ["Solenidades", "Um Só Deus de Amor", "9X0szfms-2Q"],
  ["Tempo Comum", "A Melhor Parte", "mksuLEVcZU0"],
  ["Tempo Comum", "A Messe é Grande", "DmJWKRvUk2Q"],
  ["Tempo Comum", "Aumenta a Nossa Fé", "OPW_0kZ76ok"],
  ["Tempo Comum", "Basta Uma Palavra", "EMk1I5MWS5s"],
  ["Tempo Comum", "Como o Pai é Misericordioso", "DA1t8o3FCqw"],
  ["Tempo Comum", "Deus dos Vivos", "p0GeROttA1Y"],
  ["Tempo Comum", "E os Outros Nove, Onde Estão", "TI5YEwZxfuQ"],
  ["Tempo Comum", "Escolhe o Último Lugar", "-2V63hCgj2g"],
  ["Tempo Comum", "Estava Perdido e Foi Encontrado", "Og7k7csucRY"],
  ["Tempo Comum", "Hoje a Salvação Entrou Nesta Casa", "SOIjnlPmBfU"],
  ["Tempo Comum", "Jovem, Eu Te Ordeno, Levanta-te!", "Rsq7ximglpA"],
  ["Tempo Comum", "Lâmpadas Acesas", "Rhr6Cvfil1M"],
  ["Tempo Comum", "Lembra-te de Mim no Teu Reino", "ed4TwotJKNE"],
  ["Tempo Comum", "Mãos no Arado", "OkcAK4c8iOI"],
  ["Tempo Comum", "Muito Amou, Muito Foi Perdoado", "oEig_4qz0MM"],
  ["Tempo Comum", "Não Podeis Servir a Dois Senhores", "BsxkSvo6o_o"],
  ["Tempo Comum", "O Ano da Graça", "hfPDI9b5SeE"],
  ["Tempo Comum", "O Dom Maior", "JLy48y3NrO0"],
  ["Tempo Comum", "O Preço de Te Seguir", "wVEJddFJOeQ"],
  ["Tempo Comum", "O Vinho Novo", "baFFml9bRcY"],
  ["Tempo Comum", "Onde Está Tua Riqueza", "6-NwPKsNpiY"],
  ["Tempo Comum", "Pelos Frutos Conhecereis", "qNV62bz2WEY"],
  ["Tempo Comum", "Rezar Sempre, Nunca Desistir", "meGlgIsbslc"],
  ["Tempo Comum", "Senhor, Ensina-nos a Rezar", "nTvGW_661fc"],
  ["Tempo Comum", "Tem Piedade de Mim", "lUNV1ixrK6c"],
  ["Tempo Comum", "Unção e Missão", "mxLK26dHGoY"],
  ["Tempo Comum", "Vai e Faze o Mesmo", "LnevE2hgyrA"],
  ["Tempo Comum", "Vim Trazer Fogo à Terra", "v9_DsuhrQ9k"],
  ["Tempo Comum", "À Minha Porta", "VNiSeeJp3hM"],
  ["Tempo Comum", "Águas Profundas", "eBPNDTLlPs4"],
  ["Tempo Comum", "Árvore Junto às Águas", "ENPc0_AI25Y"],
  ["Tempo Comum", "É Pela Perseverança", "l_xPC_5xJBI"],
  ["Tempo Comum", "E Vós, Quem Dizeis Que Eu Sou", "SpGswtyFbvs"],
  ["Tempo do Natal", "A Estrela e o Rei", "dqQFqB-GiJU"],
  ["Tempo do Natal", "Escudo do Lar", "h2LJzIKv_ww"],
  ["Tempo do Natal", "O Céu se Abriu", "xh-CSWGVdAw"],
  ["12 Meses com Deus", "Até Aqui Nos Sustentou — Fevereiro", "M4Ac_tcy__0"],
  ["12 Meses com Deus", "Até Aqui, Deus Foi Fiel — Dezembro", "vLeZ105FrEg"],
  ["12 Meses com Deus", "Conte as Bênçãos — Novembro", "Rw4CVmVd1EU"],
  ["12 Meses com Deus", "Depois da Cruz, a Vida — Abril", "vcRijBAFLmw"],
  ["12 Meses com Deus", "Força Para Continuar — Julho", "KPU-Hg0M7TQ"],
  ["12 Meses com Deus", "Gigantes Vão Cair — Outubro", "5QkjmPcAkQw"],
  ["12 Meses com Deus", "No Meio da Tempestade — Junho", "-TQcwybhFb4"],
  ["12 Meses com Deus", "Pedras Viraram Altares — Agosto", "O345nY733J8"],
  ["12 Meses com Deus", "Quando as Águas se Abriram — Março"],
  ["12 Meses com Deus", "Tempo de Colheita — Setembro"],
  ["12 Meses com Deus", "Tudo Vem de Tuas Mãos — Maio"],
  ["12 Meses com Deus", "Um Novo Caminho — Janeiro", "grfUegGz7P0"],
];

const seasonByCategory: Record<string, string> = {
  "7 Dias com Deus  Fé, Força e Superação": "7-dias",
  Advento: "advento",
  Anunciação: "anunciacao",
  "Domingo da Páscoa": "pascoa",
  "Domingo de Ramos e da Paixão": "semana-santa",
  Quaresma: "quaresma",
  Solenidades: "solenidades",
  "Tempo Comum": "tempo-comum",
  "Tempo do Natal": "natal",
  "12 Meses com Deus": "12-meses",
};

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function encodePathSegment(value: string) {
  return encodeURIComponent(value);
}

function makeDescription(category: string, title: string) {
  if (category === "12 Meses com Deus") {
    const month = title.split(" — ").at(-1) ?? "o mês";
    return `Uma canção de Vargen & Fé para atravessar ${month.toLocaleLowerCase("pt-BR")} com gratidão, esperança e oração.`;
  }
  if (category === "7 Dias com Deus  Fé, Força e Superação") {
    return "Uma faixa da série 7 Dias com Deus para acompanhar a oração, a força e a superação em cada dia.";
  }
  return `Uma canção de Vargen & Fé para acompanhar ${category.toLocaleLowerCase("pt-BR")}, com a Palavra em movimento e espaço para oração.`;
}

export const songs: Song[] = tracks.map(([category, title, videoId]) => ({
  title,
  slug: slugify(`${category}-${title}`),
  liturgicalSeason: seasonByCategory[category],
  celebration: category === "12 Meses com Deus" ? `Mês de ${title.split(" — ").at(-1)}` : category,
  liturgicalYear: "C",
  scripture: [],
  youtubeUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : siteConfig.youtube,
  spotifyUrl: null,
  appleMusicUrl: null,
  audioUrl: `/audio/${encodePathSegment(category)}/${encodePathSegment(title)}.mp3`,
  thumbnail: "/brand/placeholder-artwork.svg",
  description: makeDescription(category, title),
  releaseDate: "2026-08-24",
  featured: title === "A Minha Paz Vos Dou",
  ...(videoId ? { videoId } : {}),
}));

export function getSong(slug: string) {
  return songs.find((song) => song.slug === slug);
}

export function getSongsBySeason(season: string) {
  return songs.filter((song) => song.liturgicalSeason === season);
}

export const featuredSong = songs.find((song) => song.featured) ?? songs[0];
