// Futzone Bot — All-in-one index.js (discord.js v14 + SQLite)
// Includes: Welcome/Goodbye, Logs, AFK (mentions only + manual unafk),
// Vouches, Leaderboard, Staff List (highest role only),
// Matchbet (interactive /predict + !predict),
// Predictions (paginated + FILTER by team for both ! and /),
// Match Stats, Profile,
// Say/DM, Reset, Blacklist (owner + bot owner only),
// Session cleanup, and anti-crash guards.
//
// IMPORTANT: Put TOKEN/CLIENT_ID/GUILD_ID in .env, NOT in this file.
// Requires: npm i discord.js better-sqlite3 dotenv
require("dotenv").config();
client.login(process.env.TOKEN);
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  InteractionType,
} = require("discord.js");

const fs = require("fs"); // only used if you want to log to files later
require("dotenv").config();

const Database = require("better-sqlite3");

/* =========================
   CONFIG (IDS)
========================= */
const GUILD_ID = "1259167876733206578";

const WELCOME_CHANNEL_ID = "1259531299652374580";
const GOODBYE_CHANNEL_ID = "1340167535936536697";
const LOG_CHANNEL_ID = "1347352597534740602";
const RULES_CHANNEL_ID = "1270752793119948904";

const GW_HOST_ROLE_ID = "1343955031560421458";
const LV_ALLOWED_ROLE_IDS = ["1343955031560421458"]; // who can use !lv and /lv

// OWNER ONLY permissions (for resets + setmatch in BOTH ! and /)
const OWNER_ROLE_ID = "1343225887835033703";

// Bot owner user id
const BOT_OWNER_USER_ID = "596428982694707240";

// FD perms role id (special perms role) — for say/dm/update/result, etc
const FD_PERMS_ROLE_ID = "1338618264430968934";

// Trial admin role id (for vouch perms via isFDPerms)
const TRIAL_ADMIN_ROLE_ID = "1355596428495556759";

// Matchbet channel restriction
const MATCHBET_CHANNEL_ID = "1397281661753753671";

// Staff list roles (used only for !staff and /staff)
const ROLE_OWNER = "1343225887835033703";
const ROLE_CO_OWNER = "1315050307033632859";
const ROLE_FD_PERMS = "1338618264430968934";
const ROLE_HEAD_ADMIN = "1268228494207488132";
const ROLE_ADMIN = "1341348205283119114";
const ROLE_TRIAL_ADMIN = "1355596428495556759";
const ROLE_LEGENDS = "1350139239588696204";
const ROLE_HEAD_MOD = "1259479408637509755";
const ROLE_MOD = "1259479929347903499";
const ROLE_TRIAL_MOD = "1259478768376877106";
const ROLE_HEAD_STAFF = "1348347153818587289";
const ROLE_STAFF = "1355597706516500641";
const ROLE_TRIAL_STAFF = "1348346952160378941";
async function buildStaffTeamEmbeds(guild) {
  await guild.members.fetch().catch(() => {});
  const dash = "--------------------------------------------------";
  let text = `**THIS IS THE STAFF TEAM OF FUTZONE :**\n${dash}\n`;

  const roleBuckets = new Map();
  for (const s of STAFF_LIST) {
    if (s.roleId) roleBuckets.set(s.roleId, []);
  }

  for (const m of guild.members.cache.values()) {
    if (m.user.bot) continue;

    // pick the HIGHEST staff role from your STAFF_LIST order
    const highest = STAFF_LIST.find((s) => s.roleId && m.roles.cache.has(s.roleId));
    if (!highest) continue;

    roleBuckets.get(highest.roleId).push(m);
  }

  for (const section of STAFF_LIST) {
    text += `**${section.title}**\n`;
    const members = (roleBuckets.get(section.roleId) || []).sort(
      (a, b) => (b.roles.highest?.position || 0) - (a.roles.highest?.position || 0)
    );

    if (members.length === 0) {
      text += `\n${dash}\n`;
      continue;
    }

    text += `${members.map((m) => `<@${m.id}>`).join(" & ")}\n${dash}\n`;
  }

  const MAX = 3900;
  const parts = [];
  let current = "";

  for (const line of text.split("\n")) {
    if ((current + line + "\n").length > MAX) {
      parts.push(current.trimEnd());
      current = "";
    }
    current += line + "\n";
  }
  if (current.trim()) parts.push(current.trimEnd());

  return parts.map((desc, i) => {
    const e = fdEmbed("", desc);
    e.setFooter({ text: `Futzone Staff Team${parts.length > 1 ? ` • Page ${i + 1}/${parts.length}` : ""}` });
    return e;
  });
}

// Prefix
const PREFIX = "!";

// Styling
const EMBED_COLOR = "#0f172a";

// Session cleanup
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

