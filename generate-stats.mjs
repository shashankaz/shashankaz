import { mkdir, writeFile } from "node:fs/promises";

const LOGIN = process.env.GH_LOGIN || "shashankaz";
const TOKEN = process.env.GITHUB_TOKEN;
const OUT_DIR = process.env.OUT_DIR || "assets";
const OUT = `${OUT_DIR}/stats.svg`;

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

async function fetchStats() {
  const base = await gql(
    `query ($login: String!) {
      user(login: $login) {
        followers { totalCount }
        contributionsCollection { contributionYears }
        repositories(first: 100, ownerAffiliations: OWNER, isFork: false,
                     orderBy: { field: PUSHED_AT, direction: DESC }) {
          totalCount
          nodes {
            stargazerCount
            languages(first: 6, orderBy: { field: SIZE, direction: DESC }) {
              edges { size node { name color } }
            }
          }
        }
      }
    }`,
    { login: LOGIN },
  );

  const user = base.user;
  const years = user.contributionsCollection.contributionYears;

  const days = new Map();

  let totalContributions = 0;
  let thisYear = 0;

  const currentYear = new Date().getUTCFullYear();

  for (const year of years) {
    const from = `${year}-01-01T00:00:00Z`;
    const to = `${year}-12-31T23:59:59Z`;
    const data = await gql(
      `query ($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            contributionCalendar {
              totalContributions
              weeks { contributionDays { date contributionCount } }
            }
          }
        }
      }`,
      { login: LOGIN, from, to },
    );

    const cal = data.user.contributionsCollection.contributionCalendar;
    totalContributions += cal.totalContributions;

    if (year === currentYear) thisYear = cal.totalContributions;

    for (const w of cal.weeks)
      for (const d of w.contributionDays) days.set(d.date, d.contributionCount);
  }

  const iso = (d) => d.toISOString().slice(0, 10);
  const today = new Date();

  let currentStreak = 0;

  const cursor = new Date(today);

  if (!(days.get(iso(cursor)) > 0)) cursor.setUTCDate(cursor.getUTCDate() - 1);

  while (days.get(iso(cursor)) > 0) {
    currentStreak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  let longestStreak = 0,
    run = 0;

  for (const date of [...days.keys()].sort()) {
    run = days.get(date) > 0 ? run + 1 : 0;
    if (run > longestStreak) longestStreak = run;
  }

  const langBytes = new Map();

  let stars = 0;

  for (const repo of user.repositories.nodes) {
    stars += repo.stargazerCount;

    for (const e of repo.languages.edges) {
      const cur = langBytes.get(e.node.name) || {
        size: 0,
        color: e.node.color,
      };

      cur.size += e.size;
      langBytes.set(e.node.name, cur);
    }
  }

  langBytes.delete("HTML");

  const totalBytes = [...langBytes.values()].reduce((a, b) => a + b.size, 0);
  const languages = [...langBytes.entries()]
    .map(([name, v]) => ({
      name,
      color: v.color || "#8b949e",
      pct: (v.size / totalBytes) * 100,
    }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 6);

  return {
    totalContributions,
    thisYear,
    currentStreak,
    longestStreak,
    stars,
    followers: user.followers.totalCount,
    repos: user.repositories.totalCount,
    languages,
  };
}

const MOCK = {
  totalContributions: 3247,
  thisYear: 1123,
  currentStreak: 17,
  longestStreak: 62,
  stars: 148,
  followers: 87,
  repos: 64,
  languages: [
    { name: "TypeScript", color: "#3178c6", pct: 38.4 },
    { name: "JavaScript", color: "#f1e05a", pct: 27.9 },
    { name: "Python", color: "#3572A5", pct: 14.2 },
    { name: "C++", color: "#f34b7d", pct: 9.8 },
    { name: "CSS", color: "#663399", pct: 6.1 },
    { name: "Shell", color: "#89e051", pct: 3.6 },
  ],
};

const fmt = (n) => n.toLocaleString("en-US");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function render(s) {
  const W = 880,
    H = 258;
  const ACCENT = "#61DAFB";

  const R = 64,
    CX = 122,
    CY = 116;
  const CIRC = 2 * Math.PI * R;
  const ringPct = Math.min(s.currentStreak / Math.max(s.longestStreak, 1), 1);
  const dash = CIRC * ringPct;

  const stats = [
    { label: "TOTAL CONTRIBUTIONS", value: fmt(s.totalContributions) },
    { label: `IN ${new Date().getUTCFullYear()}`, value: fmt(s.thisYear) },
    { label: "LONGEST STREAK", value: `${s.longestStreak} days` },
    { label: "STARS EARNED", value: fmt(s.stars) },
    { label: "FOLLOWERS", value: fmt(s.followers) },
    { label: "PUBLIC REPOS", value: fmt(s.repos) },
  ];

  const colW = 200,
    statX = 240,
    statY = 78;

  const statCells = stats
    .map((st, i) => {
      const x = statX + (i % 3) * colW;
      const y = statY + Math.floor(i / 3) * 58;
      return `
    <g class="fade" style="animation-delay:${0.15 + i * 0.1}s">
      <text x="${x}" y="${y}" class="value">${st.value}</text>
      <text x="${x}" y="${y + 18}" class="label">${st.label}</text>
    </g>`;
    })
    .join("");

  const barX = 240,
    barY = 186,
    barW = W - barX - 32,
    barH = 10;

  let acc = 0;

  const segs = s.languages
    .map((l) => {
      const w = (l.pct / 100) * barW;
      const seg = `<rect x="${barX + acc}" y="${barY}" width="${Math.max(w - 2, 2)}" height="${barH}" rx="3" fill="${l.color}"/>`;
      acc += w;
      return seg;
    })
    .join("");

  const legend = s.languages
    .map((l, i) => {
      const x = barX + (i % 3) * Math.floor(barW / 3);
      const y = barY + 32 + Math.floor(i / 3) * 22;
      return `
    <g class="fade" style="animation-delay:${0.6 + i * 0.08}s">
      <circle cx="${x + 4}" cy="${y - 4}" r="4" fill="${l.color}"/>
      <text x="${x + 14}" y="${y}" class="lang">${esc(l.name)} <tspan class="pct">${l.pct.toFixed(1)}%</tspan></text>
    </g>`;
    })
    .join("");

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub stats for ${LOGIN}">
  <style>
    .value  { font: 700 24px 'Segoe UI', Ubuntu, sans-serif; fill: #e6edf3; }
    .label  { font: 600 10px 'Segoe UI', Ubuntu, sans-serif; fill: #8b949e; letter-spacing: 1.4px; }
    .big    { font: 800 34px 'Segoe UI', Ubuntu, sans-serif; fill: ${ACCENT}; }
    .sub    { font: 600 10px 'Segoe UI', Ubuntu, sans-serif; fill: #8b949e; letter-spacing: 1.6px; }
    .lang   { font: 600 12px 'Segoe UI', Ubuntu, sans-serif; fill: #c9d1d9; }
    .pct    { fill: #8b949e; font-weight: 400; }
    .title  { font: 700 13px 'Segoe UI', Ubuntu, sans-serif; fill: #8b949e; letter-spacing: 2px; }
    .ring   { stroke-dasharray: ${dash.toFixed(1)} ${CIRC.toFixed(1)}; stroke-dashoffset: 0;
              animation: ring 1.2s ease-out; }
    .fade   { animation: fade .5s ease-out backwards; }
    @keyframes ring { from { stroke-dasharray: 0 ${CIRC.toFixed(1)}; } }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .ring, .fade { animation: none; } }
  </style>

  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="#0D1117" stroke="#21262d"/>

  <!-- streak ring -->
  <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#21262d" stroke-width="8"/>
  <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${ACCENT}" stroke-width="8"
          stroke-linecap="round" class="ring" transform="rotate(-90 ${CX} ${CY})"/>
  <text x="${CX}" y="${CY + 6}" text-anchor="middle" class="big">${s.currentStreak}</text>
  <text x="${CX}" y="${CY + 28}" text-anchor="middle" class="sub">DAY STREAK</text>
  <text x="${CX}" y="${CY + 96}" text-anchor="middle" class="label">UPDATED DAILY</text>

  <!-- header -->
  <text x="${statX}" y="32" class="title">@${LOGIN.toUpperCase()} · GITHUB PULSE</text>
  <line x1="${statX}" y1="46" x2="${W - 32}" y2="46" stroke="#21262d"/>

  ${statCells}

  <!-- language ribbon -->
  ${segs}
  ${legend}
</svg>`;
}

const stats = process.env.MOCK ? MOCK : await fetchStats();

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT, render(stats));

console.log(
  `Wrote ${OUT}`,
  JSON.stringify({ ...stats, languages: stats.languages.map((l) => l.name) }),
);
