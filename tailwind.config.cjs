/** Design tokens carried over from the interface this was merged with, so the
 *  compiled utilities match the markup exactly. Tailwind runs at build time via
 *  `npm run css`; there is no CDN script on any page.
 * @type {import("tailwindcss").Config} */
module.exports = Object.assign({
  darkMode: "class",
  theme: {
    extend: {
      "colors": {
        "surface-variant": "#d8e4ec",
        "primary": "#006947",
        "primary-deep": "#04241a",
        "gold": "#b6863b",
        "gold-soft": "#e7d3a8",
        "on-secondary-fixed-variant": "#2c4e36",
        "secondary-fixed": "#c5eccc",
        "tertiary-fixed-dim": "#c1c9bc",
        "outline": "#6e7a72",
        "secondary-fixed-dim": "#aad0b1",
        "inverse-primary": "#6fdba8",
        "on-background": "#121d23",
        "secondary": "#43664d",
        "surface": "#f7f4ea",
        "on-tertiary": "#ffffff",
        "surface-tint": "#006c49",
        "on-error-container": "#93000a",
        "on-secondary-container": "#486a51",
        "on-secondary-fixed": "#00210e",
        "tertiary-container": "#6f776c",
        "on-primary-fixed-variant": "#005236",
        "error-container": "#ffdad6",
        "on-error": "#ffffff",
        "surface-container-low": "#f1ede0",
        "on-secondary": "#ffffff",
        "error": "#a13a2c",
        "on-primary-container": "#f5fff6",
        "on-primary": "#ffffff",
        "secondary-container": "#c2e9c9",
        "surface-container": "#ece7d7",
        "primary-fixed-dim": "#6fdba8",
        "surface-dim": "#d0dce4",
        "surface-container-highest": "#e2ddc9",
        "inverse-on-surface": "#e7f2fb",
        "background": "#f7f4ea",
        "on-tertiary-container": "#f7fff1",
        "inverse-surface": "#273238",
        "on-tertiary-fixed": "#161d15",
        "primary-fixed": "#8bf8c3",
        "on-primary-fixed": "#002113",
        "outline-variant": "#dcd5bf",
        "on-surface": "#1c2420",
        "surface-container-high": "#e6e1cf",
        "surface-bright": "#faf8f0",
        "on-surface-variant": "#5b6058",
        "on-tertiary-fixed-variant": "#41493f",
        "tertiary-fixed": "#dde5d8",
        "primary-container": "#00855b",
        "tertiary": "#565e54",
        "surface-container-lowest": "#ffffff"
      },
      "borderRadius": {
        "DEFAULT": "0.25rem",
        "lg": "0.5rem",
        "xl": "0.75rem",
        "full": "9999px"
      },
      "spacing": {
        "margin-mobile": "16px",
        "md": "24px",
        "margin-desktop": "64px",
        "sm": "12px",
        "lg": "48px",
        "xl": "80px",
        "xs": "4px",
        "gutter": "24px",
        "base": "8px"
      },
      "fontFamily": {
        "headline-lg": ["Manrope"],
        "display-lg": ["Manrope"],
        "headline-lg-mobile": ["Manrope"],
        "body-sm": ["Work Sans"],
        "body-md": ["Work Sans"],
        "label-sm": ["JetBrains Mono"],
        "body-lg": ["Work Sans"],
        "label-md": ["JetBrains Mono"],
        "headline-md": ["Manrope"],
        "serif-display": ["Petrona", "serif"]
      },
      "fontSize": {
        "headline-lg": ["32px", {"lineHeight": "40px", "letterSpacing": "-0.01em", "fontWeight": "600"}],
        "display-lg": ["48px", {"lineHeight": "56px", "letterSpacing": "-0.02em", "fontWeight": "700"}],
        "headline-lg-mobile": ["24px", {"lineHeight": "32px", "letterSpacing": "-0.01em", "fontWeight": "600"}],
        "body-sm": ["14px", {"lineHeight": "20px", "fontWeight": "400"}],
        "body-md": ["16px", {"lineHeight": "24px", "fontWeight": "400"}],
        "label-sm": ["12px", {"lineHeight": "14px", "letterSpacing": "0.05em", "fontWeight": "500"}],
        "body-lg": ["18px", {"lineHeight": "28px", "fontWeight": "400"}],
        "label-md": ["14px", {"lineHeight": "16px", "letterSpacing": "0.05em", "fontWeight": "500"}],
        "headline-md": ["24px", {"lineHeight": "32px", "fontWeight": "600"}]
      }
    }
  }
}, {
  content: ["./web/**/*.html", "./web/js/**/*.js"],
  plugins: [require("@tailwindcss/forms")]
});