/* =========================
   SQLITE DB (single file)
========================= */
const db = new Database("./futzone.sqlite");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS vouches (
  user_id TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS afk (
  user_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  since INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blacklist (
  user_id TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS match_teams (
  match_id INTEGER NOT NULL,
  team TEXT NOT NULL,
  PRIMARY KEY (match_id, team)
);

CREATE TABLE IF NOT EXISTS predictions (
  match_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  pick TEXT NOT NULL,
  bet TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (match_id, user_id)
);
`);

/* =========================
   DB PREPARED STATEMENTS
========================= */
// vouches
const qGetVouches = db.prepare("SELECT count FROM vouches WHERE user_id=?");
const qSetVouches = db.prepare(`
  INSERT INTO vouches(user_id,count) VALUES(?,?)
  ON CONFLICT(user_id) DO UPDATE SET count=excluded.count
`);
const qAddVouches = db.prepare(`
  INSERT INTO vouches(user_id,count) VALUES(?,?)
  ON CONFLICT(user_id) DO UPDATE SET count=count+excluded.count
`);
const qTopVouches = db.prepare(`
  SELECT user_id, count
  FROM vouches
  ORDER BY count DESC
  LIMIT 200
`);

// afk
const qSetAfk = db.prepare(`
  INSERT INTO afk(user_id,reason,since) VALUES(?,?,?)
  ON CONFLICT(user_id) DO UPDATE SET reason=excluded.reason, since=excluded.since
`);
const qGetAfk = db.prepare("SELECT reason,since FROM afk WHERE user_id=?");
const qDelAfk = db.prepare("DELETE FROM afk WHERE user_id=?");

// blacklist
const qIsBlacklisted = db.prepare("SELECT 1 FROM blacklist WHERE user_id=?");
const qAddBlacklist = db.prepare("INSERT OR IGNORE INTO blacklist(user_id) VALUES(?)");
const qDelBlacklist = db.prepare("DELETE FROM blacklist WHERE user_id=?");
const qListBlacklist = db.prepare("SELECT user_id FROM blacklist");

// matches
const qClearActive = db.prepare("UPDATE matches SET is_active=0 WHERE is_active=1");
const qCreateMatch = db.prepare("INSERT INTO matches(name,is_active,created_at) VALUES(?,?,?)");
const qActiveMatch = db.prepare("SELECT id,name,created_at FROM matches WHERE is_active=1 LIMIT 1");
const qRecentMatches = db.prepare("SELECT id,name,created_at FROM matches ORDER BY created_at DESC LIMIT 25");
const qAddTeam = db.prepare("INSERT OR IGNORE INTO match_teams(match_id,team) VALUES(?,?)");
const qGetTeams = db.prepare("SELECT team FROM match_teams WHERE match_id=?");

// predictions
const qAddPrediction = db.prepare(`
  INSERT INTO predictions(match_id,user_id,pick,bet,at)
  VALUES(?,?,?,?,?)
  ON CONFLICT(match_id,user_id) DO NOTHING
`);
const qGetPredictions = db.prepare(`
  SELECT user_id,pick,bet,at
  FROM predictions
  WHERE match_id=?
  ORDER BY at DESC
`);
const qClearPredictionsForMatch = db.prepare("DELETE FROM predictions WHERE match_id=?");

// resets
const qResetVouches = db.prepare("DELETE FROM vouches");
const qResetAfk = db.prepare("DELETE FROM afk");
const qResetBlacklist = db.prepare("DELETE FROM blacklist");
const qResetMatches = db.prepare("DELETE FROM predictions");
const qResetMatchTeams = db.prepare("DELETE FROM match_teams");
const qResetMatchesTable = db.prepare("DELETE FROM matches");

/* =========================
   IN-MEMORY SESSIONS
========================= */
// temp menu selections (not saved to disk)
const predictSessions = new Map(); // key: `${guildId}:${userId}` -> { matchId, matchName, team, createdAt }

// predictions pagination sessions (for !predictions and /predictions)
const predictionPages = new Map(); // sessionId -> { matchId, matchName, createdAt, filterTeam|null }
// ===== LEADERBOARD PAGINATION SESSIONS =====
const leaderboardPages = new Map(); // sessionId -> { createdAt }

/* =========================
   UTIL
========================= */
function cleanupSessions() {
  const now = Date.now();
for (const [k, v] of leaderboardPages.entries()) {
  const createdAt = v?.createdAt || 0;
  if (createdAt && now - createdAt > SESSION_TTL_MS) leaderboardPages.delete(k);
}

  for (const [k, v] of predictSessions.entries()) {
    const createdAt = v?.createdAt || 0;
    if (createdAt && now - createdAt > SESSION_TTL_MS) predictSessions.delete(k);
  }

  for (const [k, v] of predictionPages.entries()) {
    const createdAt = v?.createdAt || 0;
    if (createdAt && now - createdAt > SESSION_TTL_MS) predictionPages.delete(k);
  }
}

function fdEmbed(title, description) {
  const e = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTimestamp()
    .setFooter({ text: "FootballDex™ • Futzone" });
  if (title) e.setTitle(title);
  if (description) e.setDescription(description);
  return e;
}

function sendTemp(channel, payload, ms = 5000) {
  return channel
    .send(payload)
    .then((m) => setTimeout(() => m.delete().catch(() => {}), ms))
    .catch(() => {});
}

function hasAnyRole(member, roleIds) {
  if (!member) return false;
  return roleIds.some((rid) => member.roles.cache.has(rid));
}

// LV perms (admins + allowed roles)
function canUseLv(member) {
  return (
    member?.permissions?.has(PermissionsBitField.Flags.Administrator) ||
    hasAnyRole(member, LV_ALLOWED_ROLE_IDS)
  );
}

// Owner role OR bot owner user
function isOwnerRole(member) {
  return member?.id === BOT_OWNER_USER_ID || member?.roles?.cache?.has(OWNER_ROLE_ID);
}

// Owner-only for blacklist commands
function isOwnerOrBotOwner(member) {
  return isOwnerRole(member);
}

// FD PERMS (includes trial admin for vouch commands)
function isFDPerms(member) {
  return (
    member?.id === BOT_OWNER_USER_ID ||
    member?.roles?.cache?.has(FD_PERMS_ROLE_ID) ||
    member?.roles?.cache?.has(TRIAL_ADMIN_ROLE_ID)
  );
}

// Predictions perms: ONLY bot owner + FD perms (NOT trial admin)
function canUsePredictions(member) {
  return member?.id === BOT_OWNER_USER_ID || member?.roles?.cache?.has(FD_PERMS_ROLE_ID);
}

async function sendLog(guild, embed) {
  try {
    const ch = guild.channels.cache.get(LOG_CHANNEL_ID);
    if (ch) await ch.send({ embeds: [embed] });
  } catch {}
}

function parseTeams(matchName) {
  const parts = matchName
    .split(/\s+vs\.?\s+|\s+Vs\.?\s+|\s+VS\.?\s+|\s+v\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 2) return [parts[0], parts[1]];
  return [];
}

function isBlacklisted(userId) {
  return !!qIsBlacklisted.get(userId);
}

function getActiveMatch() {
  const m = qActiveMatch.get();
  if (!m) return null;
  const teams = qGetTeams.all(m.id).map((r) => r.team);
  return { matchId: m.id, name: m.name, teams, createdAt: m.created_at };
}

function setActiveMatch(matchName, teams) {
  const now = Date.now();
  qClearActive.run();
  const info = qCreateMatch.run(matchName, 1, now);
  const matchId = info.lastInsertRowid;
  for (const t of teams) qAddTeam.run(matchId, t);
  // clear any old predictions for safety (should be none since new id)
  return { matchId, name: matchName, teams, createdAt: now };
}

function clearActiveMatch() {
  qClearActive.run();
}

function getMatchChoices() {
  // show active + recent history
  const rows = qRecentMatches.all();
  // keep unique by name but preserve order
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (!r?.name) continue;
    if (seen.has(r.name)) continue;
    seen.add(r.name);
    out.push({ matchId: r.id, name: r.name });
    if (out.length >= 25) break;
  }
  return out;
}

function getTeamsForMatchId(matchId) {
  return qGetTeams.all(matchId).map((r) => r.team);
}

function savePrediction(matchId, userId, pick, bet) {
  const res = qAddPrediction.run(matchId, userId, pick, bet || "None", Date.now());
  return res.changes > 0; // false means they already predicted
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildMatchStatsEmbed(match) {
  const teams = match?.teams || [];
  const rows = qGetPredictions.all(match.matchId);
  const total = rows.length;

  const counts = {};
  for (const t of teams) counts[t] = 0;

  for (const p of rows) {
    if (p?.pick && counts[p.pick] !== undefined) counts[p.pick]++;
  }

  const lines = [];
  for (const t of teams) {
    const c = counts[t] || 0;
    const pct = total > 0 ? Math.round((c / total) * 100) : 0;
    lines.push(`**${t}:** **${c}** bets (**${pct}%**)`);
  }

  return fdEmbed("📊 Match Stats", `**Match:** ${match.name}\n**Total Bets:** ${total}\n\n${lines.join("\n")}`);
}

function buildProfileEmbed(guild, userId) {
  const member = guild.members.cache.get(userId);
  const userName = member ? member.displayName : `User ${userId}`;
  const v = Number(qGetVouches.get(userId)?.count ?? 0);

  const afk = qGetAfk.get(userId);
  const afkLine = afk ? `✅ AFK — **${afk.reason || "No reason"}**` : "❌ Not AFK";

  const active = getActiveMatch();
  let pickLine = "None";
  if (active) {
    const rows = qGetPredictions.all(active.matchId);
    const found = rows.find((r) => r.user_id === userId);
    if (found) pickLine = `**${found.pick}** (Bet: ${found.bet || "None"})`;
  }

  const e = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle("👤 Profile")
    .setDescription(
      `**User:** ${userName}\n**Vouches:** ${v.toLocaleString()}\n**AFK:** ${afkLine}\n**Active Match Pick:** ${pickLine}`
    )
    .setTimestamp()
    .setFooter({ text: "FootballDex™ • Futzone" });

  if (member?.user) e.setThumbnail(member.user.displayAvatarURL({ size: 256, extension: "png" }));
  return e;
}

function buildPredictionsEmbed(guild, match, pageIndex = 0, filterTeam = null) {
  let rows = qGetPredictions.all(match.matchId);

  if (filterTeam) {
    rows = rows.filter((r) => (r.pick || "").toLowerCase() === filterTeam.toLowerCase());
  }

  if (!rows.length) {
    return {
      embed: fdEmbed(
        "📈 Match Predictions",
        `**Match:** ${match.name}\n${filterTeam ? `**Team:** ${filterTeam}\n` : ""}\nNo predictions yet.`
      ),
      totalPages: 1,
      pageIndex: 0,
    };
  }

  const perPage = 25;
  const pages = chunk(rows, perPage);
  const totalPages = pages.length;

  const safeIndex = Math.max(0, Math.min(pageIndex, totalPages - 1));
  const page = pages[safeIndex];

  const lines = page.map((p) => {
    const m = guild.members.cache.get(p.user_id);
    const name = m ? m.displayName : p.user_id;
    return `**${name}** → **${p.pick}** (Bet: ${p.bet})`;
  });

  const embed = fdEmbed(
    "📈 Match Predictions",
    `**Match:** ${match.name}\n${filterTeam ? `**Team:** ${filterTeam}\n` : ""}\n${lines.join("\n")}`
  ).setFooter({ text: `Page ${safeIndex + 1}/${totalPages} • Total: ${rows.length}` });

  return { embed, totalPages, pageIndex: safeIndex };
}

function makePredButtons(sessionId, pageIndex, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`preds_prev:${sessionId}:${pageIndex}`)
      .setLabel("⬅️ Prev")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pageIndex <= 0),
    new ButtonBuilder()
      .setCustomId(`preds_next:${sessionId}:${pageIndex}`)
      .setLabel("Next ➡️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pageIndex >= totalPages - 1)
  );
}
function makeLbButtons(sessionId, pageIndex, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`lb_prev:${sessionId}:${pageIndex}`)
      .setLabel("⬅️ Prev")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pageIndex <= 0),
    new ButtonBuilder()
      .setCustomId(`lb_next:${sessionId}:${pageIndex}`)
      .setLabel("Next ➡️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pageIndex >= totalPages - 1)
  );
}
function makePredictComponents(guildId, userId, currentMatchId) {
  const choices = getMatchChoices(); // [{matchId,name}...]
  const current = currentMatchId
    ? choices.find((c) => Number(c.matchId) === Number(currentMatchId)) || null
    : null;

  const matchMenu = new StringSelectMenuBuilder()
    .setCustomId(`predict_match:${guildId}:${userId}`)
    .setPlaceholder("Select Match")
    .setMinValues(1)
    .setMaxValues(1);

  if (choices.length === 0) {
    matchMenu.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel("No match set (ask owner to /setmatch)")
        .setValue("NO_MATCH")
        .setDefault(true)
    );
  } else {
    for (const c of choices.slice(0, 25)) {
      const opt = new StringSelectMenuOptionBuilder()
        .setLabel(c.name)
        .setValue(String(c.matchId));
      if (current && String(c.matchId) === String(current.matchId)) opt.setDefault(true);
      matchMenu.addOptions(opt);
    }
  }

  const teams = current ? getTeamsForMatchId(current.matchId) : [];
  const teamMenu = new StringSelectMenuBuilder()
    .setCustomId(`predict_team:${guildId}:${userId}`)
    .setPlaceholder("Pick your side")
    .setMinValues(1)
    .setMaxValues(1);

  if (!current || teams.length === 0) {
    teamMenu.addOptions(
      new StringSelectMenuOptionBuilder().setLabel("Set a match first").setValue("NO_TEAM").setDefault(true)
    );
  } else {
    for (const t of teams.slice(0, 25)) {
      teamMenu.addOptions(new StringSelectMenuOptionBuilder().setLabel(t).setValue(t));
    }
  }

  const confirmBtn = new ButtonBuilder()
    .setCustomId(`predict_confirm:${guildId}:${userId}`)
    .setLabel("Confirm")
    .setStyle(ButtonStyle.Success);

  const cancelBtn = new ButtonBuilder()
    .setCustomId(`predict_cancel:${guildId}:${userId}`)
    .setLabel("Cancel")
    .setStyle(ButtonStyle.Secondary);

  return [
    new ActionRowBuilder().addComponents(matchMenu),
    new ActionRowBuilder().addComponents(teamMenu),
    new ActionRowBuilder().addComponents(confirmBtn, cancelBtn),
  ];
}

function openBetModal(interaction, matchId, matchName, teamName) {
  const modal = new ModalBuilder()
    .setCustomId(`predict_betmodal:${interaction.guildId}:${interaction.user.id}`)
    .setTitle("Match Bet (optional)");

  const betInput = new TextInputBuilder()
    .setCustomId("bet_text")
    .setLabel("Bet (optional)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("Example: 50k / 100k / 0.5x / whatever you use");

  modal.addComponents(new ActionRowBuilder().addComponents(betInput));

  predictSessions.set(`${interaction.guildId}:${interaction.user.id}`, {
    matchId,
    matchName,
    team: teamName,
    createdAt: Date.now(),
  });

  return interaction.showModal(modal);
}

async function safeReply(interaction, payload) {
  try {
    if (interaction.replied || interaction.deferred) return interaction.followUp(payload);
    return interaction.reply(payload);
  } catch {
    return null;
  }
}

/* =========================
   STAFF LIST (highest role only, bots excluded)
========================= */
const STAFF_LIST = [
  { title: "OWNER :", roleId: ROLE_OWNER },
  { title: "CO OWNER :", roleId: ROLE_CO_OWNER },
  { title: "FOOTBALL DEX PERMS :", roleId: ROLE_FD_PERMS },
  { title: "HEAD ADMIN :", roleId: ROLE_HEAD_ADMIN },
  { title: "ADMIN :", roleId: ROLE_ADMIN },
  { title: "TRIAL ADMIN :", roleId: ROLE_TRIAL_ADMIN },
  { title: "FUTZONE LEGENDS :", roleId: ROLE_LEGENDS },
  { title: "HEAD MODERATOR :", roleId: ROLE_HEAD_MOD },
  { title: "MODERATOR :", roleId: ROLE_MOD },
  { title: "TRIAL MODERATOR :", roleId: ROLE_TRIAL_MOD },
  { title: "HEAD STAFF :", roleId: ROLE_HEAD_STAFF },
  { title: "STAFF :", roleId: ROLE_STAFF },
  { title: "TRIAL STAFF :", roleId: ROLE_TRIAL_STAFF },
];
async function buildStaffTeamEmbeds(guild) {
  await guild.members.fetch().catch(() => {});
  const dash = "--------------------------------------------------";
  let text = `**THIS IS THE STAFF TEAM OF FUTZONE :**\n${dash}\n`;

  const roleBuckets = new Map();
  for (const s of STAFF_LIST) {
    if (s.roleId) roleBuckets.set(s.roleId, []);
  }

  for (const m of guild.members.cache.values()) {
    if (m.user.bot) continue;

    // pick the HIGHEST staff role from your STAFF_LIST order
    const highest = STAFF_LIST.find((s) => s.roleId && m.roles.cache.has(s.roleId));
    if (!highest) continue;

    roleBuckets.get(highest.roleId).push(m);
  }

  for (const section of STAFF_LIST) {
    text += `**${section.title}**\n`;
    const members = (roleBuckets.get(section.roleId) || []).sort(
      (a, b) => (b.roles.highest?.position || 0) - (a.roles.highest?.position || 0)
    );

    if (members.length === 0) {
      text += `\n${dash}\n`;
      continue;
    }

    text += `${members.map((m) => `<@${m.id}>`).join(" & ")}\n${dash}\n`;
  }

  const MAX = 3900;
  const parts = [];
  let current = "";

  for (const line of text.split("\n")) {
    if ((current + line + "\n").length > MAX) {
      parts.push(current.trimEnd());
      current = "";
    }
    current += line + "\n";
  }
  if (current.trim()) parts.push(current.trimEnd());

  return parts.map((desc, i) => {
    const e = fdEmbed("", desc);
    e.setFooter({ text: `Futzone Staff Team${parts.length > 1 ? ` • Page ${i + 1}/${parts.length}` : ""}` });
    return e;
  });
}

async function buildLeaderboardPages(guild) {
  await guild.members.fetch().catch(() => {});
  const eligible = guild.members.cache
    .filter((m) => !m.user.bot)
    .filter((m) => hasAnyRole(m, LEADERBOARD_ROLE_IDS));

  // pull all vouches from DB
  const topRows = qTopVouches.all(); // LIMIT 200 in your query
  const vMap = new Map(topRows.map((r) => [r.user_id, r.count]));

  const rows = [];
  for (const m of eligible.values()) {
    const count = Number(vMap.get(m.id) ?? (qGetVouches.get(m.id)?.count ?? 0));
    rows.push({ name: m.displayName, count });
  }
  rows.sort((a, b) => b.count - a.count);

  const perPage = 15; // change if you want
  const pages = chunk(rows, perPage);

  if (!pages.length) {
    return [fdEmbed("Vouches Leaderboard:", "No eligible users found.")];
  }

  return pages.map((pageRows, i) => {
    const lines = pageRows.map(
      (r, idx) => `**${i * perPage + idx + 1})** ${r.name} has **${r.count.toLocaleString()}** vouches`
    );

    return fdEmbed("Vouches Leaderboard:", lines.join("\n"))
      .setFooter({ text: `Page ${i + 1}/${pages.length}` });
  });
}

/* =========================
   LEADERBOARD (staff roles eligible)
========================= */
const LEADERBOARD_ROLE_IDS = [
  GW_HOST_ROLE_ID,
  ROLE_OWNER,
  ROLE_CO_OWNER,
  ROLE_FD_PERMS,
  ROLE_HEAD_ADMIN,
  ROLE_ADMIN,
  ROLE_TRIAL_ADMIN,
  ROLE_HEAD_MOD,
  ROLE_MOD,
  ROLE_TRIAL_MOD,
  ROLE_HEAD_STAFF,
  ROLE_STAFF,
  ROLE_TRIAL_STAFF,
].filter(Boolean);

async function buildLeaderboardEmbed(guild) {
  await guild.members.fetch().catch(() => {});
  const eligible = guild.members.cache.filter((m) => hasAnyRole(m, LEADERBOARD_ROLE_IDS));

  // pull all vouches top, then map onto eligible; include zeros for eligible users
  const topRows = qTopVouches.all();
  const vMap = new Map(topRows.map((r) => [r.user_id, r.count]));

  const rows = [];
  for (const m of eligible.values()) {
    const count = Number(vMap.get(m.id) ?? (qGetVouches.get(m.id)?.count ?? 0));
    rows.push({ name: m.displayName, count });
  }
  rows.sort((a, b) => b.count - a.count);

  const top = rows.slice(0, 30);
  const lines = top.map((r, i) => `**${i + 1})** ${r.name} has **${r.count.toLocaleString()}** vouches`);
  return fdEmbed("Vouches Leaderboard:", lines.length ? lines.join("\n") : "No eligible users found.");
}

/* =========================
   CLIENT
========================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

/* =========================
   SLASH COMMANDS
========================= */
const slashCommands = [
  
  new SlashCommandBuilder().setName("lv").setDescription("Show vouches leaderboard"),
new SlashCommandBuilder()
    .setName("adminpredict")
    .setDescription("Force a prediction for a user")
    .addUserOption((o) => o.setName("user").setDescription("User to predict for").setRequired(true))
    .addStringOption((o) =>
      o.setName("team")
        .setDescription("Team predicted")
        .setRequired(true)
        .addChoices({ name: "Team A", value: "A" }, { name: "Team B", value: "B" })
    )
    .addStringOption((o) => o.setName("bet").setDescription("Bet they placed").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason for override").setRequired(false)),
  new SlashCommandBuilder()
    .setName("checkvouch")
    .setDescription("Check vouches for a user")
    .addUserOption((o) => o.setName("user").setDescription("User (optional)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("vouch")
    .setDescription("Vouch commands (FD perms only)")
    .addSubcommand((s) =>
      s
        .setName("give")
        .setDescription("Give vouches")
        .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
        .addIntegerOption((o) => o.setName("amount").setDescription("Amount").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("remove")
        .setDescription("Remove vouches")
        .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
        .addIntegerOption((o) => o.setName("amount").setDescription("Amount").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("clear")
        .setDescription("Clear a user’s vouches")
        .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
    ),

  new SlashCommandBuilder()
    .setName("setmatch")
    .setDescription("Set the active match (OWNER only)")
    .addStringOption((o) => o.setName("match").setDescription("Example: Arsenal Vs Liverpool").setRequired(true)),

  new SlashCommandBuilder().setName("predict").setDescription("Predict a match (interactive)"),

  new SlashCommandBuilder()
    .setName("predictions")
    .setDescription("Show predictions for the active match")
    .addStringOption((o) => o.setName("team").setDescription("Filter by team (optional)").setRequired(false)),

  new SlashCommandBuilder().setName("matchstats").setDescription("Show matchbet stats (split/odds)"),

  new SlashCommandBuilder()
    .setName("profile")
    .setDescription("Show a user profile")
    .addUserOption((o) => o.setName("user").setDescription("User (optional)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("result")
    .setDescription("Close match + set winner (FD perms only)")
    .addStringOption((o) => o.setName("winner").setDescription("Winner").setRequired(true)),

  new SlashCommandBuilder()
    .setName("afk")
    .setDescription("Set AFK")
    .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(false)),

  new SlashCommandBuilder()
    .setName("say")
    .setDescription("Speak as bot (FD perms only)")
    .addStringOption((o) => o.setName("message").setDescription("Message").setRequired(true))
    .addChannelOption((o) => o.setName("channel").setDescription("Optional channel").setRequired(false)),

  new SlashCommandBuilder()
    .setName("dm")
    .setDescription("DM a user (FD perms only)")
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
    .addStringOption((o) => o.setName("message").setDescription("Message").setRequired(true)),

  new SlashCommandBuilder().setName("staff").setDescription("Show Futzone staff team list"),

  new SlashCommandBuilder().setName("resetall").setDescription("Reset vouches+matches+afk+blacklist (OWNER only)"),
  new SlashCommandBuilder().setName("resetvouches").setDescription("Reset vouches (OWNER only)"),
  new SlashCommandBuilder().setName("resetmatch").setDescription("Reset match system (OWNER only)"),
  new SlashCommandBuilder().setName("resetafk").setDescription("Reset AFK system (OWNER only)"),
new SlashCommandBuilder()
  .setName("fart")
  .setDescription("💨 do a fart")
  .addUserOption((o) => o.setName("user").setDescription("Fart on someone (optional)").setRequired(false)),
  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Blacklist commands (OWNER only)")
    .addSubcommand((s) =>
      s.setName("add").setDescription("Blacklist a user").addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName("remove").setDescription("Remove user from blacklist").addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
    )
    .addSubcommand((s) => s.setName("list").setDescription("List blacklisted users")),
].map((c) => c.toJSON());

async function registerSlash() {
  if (!process.env.TOKEN || !process.env.CLIENT_ID || !process.env.GUILD_ID) {
    console.log("Missing TOKEN/CLIENT_ID/GUILD_ID in .env");
    return;
  }
  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: slashCommands }
  );
  const slashCommands = [
    new SlashCommandBuilder().setName('help').setDescription('View all available commands'),
    // ... all your other commands (predict, vouch, staff, etc.)
].map(cmd => cmd.toJSON());
}

/* =========================
   READY
========================= */
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerSlash().catch(console.error);
  setInterval(() => cleanupSessions(), CLEANUP_INTERVAL_MS);
});

/* =========================
   WELCOME / GOODBYE (AUTO AVATAR)
========================= */
client.on("guildMemberAdd", async (member) => {
  if (member.guild.id !== GUILD_ID) return;
  const ch = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
  if (!ch) return;

  const avatar = member.user.displayAvatarURL({ size: 512, extension: "png" });

  const e = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setAuthor({ name: "Futzone Welcome" })
    .setImage(avatar)
    .setFooter({ text: "Futzone Welcome" });

  await ch.send({ embeds: [e] }).catch(() => {});
  await ch.send(`Welcome To Futzone ${member}`).catch(() => {});
});

client.on("guildMemberRemove", async (member) => {
  if (member.guild.id !== GUILD_ID) return;
  const ch = member.guild.channels.cache.get(GOODBYE_CHANNEL_ID);
  if (!ch) return;

  const user = member.user;
  const mentionOrName = user ? `<@${user.id}>` : `**${member.displayName || "unknown-user"}**`;
  const avatar = user ? user.displayAvatarURL({ size: 512, extension: "png" }) : null;

  const e = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setAuthor({ name: "Futzone Goodbye" })
    .setFooter({ text: "Futzone Goodbye" });
  if (avatar) e.setImage(avatar);

  await ch.send({ embeds: [e] }).catch(() => {});
  await ch.send(`Futzone Says Goodbye To ${mentionOrName}`).catch(() => {});
});

/* =========================
   SLASH HANDLER
========================= */
client.on("interactionCreate", async (interaction) => {
  try {
    // Global blacklist block
    if (isBlacklisted(interaction.user.id)) {
      return safeReply(interaction, { content: "❌ You are blacklisted from using this bot.", ephemeral: true });
    }

    // Pagination buttons for predictions
    if (interaction.isButton() && interaction.customId.startsWith("preds_")) {
      const parts = interaction.customId.split(":");
      const key = parts[0]; // preds_prev or preds_next
      const sessionId = parts[1];
      const currentPage = parseInt(parts[2], 10) || 0;

      const session = predictionPages.get(sessionId);
      if (!session) {
        return safeReply(interaction, { content: "❌ This predictions page expired. Run predictions again.", ephemeral: true });
      }

      await interaction.guild.members.fetch().catch(() => {});
      let nextPage = currentPage;
      if (key === "preds_prev") nextPage--;
      if (key === "preds_next") nextPage++;

      const match = { matchId: session.matchId, name: session.matchName, teams: getTeamsForMatchId(session.matchId) };
      const { embed, totalPages, pageIndex } = buildPredictionsEmbed(interaction.guild, match, nextPage, session.filterTeam || null);
      const row = makePredButtons(sessionId, pageIndex, totalPages);

      return interaction
        .update({
          embeds: [embed],
          components: totalPages > 1 ? [row] : [],
          allowedMentions: { parse: [] },
        })
        .catch(() => {});
    }
// ===== LEADERBOARD BUTTONS =====
if (interaction.isButton() && interaction.customId.startsWith("lb_")) {
  const [key, sessionId, currentStr] = interaction.customId.split(":");
  const currentPage = parseInt(currentStr, 10) || 0;

  const session = leaderboardPages.get(sessionId);
  if (!session) {
    return safeReply(interaction, { content: "❌ This leaderboard expired. Run /lv again.", ephemeral: true });
  }

  let nextPage = currentPage;
  if (key === "lb_prev") nextPage--;
  if (key === "lb_next") nextPage++;

  const pages = await buildLeaderboardPages(interaction.guild);
  const totalPages = pages.length;
  const safeIndex = Math.max(0, Math.min(nextPage, totalPages - 1));
  const row = totalPages > 1 ? [makeLbButtons(sessionId, safeIndex, totalPages)] : [];

  return interaction.update({ embeds: [pages[safeIndex]], components: row, allowedMentions: { parse: [] } }).catch(() => {});
}

    // Modal submit (bet)
    if (interaction.type === InteractionType.ModalSubmit) {
      if (!interaction.customId.startsWith("predict_betmodal:")) return;

      const key = `${interaction.guildId}:${interaction.user.id}`;
      const session = predictSessions.get(key);
      predictSessions.delete(key);

      if (!session?.matchId || !session?.matchName || !session?.team) {
        return safeReply(interaction, { content: "❌ Prediction session expired. Run /predict again.", ephemeral: true });
      }

      const bet = interaction.fields.getTextInputValue("bet_text") || "None";
      const ok = savePrediction(session.matchId, interaction.user.id, session.team, bet);

      if (!ok) {
        return safeReply(interaction, {
          content: `❌ You already placed a bet for **${session.matchName}** and can’t change it.`,
          ephemeral: true,
        });
      }

      const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle(`${session.matchName}  Match\nPrediction`)
        .setDescription(`**Prediction:** ${session.team}\n**Bet:** ${bet}\n**Please wait until the end of the match.**`)
        .setThumbnail(interaction.user.displayAvatarURL({ size: 256, extension: "png" }))
        .setFooter({ text: `Futzone Prediction by ${interaction.user.username}` })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: false }).catch(() => {});
    }

    // Select menu / button interactions for predict UI
    if (interaction.isStringSelectMenu() || interaction.isButton()) {
      const [type, guildId, userId] = interaction.customId.split(":");
      if (!type.startsWith("predict_")) return;

      // lock controls to the user who ran /predict
      if (interaction.user.id !== userId) {
        return safeReply(interaction, { content: "❌ This menu isn't for you.", ephemeral: true });
      }

      const key = `${guildId}:${userId}`;
      const current =
        predictSessions.get(key) || {
          matchId: getActiveMatch()?.matchId || null,
          matchName: getActiveMatch()?.name || null,
          team: null,
          createdAt: Date.now(),
        };

      if (interaction.isStringSelectMenu() && type === "predict_match") {
        const picked = interaction.values[0];
        if (picked === "NO_MATCH") {
          current.matchId = null;
          current.matchName = null;
          current.team = null;
          current.createdAt = Date.now();
          predictSessions.set(key, current);
          const rows = makePredictComponents(guildId, userId, current.matchId);
          return interaction.update({ components: rows }).catch(() => {});
        }

        const matchId = Number(picked);
        const matchRow = qRecentMatches.all().find((r) => Number(r.id) === matchId);
        current.matchId = matchId;
        current.matchName = matchRow?.name || "Match";
        current.team = null;
        current.createdAt = Date.now();
        predictSessions.set(key, current);

        const rows = makePredictComponents(guildId, userId, current.matchId);
        return interaction.update({ components: rows }).catch(() => {});
      }

      if (interaction.isStringSelectMenu() && type === "predict_team") {
        const picked = interaction.values[0];
        current.team = picked === "NO_TEAM" ? null : picked;
        current.createdAt = Date.now();
        predictSessions.set(key, current);

        const rows = makePredictComponents(guildId, userId, current.matchId);
        return interaction.update({ components: rows }).catch(() => {});
      }

      if (interaction.isButton() && type === "predict_confirm") {
        if (!current.matchId) return safeReply(interaction, { content: "❌ No match selected.", ephemeral: true });
        if (!current.team) return safeReply(interaction, { content: "❌ Pick a side first.", ephemeral: true });
        return openBetModal(interaction, current.matchId, current.matchName, current.team);
      }

      if (interaction.isButton() && type === "predict_cancel") {
        predictSessions.delete(key);
        return interaction.update({ components: [], content: "✅ Cancelled.", embeds: [] }).catch(() => {});
      }

      return;
    }

    // Regular slash commands
    if (!interaction.isChatInputCommand()) return;
    const member = interaction.member;
if (interaction.commandName === "lv") {
  if (!canUseLv(member)) return safeReply(interaction, { content: "❌ No permission.", ephemeral: true });

  const pages = await buildLeaderboardPages(interaction.guild);
  const sessionId = `${interaction.guildId}_${interaction.channelId}_lb_${Date.now()}`;
  leaderboardPages.set(sessionId, { createdAt: Date.now() });

  setTimeout(() => leaderboardPages.delete(sessionId), SESSION_TTL_MS);

  const row = pages.length > 1 ? [makeLbButtons(sessionId, 0, pages.length)] : [];
  return interaction.reply({ embeds: [pages[0]], components: row, allowedMentions: { parse: [] } }).catch(() => {});
}
if (interaction.commandName === 'help') {
    const helpEmbed = new EmbedBuilder()
        .setColor('#0f172a')
        .setTitle('⚽ Futzone | Command List')
        .setDescription('Here is a full list of all available commands for the bot:')
        .setThumbnail(interaction.guild.iconURL())
        .setTimestamp();

    // THIS IS THE DYNAMIC PART:
    // It loops through your registration array and adds them to the embed automatically
    slashCommands.forEach(cmd => {
        // Handle both raw JSON objects and SlashCommandBuilder objects
        const name = cmd.name || cmd.toJSON().name;
        const desc = cmd.description || cmd.toJSON().description;
        
        helpEmbed.addFields({ name: `/${name}`, value: desc, inline: true });
    });

    helpEmbed.setFooter({ text: `Total Commands: ${slashCommands.length}` });

    await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
}
if (interaction.commandName === "fart") {
  const target = interaction.options.getUser("user") || interaction.user;

  // If they fart on themselves, say it funny
  const msg =
    target.id === interaction.user.id
      ? `💨 <@${interaction.user.id}> farted… on themselves. nasty 😭`
      : `💨 <@${interaction.user.id}> farted on <@${target.id}> 😭`;

  return interaction.reply({
    content: msg,
    allowedMentions: { users: [interaction.user.id, target.id] },
  }).catch(() => {});
}
   if (interaction.commandName === "checkvouch") {
  if (!canUseLv(member)) return safeReply(interaction, { content: "❌ GW Hosts only.", ephemeral: true });

  const user = interaction.options.getUser("user") || interaction.user;
  const count = Number(qGetVouches.get(user.id)?.count ?? 0);
  const e = fdEmbed("⭐ Vouch Check", `**User:** ${user.username}\n**Vouches:** ${count.toLocaleString()}`);
  return interaction.reply({ embeds: [e] }).catch(() => {});
}

    if (interaction.commandName === "vouch") {
      if (!isFDPerms(member)) return safeReply(interaction, { content: "❌ No permission.", ephemeral: true });

      const sub = interaction.options.getSubcommand();
      const user = interaction.options.getUser("user", true);

      if (sub === "give") {
        const amt = interaction.options.getInteger("amount", true);
        qAddVouches.run(user.id, Number(amt) || 0);

        const e = fdEmbed("✅ Vouches Added", `**User:** ${user.username}\n**Amount:** +${amt}\n**By:** ${interaction.user.username}`);
        await interaction.reply({ embeds: [e] }).catch(() => {});
        return sendLog(interaction.guild, e);
      }

      if (sub === "remove") {
        const amt = interaction.options.getInteger("amount", true);
        qAddVouches.run(user.id, -(Number(amt) || 0));

        // clamp to 0 if negative
        const nowCount = Number(qGetVouches.get(user.id)?.count ?? 0);
        if (nowCount < 0) qSetVouches.run(user.id, 0);

        const e = fdEmbed("❌ Vouches Removed", `**User:** ${user.username}\n**Amount:** -${amt}\n**By:** ${interaction.user.username}`);
        await interaction.reply({ embeds: [e] }).catch(() => {});
        return sendLog(interaction.guild, e);
      }

      if (sub === "clear") {
        qSetVouches.run(user.id, 0);
        const e = fdEmbed("🧹 Vouches Cleared", `**User:** ${user.username}\n**By:** ${interaction.user.username}`);
        await interaction.reply({ embeds: [e] }).catch(() => {});
        return sendLog(interaction.guild, e);
      }
    }

    if (interaction.commandName === "setmatch") {
      if (!isOwnerRole(member)) return safeReply(interaction, { content: "❌ Owner only.", ephemeral: true });

      const matchName = interaction.options.getString("match", true);
      const teams = parseTeams(matchName);
      if (teams.length < 2) return safeReply(interaction, { content: "❌ Format must be: TeamA Vs TeamB", ephemeral: true });

      const m = setActiveMatch(matchName, teams);
      const e = fdEmbed("⚽ Match Set", `**Match:** ${m.name}\n**Teams:** ${teams.join(" vs ")}\n\nPredictions are **OPEN**.`);
      await interaction.reply({ embeds: [e] }).catch(() => {});
      return sendLog(interaction.guild, e);
    }

    if (interaction.commandName === "predict") {
      if (interaction.channelId !== MATCHBET_CHANNEL_ID) {
        return safeReply(interaction, { content: `❌ Use /predict in <#${MATCHBET_CHANNEL_ID}> only.`, ephemeral: true });
      }

      const active = getActiveMatch();
      const rows = makePredictComponents(interaction.guildId, interaction.user.id, active?.matchId || null);

      const e = fdEmbed(
        "⚽ Match Prediction",
        active
          ? `**Active Match:** ${active.name}\n\nSelect the match and your side below.`
          : `**No active match set.**\nAsk owner to run **/setmatch** first.`
      );

      predictSessions.set(`${interaction.guildId}:${interaction.user.id}`, {
        matchId: active?.matchId || null,
        matchName: active?.name || null,
        team: null,
        createdAt: Date.now(),
      });

      return interaction.reply({ embeds: [e], components: rows, ephemeral: true, allowedMentions: { parse: ["users"] } }).catch(() => {});
    }

    if (interaction.commandName === "predictions") {
      if (!canUsePredictions(member)) return safeReply(interaction, { content: "❌ No permission.", ephemeral: true });
      if (interaction.channelId !== MATCHBET_CHANNEL_ID) {
        return safeReply(interaction, { content: `❌ Use /predictions in <#${MATCHBET_CHANNEL_ID}> only.`, ephemeral: true });
      }

      const active = getActiveMatch();
      if (!active || active.teams.length < 2) return safeReply(interaction, { content: "❌ No active match set.", ephemeral: true });

      const filterRaw = (interaction.options.getString("team") || "").trim();
      let filterTeam = null;

      if (filterRaw) {
        filterTeam = active.teams.find((t) => t.toLowerCase() === filterRaw.toLowerCase());
        if (!filterTeam) {
          return safeReply(interaction, {
            content: `❌ Invalid team. Choose: **${active.teams[0]}** or **${active.teams[1]}**`,
            ephemeral: true,
          });
        }
      }

      await interaction.guild.members.fetch().catch(() => {});
      const sessionId = `${interaction.guildId}_${interaction.channelId}_${Date.now()}`;
      predictionPages.set(sessionId, { matchId: active.matchId, matchName: active.name, createdAt: Date.now(), filterTeam });

      const { embed, totalPages, pageIndex } = buildPredictionsEmbed(interaction.guild, active, 0, filterTeam);
      const row = makePredButtons(sessionId, pageIndex, totalPages);

      // auto-expire session
      setTimeout(() => predictionPages.delete(sessionId), SESSION_TTL_MS);

      return interaction.reply({ embeds: [embed], components: totalPages > 1 ? [row] : [], allowedMentions: { parse: [] } }).catch(() => {});
    }

    if (interaction.commandName === "matchstats") {
      if (interaction.channelId !== MATCHBET_CHANNEL_ID) {
        return safeReply(interaction, { content: `❌ Use /matchstats in <#${MATCHBET_CHANNEL_ID}> only.`, ephemeral: true });
      }
      const active = getActiveMatch();
      if (!active || active.teams.length < 2) return safeReply(interaction, { content: "❌ No active match set.", ephemeral: true });

      const e = buildMatchStatsEmbed(active);
      return interaction.reply({ embeds: [e] }).catch(() => {});
    }

    if (interaction.commandName === "profile") {
      await interaction.guild.members.fetch().catch(() => {});
      const user = interaction.options.getUser("user") || interaction.user;
      const e = buildProfileEmbed(interaction.guild, user.id);
      return interaction.reply({ embeds: [e], allowedMentions: { parse: [] } }).catch(() => {});
    }

    if (interaction.commandName === "result") {
      if (!isFDPerms(member)) return safeReply(interaction, { content: "❌ No permission.", ephemeral: true });

      const winner = interaction.options.getString("winner", true);
      const active = getActiveMatch();

      const e = fdEmbed("🏆 Match Result", `**Match:** ${active?.name || "N/A"}\n**Winner:** ${winner}`);
      await interaction.reply({ embeds: [e] }).catch(() => {});
      await sendLog(interaction.guild, e);

      // close match (just clears active flag)
      clearActiveMatch();
      return;
    }

    if (interaction.commandName === "afk") {
      const reason = interaction.options.getString("reason") || "No reason";
      qSetAfk.run(interaction.user.id, reason, Date.now());
      const e = fdEmbed(`${interaction.user.username} is in AFK mode!`, `**Reason:** ${reason}`);
      return interaction.reply({ embeds: [e] }).catch(() => {});
    }

    // /say — fixed to never crash (deferReply prevents "Unknown interaction")
    if (interaction.commandName === "say") {
      if (!isFDPerms(member)) {
        return safeReply(interaction, { content: "❌ No permission.", ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      const channel = interaction.options.getChannel("channel") || interaction.channel;
      const text = interaction.options.getString("message", true);

      if (![ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread].includes(channel.type)) {
        return interaction.editReply("❌ Unsupported channel type.").catch(() => {});
      }

      try {
        await channel.send(text);
        await interaction.editReply("✅ Sent.").catch(() => {});
      } catch {
        return interaction.editReply("❌ Failed to send.").catch(() => {});
      }

      const log = fdEmbed(
        "🗣️ /say used",
        `**By:** <@${interaction.user.id}>\n**Channel:** <#${channel.id}>\n**Message:**\n${text.length > 900 ? text.slice(0, 900) + "..." : text}`
      );
      await sendLog(interaction.guild, log);
      return;
    }

    if (interaction.commandName === "dm") {
      if (!isFDPerms(member)) return safeReply(interaction, { content: "❌ No permission.", ephemeral: true });

      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      const user = interaction.options.getUser("user", true);
      const text = interaction.options.getString("message", true);

      try {
        await user.send(text);
        await interaction.editReply("✅ DM sent.").catch(() => {});
      } catch {
        await interaction.editReply("❌ Failed to DM (user might have DMs off).").catch(() => {});
      }
      return;
    }

    if (interaction.commandName === "staff") {
      try {
        const embeds = await buildStaffTeamEmbeds(interaction.guild);
        await interaction.reply({ embeds: [embeds[0]], allowedMentions: { parse: ["users"] } }).catch(() => {});
        for (let i = 1; i < embeds.length; i++) {
          await interaction.followUp({ embeds: [embeds[i]], allowedMentions: { parse: ["users"] } }).catch(() => {});
        }
      } catch (e) {
        console.error("staff error:", e);
        return safeReply(interaction, { content: "❌ Staff list failed.", ephemeral: true });
      }
      return;
    }

    if (["resetall", "resetvouches", "resetmatch", "resetafk"].includes(interaction.commandName)) {
      if (!isOwnerRole(member)) return safeReply(interaction, { content: "❌ Owner only.", ephemeral: true });

      if (interaction.commandName === "resetall") {
        qResetVouches.run();
        qResetAfk.run();
        qResetBlacklist.run();
        qResetMatches.run();
        qResetMatchTeams.run();
        qResetMatchesTable.run();
      }
      if (interaction.commandName === "resetvouches") qResetVouches.run();
      if (interaction.commandName === "resetafk") qResetAfk.run();
      if (interaction.commandName === "resetmatch") {
        qResetMatches.run();
        qResetMatchTeams.run();
        qResetMatchesTable.run();
      }

      const e = fdEmbed("♻️ Reset", `Completed: **${interaction.commandName}**`);
      await interaction.reply({ embeds: [e] }).catch(() => {});
      return sendLog(interaction.guild, e);
    }

    if (interaction.commandName === "blacklist") {
      if (!isOwnerOrBotOwner(member)) return safeReply(interaction, { content: "❌ Owner only.", ephemeral: true });

      const sub = interaction.options.getSubcommand();

      if (sub === "add") {
        const user = interaction.options.getUser("user", true);
        qAddBlacklist.run(user.id);
        return interaction.reply({ content: `🚫 ${user.username} has been blacklisted.` }).catch(() => {});
      }

      if (sub === "remove") {
        const user = interaction.options.getUser("user", true);
        qDelBlacklist.run(user.id);
        return interaction.reply({ content: `✅ ${user.username} removed from blacklist.` }).catch(() => {});
      }

      if (sub === "list") {
        const rows = qListBlacklist.all();
        if (!rows.length) return interaction.reply({ content: "📄 Blacklist is empty." }).catch(() => {});
        const list = rows.map((r) => `<@${r.user_id}>`).join("\n");
        return interaction.reply({ embeds: [fdEmbed("🚫 Blacklisted Users", list)], allowedMentions: { parse: [] } }).catch(() => {});
      }
    }
  } catch (err) {
    console.error("interactionCreate error:", err);
    // don't crash, try to tell user if possible
    try {
      if (interaction && interaction.isRepliable()) {
        await safeReply(interaction, { content: "❌ Something went wrong (but bot stayed online).", ephemeral: true });
      }
    } catch {}
  }
  if (interaction.commandName === "adminpredict") {

  const member = interaction.member;

  const allowed =
    member.id === BOT_OWNER_USER_ID ||
    member.roles.cache.has(FD_PERMS_ROLE_ID) ||
    member.roles.cache.has(TRIAL_ADMIN_ROLE_ID) ||
    member.roles.cache.has(ROLE_ADMIN) ||
    member.roles.cache.has(ROLE_HEAD_ADMIN);

  if (!allowed) {
    return interaction.reply({ content: "❌ No permission.", ephemeral: true });
  }

  const user = interaction.options.getUser("user");
  const team = interaction.options.getString("team");
  const bet = interaction.options.getString("bet");
  const reason = interaction.options.getString("reason") || "Staff override";

  if (!currentMatch) {
    return interaction.reply({ content: "❌ No active match.", ephemeral: true });
  }

  if (predictions.has(user.id)) {
    return interaction.reply({
      content: "❌ That user already predicted.",
      ephemeral: true
    });
  }

  predictions.set(user.id, {
    team: team,
    bet: bet
  });

  const teamName = team === "A" ? currentMatch.teamA : currentMatch.teamB;

  await interaction.channel.send({
    content: `🛠️ **Admin Prediction Added**\n<@${user.id}> predicted **${teamName}**\nBet: **${bet}**\nReason: ${reason}`,
    allowedMentions: { users: [user.id] }
  });

  try {
    await updateMatchEmbed();
  } catch {}

  return interaction.reply({
    content: "✅ Prediction added.",
    ephemeral: true
  });
}
});

