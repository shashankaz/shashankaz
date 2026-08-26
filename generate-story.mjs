import { mkdir, writeFile } from "node:fs/promises";

const LOGIN = process.env.GH_LOGIN || "shashankaz";
const TOKEN = process.env.GITHUB_TOKEN;
const OUT_DIR = process.env.OUT_DIR || "assets";
const OUT = `${OUT_DIR}/github-story.svg`;

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": LOGIN,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));

  return json.data;
}

async function fetchStory() {
  const base = await gql(
    `query ($login: String!) {
      user(login: $login) {
        createdAt
        contributionsCollection { contributionYears }
        repositories(ownerAffiliations: OWNER, isFork: false) { totalCount }
      }
    }`,
    { login: LOGIN },
  );
  const user = base.user;
  const years = [...user.contributionsCollection.contributionYears].sort();

  const perYear = [];

  for (const year of years) {
    const data = await gql(
      `query ($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            contributionCalendar { totalContributions }
          }
        }
      }`,
      {
        login: LOGIN,
        from: `${year}-01-01T00:00:00Z`,
        to: `${year}-12-31T23:59:59Z`,
      },
    );

    perYear.push({
      year,
      total:
        data.user.contributionsCollection.contributionCalendar
          .totalContributions,
    });
  }

  return {
    createdAt: user.createdAt,
    repos: user.repositories.totalCount,
    perYear,
  };
}

const MOCK = {
  createdAt: "2019-06-14T00:00:00Z",
  repos: 64,
  perYear: [
    { year: 2019, total: 42 },
    { year: 2020, total: 187 },
    { year: 2021, total: 356 },
    { year: 2022, total: 512 },
    { year: 2023, total: 748 },
    { year: 2024, total: 931 },
    { year: 2025, total: 1204 },
    { year: 2026, total: 823 },
  ],
};

const fmt = (n) => n.toLocaleString("en-US");
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function render(s) {
  const W = 880,
    H = 300;
  const ACCENT = "#61DAFB";

  const joined = new Date(s.createdAt);
  const joinedLabel = `${MONTHS[joined.getUTCMonth()]} ${joined.getUTCFullYear()}`;
  const yearsOn = new Date().getUTCFullYear() - joined.getUTCFullYear();
  const total = s.perYear.reduce((a, y) => a + y.total, 0);
  const best = s.perYear.reduce(
    (a, y) => (y.total > a.total ? y : a),
    s.perYear[0],
  );

  const PX = 56,
    PT = 96,
    PB = 66;
  const plotW = W - PX * 2,
    plotH = H - PT - PB;
  const maxV = Math.max(...s.perYear.map((y) => y.total)) * 1.15;
  const n = s.perYear.length;
  const xAt = (i) => PX + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v) => PT + plotH - (v / maxV) * plotH;

  const pts = s.perYear.map((y, i) => [xAt(i), yAt(y.total)]);
  const line = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${pts[n - 1][0].toFixed(1)},${PT + plotH} L${pts[0][0].toFixed(1)},${PT + plotH} Z`;

  const dots = s.perYear
    .map((y, i) => {
      const [x, cy] = pts[i];
      const isBest = y.year === best.year;

      return `
    <g class="fade" style="animation-delay:${1 + i * 0.12}s">
      <circle cx="${x}" cy="${cy}" r="${isBest ? 6 : 4}" fill="${isBest ? ACCENT : "#0D1117"}" stroke="${ACCENT}" stroke-width="2"/>
      <text x="${x}" y="${cy - 14}" text-anchor="middle" class="${isBest ? "peak" : "val"}">${fmt(y.total)}</text>
      <text x="${x}" y="${PT + plotH + 22}" text-anchor="middle" class="year">${y.year}</text>
    </g>`;
    })
    .join("");

  const pathLen = 2000;

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub story for ${LOGIN}">
  <style>
    .title  { font: 700 13px 'Segoe UI', Ubuntu, sans-serif; fill: #8b949e; letter-spacing: 2px; }
    .sub    { font: 600 12px 'Segoe UI', Ubuntu, sans-serif; fill: #c9d1d9; }
    .muted  { fill: #8b949e; font-weight: 400; }
    .val    { font: 600 11px 'Segoe UI', Ubuntu, sans-serif; fill: #c9d1d9; }
    .peak   { font: 700 12px 'Segoe UI', Ubuntu, sans-serif; fill: ${ACCENT}; }
    .year   { font: 600 11px 'Segoe UI', Ubuntu, sans-serif; fill: #8b949e; }
    .line   { stroke-dasharray: ${pathLen}; stroke-dashoffset: 0; animation: draw 1.6s ease-out; }
    .area   { animation: fadein 1.2s ease-out .4s backwards; }
    .fade   { animation: fadein .5s ease-out backwards; }
    @keyframes draw   { from { stroke-dashoffset: ${pathLen}; } }
    @keyframes fadein { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .line, .area, .fade { animation: none; } }
  </style>

  <defs>
    <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${ACCENT}" stop-opacity="0.02"/>
    </linearGradient>
  </defs>

  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="#0D1117" stroke="#21262d"/>

  <!-- header -->
  <text x="${PX}" y="36" class="title">@${LOGIN.toUpperCase()} · GITHUB STORY</text>
  <text x="${W - PX}" y="36" text-anchor="end" class="sub">Joined ${joinedLabel} · ${yearsOn}+ years on GitHub</text>
  <line x1="${PX}" y1="50" x2="${W - PX}" y2="50" stroke="#21262d"/>
  <text x="${PX}" y="76" class="sub">${fmt(total)} contributions since day one <tspan class="muted">· best year ${best.year} (${fmt(best.total)}) · ${fmt(s.repos)} repos built</tspan></text>

  <!-- baseline -->
  <line x1="${PX}" y1="${PT + plotH}" x2="${W - PX}" y2="${PT + plotH}" stroke="#21262d"/>

  <!-- journey -->
  <path class="area" d="${area}" fill="url(#areaFill)"/>
  <path class="line" d="${line}" fill="none" stroke="${ACCENT}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  ${dots}
</svg>`;
}

const story = process.env.MOCK ? MOCK : await fetchStory();

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT, render(story));

console.log(`Wrote ${OUT} (${story.perYear.length} years)`);
