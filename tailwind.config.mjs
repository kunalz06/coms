/** @type {import('tailwindcss').Config} */
const config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./features/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#151514",
        paper: "#f7f5f1",
        line: "#ded9cf",
        moss: "#3d6b53",
        teal: "#087f82",
        coral: "#c7524a",
        honey: "#d69e2e"
      },
      boxShadow: {
        soft: "0 24px 70px rgba(21, 21, 20, 0.12)"
      }
    }
  },
  plugins: []
};

export default config;