/* =========================
   PREFIX COMMANDS + AFK PINGS
========================= */
client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot || !message.guild) return;
// put this near the TOP of messageCreate, after the basic guards:
// if (message.author.bot || !message.guild) return;
// if (BOT_DISABLED) return;
// if (isBlacklisted(message.author.id)) return;

if (message.content.trim().toLowerCase() === "fz.reload") {
  // owner-only
  const member = message.member;
  const allowed = member?.id === BOT_OWNER_USER_ID || member?.roles?.cache?.has(OWNER_ROLE_ID);
  if (!allowed) return;

  // react then exit so your process manager restarts it
  await message.react("✅").catch(() => {});
  setTimeout(() => process.exit(0), 400); // small delay so reaction shows
  return;
}
    // Global blacklist block
    if (isBlacklisted(message.author.id)) return;

    // AFK notice — ONLY for real @mentions (NOT reply pings)
    if (message.mentions.users.size > 0) {
      const repliedUser = message.mentions.repliedUser; // may be null
      const mentioned = [...message.mentions.users.values()].filter((u) => u.id !== repliedUser?.id);

      for (const user of mentioned) {
        const afkData = qGetAfk.get(user.id);
        if (!afkData) continue;

        const e = fdEmbed(`${user.username} is in AFK mode!`, `**Reason:** ${afkData.reason || "No reason"}`);
        message.channel.send({ embeds: [e] }).catch(() => {});
      }
    }

    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const cmd = (args.shift() || "").toLowerCase();
    const member = message.member;

    // !blacklist add/remove/list — OWNER ONLY
    if (cmd === "blacklist") {
      if (!isOwnerOrBotOwner(member)) return;
      message.delete().catch(() => {});

      const sub = (args[0] || "").toLowerCase();
      const target = message.mentions.users.first();
      if (sub === "add" && target) {
        qAddBlacklist.run(target.id);
        return sendTemp(message.channel, { content: `🚫 ${target.username} has been blacklisted.` }, 5000);
      }

      if (sub === "remove" && target) {
        qDelBlacklist.run(target.id);
        return sendTemp(message.channel, { content: `✅ ${target.username} removed from blacklist.` }, 5000);
      }

      if (sub === "list") {
        const rows = qListBlacklist.all();
        if (!rows.length) return sendTemp(message.channel, { content: "📄 Blacklist is empty." }, 5000);
        const list = rows.map((r) => `<@${r.user_id}>`).join("\n");
        return message.channel.send({ embeds: [fdEmbed("🚫 Blacklisted Users", list)], allowedMentions: { parse: [] } }).catch(() => {});
      }

      return sendTemp(message.channel, { content: "❌ Usage: !blacklist add @user | remove @user | list" }, 5000);
    }
