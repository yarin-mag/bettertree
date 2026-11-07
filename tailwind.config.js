/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontSize: {
        xs: ["var(--font-size-xs, 0.75rem)", { lineHeight: "1rem" }],
        sm: ["var(--font-size-sm, 0.875rem)", { lineHeight: "1.25rem" }],
      },
      colors: {
        canvas: "var(--bg-canvas)",
        surface: "var(--bg-surface)",
        elevated: "var(--bg-elevated)",
        hover: "var(--bg-hover)",
        "border-subtle": "var(--border-subtle)",
        "text-primary": "var(--text-primary)",
        "text-muted": "var(--text-muted)",
        accent: "var(--accent)",
        "accent-contrast": "var(--accent-contrast)",
        "accent-soft": "var(--accent-soft-bg)",
        success: "var(--success)",
        danger: "var(--danger)",
        "success-soft": "var(--success-soft-bg)",
        "danger-soft": "var(--danger-soft-bg)",
        merged: "var(--merged)",
        "merged-soft": "var(--merged-soft-bg)",
      },
    },
  },
  plugins: [],
};
