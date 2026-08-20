export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        isu: {
          green: "#005931",
          "green-2": "#0c7441",
          mint: "#d6ede0",
          background: "#f4f7f5",
          surface: "#ffffff",
          muted: "#64716a",
          border: "#dbe5df",
          danger: "#a73535",
        },
      },
      borderRadius: {
        card: "24px",
        control: "12px",
      },
      fontFamily: {
        sans: ["Hanken Grotesk", "sans-serif"],
      },
    },
  },
  plugins: [],
};
