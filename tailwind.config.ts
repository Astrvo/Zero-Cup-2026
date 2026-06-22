import type { Config } from "tailwindcss";

const config: Config = {
    content: [
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                // Axiom-ish dark palette
                base:    "#0a0b0e",
                panel:   "#111318",
                panel2:  "#161922",
                line:    "#23262f",
                ink:     "#e8eaed",
                muted:   "#8a8f9c",
                up:      "#2ad17e",
                upSoft:  "rgba(42, 209, 126, 0.14)",
                down:    "#f6465d",
                downSoft:"rgba(246, 70, 93, 0.14)",
                brand:   "#f7931a", // bitcoin orange
            },
            fontFamily: {
                mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
            },
            keyframes: {
                "fade-in": {
                    from: { opacity: "0", transform: "translateY(6px)" },
                    to:   { opacity: "1", transform: "translateY(0)" },
                },
                flash: {
                    "0%":   { opacity: "0.55" },
                    "100%": { opacity: "1" },
                },
            },
            animation: {
                "fade-in": "fade-in 0.2s ease forwards",
                flash: "flash 0.4s ease",
            },
        },
    },
    plugins: [],
};

export default config;