// ===== !nuke (3 REAL separate pings, auto delete) =====
// Usage: !nuke @user [seconds]
if (cmd === "nuke") {
  const allowed =
    member.id === BOT_OWNER_USER_ID ||
    member.roles.cache.has(ROLE_HEAD_ADMIN) ||
    member.roles.cache.has(ROLE_ADMIN) ||
    member.roles.cache.has(FD_PERMS_ROLE_ID) ||
   member.roles.cache.has(ROLE_TRIAL_ADMIN);
  if (!allowed) return;

  message.delete().catch(() => {});

  const target = message.mentions.users.first();
  if (!target) return;

  const seconds = Math.max(3, Math.min(parseInt(args[0], 10) || 10, 60));

  const sentMessages = [];

  // Send 3 REAL pings (separate messages)
  for (let i = 0; i < 25; i++) {
    const msg = await message.channel.send({
      content: `<@${target.id}> 💥`,
      allowedMentions: { users: [target.id] }
    }).catch(() => null);

    if (msg) sentMessages.push(msg);
  }

  // Auto delete after X seconds
  setTimeout(() => {
    for (const m of sentMessages) {
      m.delete().catch(() => {});
    }
  }, seconds * 1000);

  return;
}

 // ===== !goon (TROLL COMMAND – OPTION A, MESSAGE CONTENT VIDEO) =====
