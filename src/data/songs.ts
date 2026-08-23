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
  thumbnail: string;
  description: string;
  releaseDate: string;
  featured: boolean;
  videoId?: string;
};

export const songs: Song[] = [
  { title: "Vem, Senhor", slug: "vem-senhor", liturgicalSeason: "advento", celebration: "1º Domingo do Advento", liturgicalYear: "C", scripture: ["Mt 24, 37–44", "Is 2, 1–5"], youtubeUrl: "https://www.youtube.com/@vargenefe", spotifyUrl: null, appleMusicUrl: null, thumbnail: "/brand/placeholder-artwork.svg", description: "Uma canção de espera e vigilância para abrir o caminho do Advento.", releaseDate: "2025-11-30", featured: true },
  { title: "A Palavra Se Fez Carne", slug: "a-palavra-se-fez-carne", liturgicalSeason: "natal", celebration: "Natal do Senhor", liturgicalYear: "C", scripture: ["Jo 1, 1–18", "Is 52, 7–10"], youtubeUrl: "https://www.youtube.com/@vargenefe", spotifyUrl: null, appleMusicUrl: null, thumbnail: "/brand/placeholder-artwork.svg", description: "Rock contemplativo para o mistério do Deus que vem morar entre nós.", releaseDate: "2025-12-25", featured: false },
  { title: "No Caminho", slug: "no-caminho", liturgicalSeason: "tempo-comum", celebration: "3º Domingo do Tempo Comum", liturgicalYear: "C", scripture: ["Lc 1, 1–4; 4, 14–21", "Ne 8, 2–4a.5–6.8–10"], youtubeUrl: "https://www.youtube.com/@vargenefe", spotifyUrl: null, appleMusicUrl: null, thumbnail: "/brand/placeholder-artwork.svg", description: "A Palavra lida, ouvida e vivida no caminho cotidiano da comunidade.", releaseDate: "2026-01-25", featured: false },
  { title: "Volta Para Casa", slug: "volta-para-casa", liturgicalSeason: "quaresma", celebration: "4º Domingo da Quaresma", liturgicalYear: "C", scripture: ["Lc 15, 1–3.11–32", "Js 5, 9a.10–12"], youtubeUrl: "https://www.youtube.com/@vargenefe", spotifyUrl: null, appleMusicUrl: null, thumbnail: "/brand/placeholder-artwork.svg", description: "Uma canção sobre misericórdia, retorno e a casa que permanece aberta.", releaseDate: "2026-03-15", featured: false },
  { title: "A Cruz e o Silêncio", slug: "a-cruz-e-o-silencio", liturgicalSeason: "semana-santa", celebration: "Sexta-feira da Paixão", liturgicalYear: "C", scripture: ["Jo 18, 1–19, 42", "Is 52, 13–53, 12"], youtubeUrl: "https://www.youtube.com/@vargenefe", spotifyUrl: null, appleMusicUrl: null, thumbnail: "/brand/placeholder-artwork.svg", description: "Uma faixa densa e reverente para contemplar a entrega de Cristo.", releaseDate: "2026-04-03", featured: false },
  { title: "Amanheceu", slug: "amanheceu", liturgicalSeason: "pascoa", celebration: "Domingo da Páscoa", liturgicalYear: "C", scripture: ["Jo 20, 1–9", "At 10, 34a.37–43"], youtubeUrl: "https://www.youtube.com/@vargenefe", spotifyUrl: null, appleMusicUrl: null, thumbnail: "/brand/placeholder-artwork.svg", description: "Do silêncio do sepulcro nasce um refrão de vida nova e esperança.", releaseDate: "2026-04-05", featured: false },
  { title: "Sopra em Nós", slug: "sopra-em-nos", liturgicalSeason: "pentecostes", celebration: "Pentecostes", liturgicalYear: "C", scripture: ["Jo 20, 19–23", "At 2, 1–11"], youtubeUrl: "https://www.youtube.com/@vargenefe", spotifyUrl: null, appleMusicUrl: null, thumbnail: "/brand/placeholder-artwork.svg", description: "Um pedido de presença e envio guiado pelo sopro do Espírito.", releaseDate: "2026-05-24", featured: false },
  { title: "Mãe do Sim", slug: "mae-do-sim", liturgicalSeason: "solenidades", celebration: "Assunção de Nossa Senhora", liturgicalYear: "C", scripture: ["Lc 1, 39–56", "Ap 11, 19a; 12, 1–6a.10ab"], youtubeUrl: "https://www.youtube.com/@vargenefe", spotifyUrl: null, appleMusicUrl: null, thumbnail: "/brand/placeholder-artwork.svg", description: "Uma canção mariana sobre disponibilidade, presença e gratidão.", releaseDate: "2026-08-15", featured: false },
  { title: "Rei da Paz", slug: "rei-da-paz", liturgicalSeason: "solenidades", celebration: "Cristo Rei do Universo", liturgicalYear: "C", scripture: ["Lc 23, 35–43", "2Sm 5, 1–3"], youtubeUrl: "https://www.youtube.com/@vargenefe", spotifyUrl: null, appleMusicUrl: null, thumbnail: "/brand/placeholder-artwork.svg", description: "O encerramento do ano litúrgico em uma declaração de confiança.", releaseDate: "2026-11-22", featured: false },
];

export function getSong(slug: string) {
  return songs.find((song) => song.slug === slug);
}

export function getSongsBySeason(season: string) {
  return songs.filter((song) => song.liturgicalSeason === season);
}

export const featuredSong = songs.find((song) => song.featured) ?? songs[0];
