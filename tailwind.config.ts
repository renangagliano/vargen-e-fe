import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/pages/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}", "./src/app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { ink: "#0E0F12", navy: "#14213D", slate: "#1F2A37", gold: "#D4AF37", ivory: "#F2E9D8" },
      fontFamily: { display: ["var(--font-cormorant)", "Georgia", "serif"], sans: ["var(--font-manrope)", "Arial", "sans-serif"] },
    },
  },
  plugins: [],
};

export default config;
