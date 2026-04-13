const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#101614"/>
  <path d="M18 21.5C18 17.4 21.4 14 25.5 14h13C42.6 14 46 17.4 46 21.5v13C46 38.6 42.6 42 38.5 42H30l-8.5 7.2c-.8.7-2 .1-2-1V42h-1.5C14.4 42 12 39.6 12 36V27.5c0-3.3 2.7-6 6-6Z" fill="#F7F5EE"/>
  <path d="M24 26h16M24 33h10" stroke="#101614" stroke-width="4" stroke-linecap="round"/>
</svg>`;

export function GET() {
  return new Response(faviconSvg, {
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=31536000, immutable"
    }
  });
}
