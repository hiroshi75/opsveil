/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          0: "#0a0e17",
          1: "rgba(255,255,255,0.02)",
          2: "rgba(255,255,255,0.04)",
          3: "rgba(255,255,255,0.06)",
        },
        accent: {
          DEFAULT: "#6366f1",
          light: "#a5b4fc",
          dark: "#4f46e5",
        },
        phase: {
          autonomous: "#22c55e",
          blocked: "#ef4444",
          review: "#f59e0b",
          idle: "#6b7280",
        },
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "'Fira Code'", "monospace"],
        sans: ["'Inter'", "-apple-system", "sans-serif"],
      },
    },
  },
  plugins: [],
};
