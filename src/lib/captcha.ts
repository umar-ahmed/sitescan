// Signatures of common bot-walls / CAPTCHA challenges in rendered HTML.
// Each entry maps a human-readable provider name to substrings that identify it.
export const CAPTCHA_SIGNATURES: ReadonlyArray<
  readonly [string, readonly string[]]
> = [
  [
    "Cloudflare",
    [
      "challenge-platform",
      "cf-chl",
      "just a moment",
      "checking your browser",
      "attention required! | cloudflare",
    ],
  ],
  [
    "Cloudflare Turnstile",
    ["cf-turnstile", "challenges.cloudflare.com/turnstile"],
  ],
  ["reCAPTCHA", ["g-recaptcha", "recaptcha/api.js", "grecaptcha"]],
  ["hCaptcha", ["h-captcha", "hcaptcha.com/captcha", "js.hcaptcha.com"]],
  ["DataDome", ["captcha-delivery.com", "datadome"]],
  ["PerimeterX", ["px-captcha", "_pxhd", "human challenge"]],
  ["Arkose / FunCaptcha", ["funcaptcha", "arkoselabs"]],
  [
    "generic",
    [
      "please verify you are a human",
      "are you a robot",
      "complete the captcha",
    ],
  ],
];

// Inspect captured HTML for a bot-wall / CAPTCHA. Returns the provider name, or
// null if the page looks like real content. Intentionally conservative - only
// flags strong, well-known markers so we don't false-positive on normal pages.
export function detectCaptcha(html: string): string | null {
  const haystack = html.toLowerCase();
  for (const [provider, markers] of CAPTCHA_SIGNATURES) {
    if (markers.some((m) => haystack.includes(m))) return provider;
  }
  return null;
}
