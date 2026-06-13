export default {
  async fetch(request: Request): Promise<Response> {
    const cf = (request as any).cf;
    const countryCode: string = cf?.country ?? "XX";

    const countryInfo = getCountryInfo(countryCode);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${countryInfo.name}</title>
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
    .country-name {
      font-size: 3rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div class="emoji">${countryInfo.emoji}</div>
  <div class="country-name">${countryInfo.name}</div>
</body>
</html>`;

    return new Response(html, {
      headers: { "Content-Type": "text/html;charset=UTF-8" },
    });
  },
};

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
