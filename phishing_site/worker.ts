export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return handleIndex();
    }

    if (url.pathname === "/geo") {
      return handleGeo(request);
    }

    if (url.pathname === "/cloak") {
      return handleCloak(request);
    }

    if (url.pathname === "/protected") {
      return handleProtected();
    }

    if (url.pathname === "/favicon.svg") {
      return handleFavicon();
    }

    return new Response("Not Found", { status: 404 });
  },
};

function renderPage(emoji: string, label: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <title>${label}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f0f0f;
      color: #ffffff;
    }
    .emoji {
      font-size: 20rem;
      line-height: 1;
      margin-bottom: 1rem;
    }
    .label {
      font-size: 3rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div class="emoji">${emoji}</div>
  <div class="label">${label}</div>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html;charset=UTF-8" },
  });
}

function handleIndex(): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <title>Routes</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f0f0f;
      color: #ffffff;
    }
    h1 {
      font-size: 2.5rem;
      margin-bottom: 2rem;
    }
    ul {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    a {
      color: #58a6ff;
      text-decoration: none;
      font-size: 1.5rem;
      padding: 0.75rem 1.5rem;
      border: 1px solid #333;
      border-radius: 0.5rem;
      transition: background 0.15s;
    }
    a:hover {
      background: #1a1a2e;
    }
    .desc {
      color: #888;
      font-size: 0.9rem;
      margin-top: 0.25rem;
    }
  </style>
</head>
<body>
  <h1>Routes</h1>
  <ul>
    <li>
      <a href="/geo">/geo</a>
      <div class="desc">Shows your country flag and name based on location</div>
    </li>
    <li>
      <a href="/cloak">/cloak</a>
      <div class="desc">Cat emoji for desktop, devil imp on mobile</div>
    </li>
    <li>
      <a href="/protected">/protected</a>
      <div class="desc">Cloudflare bot verification challenge</div>
    </li>
  </ul>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html;charset=UTF-8" },
  });
}

function handleFavicon(): Response {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <text x="50" y="78" font-size="80" text-anchor="middle">🌍</text>
</svg>`;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

function handleGeo(request: Request): Response {
  const cf = (request as any).cf;
  const countryCode: string = cf?.country ?? "XX";
  const countryInfo = getCountryInfo(countryCode);
  return renderPage(countryInfo.emoji, countryInfo.name);
}

function handleCloak(request: Request): Response {
  const ua = request.headers.get("User-Agent") ?? "";
  const isMobile = /Mobile|Android|iPhone|iPod|iPad|Phone|webOS|BlackBerry|Opera Mini|IEMobile/i.test(ua);

  if (isMobile) {
    return renderPage("\u{1F608}", "Mobile");
  }

  return renderPage("\u{1F431}", "Meow");
}

function handleProtected(): Response {
  return renderPage("\u{1F916}", "Bot Check");
}

interface CountryInfo {
  name: string;
  emoji: string;
}

function getCountryInfo(code: string): CountryInfo {
  const countries: Record<string, CountryInfo> = {
    AF: { name: "Afghanistan", emoji: "🇦🇫" },
    AL: { name: "Albania", emoji: "🇦🇱" },
    DZ: { name: "Algeria", emoji: "🇩🇿" },
    AR: { name: "Argentina", emoji: "🇦🇷" },
    AU: { name: "Australia", emoji: "🇦🇺" },
    AT: { name: "Austria", emoji: "🇦🇹" },
    BD: { name: "Bangladesh", emoji: "🇧🇩" },
    BE: { name: "Belgium", emoji: "🇧🇪" },
    BR: { name: "Brazil", emoji: "🇧🇷" },
    CA: { name: "Canada", emoji: "🇨🇦" },
    CL: { name: "Chile", emoji: "🇨🇱" },
    CN: { name: "China", emoji: "🇨🇳" },
    CO: { name: "Colombia", emoji: "🇨🇴" },
    HR: { name: "Croatia", emoji: "🇭🇷" },
    CZ: { name: "Czechia", emoji: "🇨🇿" },
    DK: { name: "Denmark", emoji: "🇩🇰" },
    EG: { name: "Egypt", emoji: "🇪🇬" },
    FI: { name: "Finland", emoji: "🇫🇮" },
    FR: { name: "France", emoji: "🇫🇷" },
    DE: { name: "Germany", emoji: "🇩🇪" },
    GR: { name: "Greece", emoji: "🇬🇷" },
    HK: { name: "Hong Kong", emoji: "🇭🇰" },
    HU: { name: "Hungary", emoji: "🇭🇺" },
    IN: { name: "India", emoji: "🇮🇳" },
    ID: { name: "Indonesia", emoji: "🇮🇩" },
    IR: { name: "Iran", emoji: "🇮🇷" },
    IQ: { name: "Iraq", emoji: "🇮🇶" },
    IE: { name: "Ireland", emoji: "🇮🇪" },
    IL: { name: "Israel", emoji: "🇮🇱" },
    IT: { name: "Italy", emoji: "🇮🇹" },
    JP: { name: "Japan", emoji: "🇯🇵" },
    KE: { name: "Kenya", emoji: "🇰🇪" },
    KR: { name: "South Korea", emoji: "🇰🇷" },
    MY: { name: "Malaysia", emoji: "🇲🇾" },
    MX: { name: "Mexico", emoji: "🇲🇽" },
    MA: { name: "Morocco", emoji: "🇲🇦" },
    NL: { name: "Netherlands", emoji: "🇳🇱" },
    NZ: { name: "New Zealand", emoji: "🇳🇿" },
    NG: { name: "Nigeria", emoji: "🇳🇬" },
    NO: { name: "Norway", emoji: "🇳🇴" },
    PK: { name: "Pakistan", emoji: "🇵🇰" },
    PE: { name: "Peru", emoji: "🇵🇪" },
    PH: { name: "Philippines", emoji: "🇵🇭" },
    PL: { name: "Poland", emoji: "🇵🇱" },
    PT: { name: "Portugal", emoji: "🇵🇹" },
    RO: { name: "Romania", emoji: "🇷🇴" },
    RU: { name: "Russia", emoji: "🇷🇺" },
    SA: { name: "Saudi Arabia", emoji: "🇸🇦" },
    SG: { name: "Singapore", emoji: "🇸🇬" },
    ZA: { name: "South Africa", emoji: "🇿🇦" },
    ES: { name: "Spain", emoji: "🇪🇸" },
    SE: { name: "Sweden", emoji: "🇸🇪" },
    CH: { name: "Switzerland", emoji: "🇨🇭" },
    TW: { name: "Taiwan", emoji: "🇹🇼" },
    TH: { name: "Thailand", emoji: "🇹🇭" },
    TR: { name: "Turkey", emoji: "🇹🇷" },
    UA: { name: "Ukraine", emoji: "🇺🇦" },
    AE: { name: "United Arab Emirates", emoji: "🇦🇪" },
    GB: { name: "United Kingdom", emoji: "🇬🇧" },
    US: { name: "United States", emoji: "🇺🇸" },
    VN: { name: "Vietnam", emoji: "🇻🇳" },
  };

  return countries[code] ?? { name: "Unknown", emoji: "🌍" };
}
