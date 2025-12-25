import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Space Grotesk", "Helvetica Neue", "sans-serif"],
        mono: ["Source Code Pro", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