if (cmd === "goon") {
  message.delete().catch(() => {});

  const target = message.mentions.users.first();
  if (!target) return;

  const allowed =
    member.id === BOT_OWNER_USER_ID ||
    member.roles.cache.has(FD_PERMS_ROLE_ID) ||
    member.roles.cache.has(ROLE_HEAD_ADMIN) ||
    member.roles.cache.has(ROLE_ADMIN);

  if (!allowed) return;

  const wall = Array(10).fill("💦").join(" ");

  message.channel.send({
    content: `
${wall}
💦 **GOONING ON <@${target.id}>** 💦
${wall}

https://media.tenor.com/zt-J3QJoWbEAAAPo/licka.mp4
`,
    allowedMentions: { users: [target.id] }
  }).catch(() => {});

  return;
}
// ===== !nukefart (3 separate pings + fart chaos, auto delete) =====
// Usage: !nukefart @user [seconds]
if (cmd === "nukefart") {
  const allowed =
    member.id === BOT_OWNER_USER_ID ||
    member.roles.cache.has(ROLE_HEAD_ADMIN) ||
    member.roles.cache.has(ROLE_ADMIN) ||
    member.roles.cache.has(FD_PERMS_ROLE_ID);

  if (!allowed) return;

  message.delete().catch(() => {});

  const target = message.mentions.users.first();
  if (!target) {
    return message.channel.send("❌ Usage: !nukefart @user [seconds]").catch(() => {});
  }

  // seconds is usually after the mention: args[1]
  const maybeSeconds = args.find((x) => /^\d+$/.test(x)); // grabs first number anywhere
  const seconds = Math.max(3, Math.min(parseInt(maybeSeconds || "10", 10), 60));

  const sentMessages = [];

  for (let i = 0; i < 25; i++) {
    const msg = await message.channel.send({
      content: `<@${target.id}> 💥💨💦 BOOM FART NUKE 💦💨💥`,
      allowedMentions: { users: [target.id] },
    }).catch(() => null);

    if (msg) sentMessages.push(msg);
  }

  setTimeout(() => {
    for (const m of sentMessages) m.delete().catch(() => {});
  }, seconds * 1000);

  return;
}
if (cmd === "fzanalyzedb") {

  const allowed =
    message.author.id === BOT_OWNER_USER_ID ||
    member.roles.cache.has(ROLE_ADMIN) ||
    member.roles.cache.has(ROLE_HEAD_ADMIN);

  if (!allowed) return;

  const start = Date.now();

  try {
    await new Promise((resolve, reject) => {
      db.get("SELECT 1", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const time = Date.now() - start;

    return message.reply({
      content: `📊 Analyzed database in **${time}ms**.`,
      allowedMentions: { repliedUser: false }
    });

  } catch (err) {
    console.error(err);

    return message.reply({
      content: "❌ Database error (check console).",
      allowedMentions: { repliedUser: true }
    });
  }
}
    // !lv (delete)
  if (cmd === "lv") {
  if (!canUseLv(member)) return;
  message.delete().catch(() => {});

  const pages = await buildLeaderboardPages(message.guild);
  const sessionId = `${message.guild.id}_${message.channel.id}_lb_${Date.now()}`;
  leaderboardPages.set(sessionId, { createdAt: Date.now() });

  setTimeout(() => leaderboardPages.delete(sessionId), SESSION_TTL_MS);

  const row = pages.length > 1 ? [makeLbButtons(sessionId, 0, pages.length)] : [];
  return message.channel.send({ embeds: [pages[0]], components: row, allowedMentions: { parse: [] } }).catch(() => {});
}

    // !checkvouch (delete)
    if (cmd === "checkvouch" || cmd === "check-vouch") {
  if (!canUseLv(member)) return;
  message.delete().catch(() => {});
  const target = message.mentions.users.first() || message.author;
  const count = Number(qGetVouches.get(target.id)?.count ?? 0);
  const e = fdEmbed("⭐ Vouch Check", `**User:** ${target.username}\n**Vouches:** ${count.toLocaleString()}`);
  return message.channel.send({ embeds: [e] }).catch(() => {});
}

    // VOUCH COMMANDS (delete) — FD perms (includes trial admin)
    if (cmd === "v-give") {
      if (!isFDPerms(member)) return;
      message.delete().catch(() => {});
      const target = message.mentions.users.first();
      const amt = parseInt(args[1], 10);
      if (!target || !Number.isFinite(amt)) return;
      qAddVouches.run(target.id, amt);

      const e = fdEmbed("✅ Vouches Added", `**User:** ${target.username}\n**Amount:** +${amt}\n**By:** ${message.author.username}`);
      message.channel.send({ embeds: [e] }).catch(() => {});
      return sendLog(message.guild, e);
    }

    if (cmd === "v-remove") {
      if (!isFDPerms(member)) return;
      message.delete().catch(() => {});
      const target = message.mentions.users.first();
      const amt = parseInt(args[1], 10);
      if (!target || !Number.isFinite(amt)) return;
      qAddVouches.run(target.id, -amt);

      const nowCount = Number(qGetVouches.get(target.id)?.count ?? 0);
      if (nowCount < 0) qSetVouches.run(target.id, 0);

      const e = fdEmbed("❌ Vouches Removed", `**User:** ${target.username}\n**Amount:** -${amt}\n**By:** ${message.author.username}`);
      message.channel.send({ embeds: [e] }).catch(() => {});
      return sendLog(message.guild, e);
    }

    if (cmd === "v-clear") {
      if (!isFDPerms(member)) return;
      message.delete().catch(() => {});
      const target = message.mentions.users.first();
      if (!target) return;
      qSetVouches.run(target.id, 0);

      const e = fdEmbed("🧹 Vouches Cleared", `**User:** ${target.username}\n**By:** ${message.author.username}`);
      message.channel.send({ embeds: [e] }).catch(() => {});
      return sendLog(message.guild, e);
    }

    // !profile [@user]
    if (cmd === "profile") {
      message.delete().catch(() => {});
      await message.guild.members.fetch().catch(() => {});
      const target = message.mentions.users.first() || message.author;
      const e = buildProfileEmbed(message.guild, target.id);
      return message.channel.send({ embeds: [e], allowedMentions: { parse: [] } }).catch(() => {});
    }

    // !matchstats
    if (cmd === "matchstats") {
      message.delete().catch(() => {});
      if (message.channel.id !== MATCHBET_CHANNEL_ID) {
        return sendTemp(message.channel, { content: `❌ Use !matchstats in <#${MATCHBET_CHANNEL_ID}> only.` }, 5000);
      }
      const active = getActiveMatch();
      if (!active || active.teams.length < 2) return sendTemp(message.channel, { content: "❌ No active match set." }, 5000);
      const e = buildMatchStatsEmbed(active);
      return message.channel.send({ embeds: [e] }).catch(() => {});
    }

    // !afk (delete)
    if (cmd === "afk") {
      message.delete().catch(() => {});
      const reason = args.join(" ") || "No reason";
      qSetAfk.run(message.author.id, reason, Date.now());
      const e = fdEmbed(`${message.author.username} is in AFK mode!`, `**Reason:** ${reason}`);
      return message.channel.send({ embeds: [e] }).catch(() => {});
    }

    // !unafk (manual AFK removal)
    if (cmd === "unafk") {
      message.delete().catch(() => {});
      const afk = qGetAfk.get(message.author.id);
      if (!afk) {
        return message.channel
          .send({ content: "❌ You are not AFK." })
          .then((m) => setTimeout(() => m.delete().catch(() => {}), 3000))
          .catch(() => {});
      }

      qDelAfk.run(message.author.id);
      const e = fdEmbed(`${message.author.username} Welcome back from AFK!`, ``);
      return message.channel
        .send({ embeds: [e] })
        .then((m) => setTimeout(() => m.delete().catch(() => {}), 3000))
        .catch(() => {});
    }

    // !staff (delete)
    if (cmd === "staff") {
      message.delete().catch(() => {});
      try {
        const embeds = await buildStaffTeamEmbeds(message.guild);
        for (const e of embeds) {
          await message.channel.send({ embeds: [e], allowedMentions: { parse: ["users"] } });
        }
      } catch (e) {
        console.error("!staff error:", e);
        message.channel.send("❌ Staff list failed.").catch(() => {});
      }
      return;
    }

// ===== !say (FD perms) - supports channel + replying (message id/link or reply context) =====
// Usage:
//   !say hello
//   !say #channel hello
//   !say reply:123456789012345678 hello
//   !say reply:https://discord.com/channels/GUILD/CHANNEL/MESSAGE hello
if (cmd === "say") {
  if (!isFDPerms(member)) return;
  message.delete().catch(() => {});

  let targetChannel = message.channel;
  let start = 0;

  // Optional channel as first arg: <#id>
  const first = args[0];
  const chMatch = first && first.match(/^<#(\d+)>$/);
  if (chMatch) {
    const ch = message.guild.channels.cache.get(chMatch[1]);
    if (ch) {
      targetChannel = ch;
      start = 1;
    }
  }

  // Optional reply token: reply:<id or link>
  let replyTo = null;
  const maybeReply = args[start];
  if (maybeReply && maybeReply.toLowerCase().startsWith("reply:")) {
    const raw = maybeReply.slice("reply:".length);

    // message link -> grab last number
    const linkMatch = raw.match(/\/(\d{15,25})$/);
    const idMatch = raw.match(/^(\d{15,25})$/);

    replyTo = (linkMatch && linkMatch[1]) || (idMatch && idMatch[1]) || null;
    start += 1;
  } else if (message.reference?.messageId) {
    // If you used !say while replying to a message, auto reply to that
    replyTo = message.reference.messageId;
  }

  const text = args.slice(start).join(" ");
  if (!text) return;

  try {
    if (replyTo) {
      // try fetch the replied message in the target channel
      const repliedMsg = await targetChannel.messages.fetch(replyTo).catch(() => null);
      if (repliedMsg) {
        await repliedMsg.reply({ content: text, allowedMentions: { parse: ["users", "roles"] } }).catch(() => {});
      } else {
        // fallback: just send
        await targetChannel.send({ content: text, allowedMentions: { parse: ["users", "roles"] } }).catch(() => {});
      }
    } else {
      await targetChannel.send({ content: text, allowedMentions: { parse: ["users", "roles"] } }).catch(() => {});
    }

    // log
    const log = fdEmbed(
      "🗣️ !say used",
      `**By:** <@${message.author.id}>\n**Channel:** <#${targetChannel.id}>\n**Reply:** ${replyTo ? `\`${replyTo}\`` : "None"}\n**Message:**\n${
        text.length > 900 ? text.slice(0, 900) + "..." : text
      }`
    );
    await sendLog(message.guild, log);
  } catch {}

  return;
}

    if (cmd === "dm") {
      if (!isFDPerms(member)) return;
      message.delete().catch(() => {});
      const target = message.mentions.users.first();
      if (!target) return;
      const text = args.slice(1).join(" ");
      if (!text) return;

      await target.send(text).catch(() => {});
      const log = fdEmbed("📩 !dm used", `**By:** <@${message.author.id}>\n**To:** <@${target.id}>\n**Message:**\n${text.length > 900 ? text.slice(0, 900) + "..." : text}`);
      await sendLog(message.guild, log);
      return;
    }

    // Owner-only resets + setmatch (BOTH owner role + bot owner)
    if (cmd === "resetall" || cmd === "resetvouches" || cmd === "resetmatch" || cmd === "resetafk") {
      if (!isOwnerRole(member)) return;
      message.delete().catch(() => {});

      if (cmd === "resetall") {
        qResetVouches.run();
        qResetAfk.run();
        qResetBlacklist.run();
        qResetMatches.run();
        qResetMatchTeams.run();
        qResetMatchesTable.run();
      }
      if (cmd === "resetvouches") qResetVouches.run();
      if (cmd === "resetafk") qResetAfk.run();
      if (cmd === "resetmatch") {
        qResetMatches.run();
        qResetMatchTeams.run();
        qResetMatchesTable.run();
      }

      const e = fdEmbed("♻️ Reset", `Completed: **${cmd}**`);
      message.channel.send({ embeds: [e] }).catch(() => {});
      return sendLog(message.guild, e);
    }

    if (cmd === "setmatch") {
      if (!isOwnerRole(member)) return;
      message.delete().catch(() => {});

      const matchName = args.join(" ");
      if (!matchName) return;

      const teams = parseTeams(matchName);
      if (teams.length < 2) {
        return sendTemp(message.channel, { content: "❌ Format must be: TeamA Vs TeamB" }, 5000);
      }

      const m = setActiveMatch(matchName, teams);
      const e = fdEmbed("⚽ Match Set", `**Match:** ${m.name}\n**Teams:** ${teams[0]} vs ${teams[1]}\n\nPredictions are **OPEN**.`);
      message.channel.send({ embeds: [e] }).catch(() => {});
      return sendLog(message.guild, e);
    }

    if (cmd === "result") {
      if (!isFDPerms(member)) return;
      message.delete().catch(() => {});
      const winner = args.join(" ") || "N/A";
      const active = getActiveMatch();

      const e = fdEmbed("🏆 Match Result", `**Match:** ${active?.name || "N/A"}\n**Winner:** ${winner}`);
      message.channel.send({ embeds: [e] }).catch(() => {});
      sendLog(message.guild, e).catch(() => {});

      clearActiveMatch();
      return;
    }

    // !predict (quick text) — one bet only + channel restricted + avatar in embed
    if (cmd === "predict") {
      message.delete().catch(() => {});

      if (message.channel.id !== MATCHBET_CHANNEL_ID) {
        return sendTemp(message.channel, { content: `❌ Use !predict in <#${MATCHBET_CHANNEL_ID}> only.` }, 5000);
      }

      const active = getActiveMatch();
      if (!active || active.teams.length < 2) {
        return sendTemp(message.channel, { content: "❌ No active match set." }, 5000);
      }

      const pickRaw = args[0];
      if (!pickRaw) {
        return sendTemp(message.channel, { content: `❌ Usage: !predict ${active.teams[0]} (bet optional)` }, 5000);
      }

      const pick = active.teams.find((t) => t.toLowerCase() === pickRaw.toLowerCase());
      if (!pick) {
        return sendTemp(message.channel, {
          content: `❌ Invalid team.\nChoose one of: **${active.teams[0]}** or **${active.teams[1]}**`,
        }, 5000);
      }

      const bet = args.slice(1).join(" ") || "None";
      const ok = savePrediction(active.matchId, message.author.id, pick, bet);

      if (!ok) {
        return sendTemp(message.channel, { content: `❌ You already placed a bet for **${active.name}** and can’t change it.` }, 5000);
      }

      const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle(`${active.name}  Match\nPrediction`)
        .setDescription(`**Prediction:** ${pick}\n**Bet:** ${bet}\n**Please wait until the end of the match.**`)
        .setThumbnail(message.author.displayAvatarURL({ size: 256, extension: "png" }))
        .setFooter({ text: `Futzone Prediction by ${message.author.username}` })
        .setTimestamp();

      return message.channel.send({ embeds: [embed] }).catch(() => {});
    }
if (cmd === "fart") {
  message.delete().catch(() => {});

  const target = message.mentions.users.first() || message.author;

  const msg =
    target.id === message.author.id
      ? `💨 <@${message.author.id}> farted… on themselves. nasty 😭`
      : `💨 <@${message.author.id}> farted on <@${target.id}> 😭`;

  return message.channel.send({
    content: msg,
    allowedMentions: { users: [message.author.id, target.id] },
  }).catch(() => {});
}
// ===== !react (FD perms) - react to a message by reply, id, or link =====
// Usage:
//   (reply to a message) !react 😂
//   !react 123456789012345678 😂
//   !react https://discord.com/channels/GUILD/CHANNEL/MESSAGE 😂
if (cmd === "react") {
  if (!isFDPerms(member)) return;
  message.delete().catch(() => {});

  let targetMsgId = null;
  let emoji = null;

  // If user replied to a message, use that
  if (message.reference?.messageId) {
    targetMsgId = message.reference.messageId;
    emoji = args.join(" ");
  } else {
    const first = args[0];
    const second = args[1];

    // first can be message id or link
    const linkMatch = first && first.match(/\/(\d{15,25})$/);
    const idMatch = first && first.match(/^(\d{15,25})$/);

    targetMsgId = (linkMatch && linkMatch[1]) || (idMatch && idMatch[1]) || null;
    emoji = (targetMsgId ? (second || "") : first) + (targetMsgId && args.slice(2).length ? " " + args.slice(2).join(" ") : "");
    emoji = emoji.trim();
  }

  if (!targetMsgId || !emoji) return;

  try {
    const msgToReact = await message.channel.messages.fetch(targetMsgId).catch(() => null);
    if (!msgToReact) return;

    await msgToReact.react(emoji).catch(() => {});
    // optional log
    const log = fdEmbed("💠 !react used", `**By:** <@${message.author.id}>\n**Message ID:** \`${targetMsgId}\`\n**Emoji:** ${emoji}`);
    await sendLog(message.guild, log);
  } catch {}

  return;
}
const RULES_CHANNEL_ID = "1270752793119948904"; 

async function sendRuleBook() {
    try {
        const channel = await client.channels.fetch(RULES_CHANNEL_ID).catch(() => null);
        if (!channel) return console.log("ERROR: Rules channel not found.");

        // Clean up previous bot messages to keep it 1:1
        const messages = await channel.messages.fetch({ limit: 50 });
        const oldRules = messages.filter(m => m.author.id === client.user.id);
        
        if (oldRules.size > 0) {
            await channel.bulkDelete(oldRules).catch(() => null);
        }

        const rulesEmbed = new EmbedBuilder()
            .setColor("#0f172a")
            .setTitle("⚽ Futzone | Official Server Rules")
            .setDescription(`
**1. Racism** - 24h Mute.
**2. Malicious Racism** - 1 Week Mute / Ban.
**3. Pinging to Annoy** - 24h Mute.
**4. Bypassing Wick** - 24h Mute to 1 Week (Depends on severity).
**5. Staff Pings** - Only ping if you need help. If they are in chat, you can ping them.
**6. Swearing** - Allowed, but abusing/insulting people results in a 1 Week Ban.
**7. English Only** - All conversations must be in English for moderation.
**8. Bot Usage** - Do **NOT** use Dexbot, Soccer Guru, or other game bots outside of their designated channels.
**9. Football Toxicity** - Respect all clubs/players. Toxic trolling or excessive abuse results in a mute.

---
**Appeals:**
If you feel you were unfairly punished, you can fight your case with:
**Alfie** or **Snape**
            `)
            .setFooter({ text: "Futzone Rules •" })
            .setTimestamp();

        await channel.send({ embeds: [rulesEmbed] });
        console.log("Rules posted successfully.");
    } catch (err) {
        console.error("Rules Error:", err);
    }
}

// Add this to your messageCreate handler for manual updates
if (cmd === "rules") {
    if (!isFDPerms(message.member)) return;
    await sendRuleBook();
    message.reply("✅ Rules updated.").then(m => setTimeout(() => m.delete(), 5000));
}
    // !predictions [team...] (PAGINATED + PERMS + FILTER)
    if (cmd === "predictions") {
      if (!canUsePredictions(member)) return;
      message.delete().catch(() => {});
      if (message.channel.id !== MATCHBET_CHANNEL_ID) {
        return sendTemp(message.channel, { content: `❌ Use !predictions in <#${MATCHBET_CHANNEL_ID}> only.` }, 5000);
      }

      const active = getActiveMatch();
      if (!active || active.teams.length < 2) return sendTemp(message.channel, { content: "❌ No active match set." }, 5000);

      const filterRaw = args.join(" ").trim();
      let filterTeam = null;

      if (filterRaw) {
        filterTeam = active.teams.find((t) => t.toLowerCase() === filterRaw.toLowerCase());
        if (!filterTeam) {
          return sendTemp(message.channel, { content: `❌ Invalid team. Choose: **${active.teams[0]}** or **${active.teams[1]}**` }, 5000);
        }
      }

      await message.guild.members.fetch().catch(() => {});

      const sessionId = `${message.guild.id}_${message.channel.id}_${Date.now()}`;
      predictionPages.set(sessionId, { matchId: active.matchId, matchName: active.name, createdAt: Date.now(), filterTeam });

      const { embed, totalPages, pageIndex } = buildPredictionsEmbed(message.guild, active, 0, filterTeam);
      const row = makePredButtons(sessionId, pageIndex, totalPages);

      setTimeout(() => predictionPages.delete(sessionId), SESSION_TTL_MS);

      return message.channel
        .send({ embeds: [embed], components: totalPages > 1 ? [row] : [], allowedMentions: { parse: [] } })
        .catch(() => {});
    }
  } catch (err) {
    console.error("messageCreate error:", err);
  }
});

/* =========================
   ANTI-CRASH GUARDS
========================= */
process.on("unhandledRejection", (err) => console.error("UnhandledRejection:", err));
process.on("uncaughtException", (err) => console.error("UncaughtException:", err));
client.on("error", (err) => console.error("ClientError:", err));

/* =========================
   START
========================= */
client.login(process.env.TOKEN);