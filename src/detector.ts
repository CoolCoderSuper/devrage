import type { Severity } from "./types";

var WORDLIST = [
  // === FUCK family (strong) ===
  // Canonical forms
  { word: "fuck", severity: "strong", group: "fuck" },
  { word: "fucking", severity: "strong", group: "fuck" },
  { word: "fucked", severity: "strong", group: "fuck" },
  { word: "fucker", severity: "strong", group: "fuck" },
  { word: "fuckin", severity: "strong", group: "fuck" },
  { word: "fucks", severity: "strong", group: "fuck" },
  // Compound words
  { word: "motherfucker", severity: "strong", group: "fuck" },
  { word: "motherfucking", severity: "strong", group: "fuck" },
  { word: "mothafucka", severity: "strong", group: "fuck" },
  { word: "fuckup", severity: "strong", group: "fuck" },
  { word: "fuckoff", severity: "strong", group: "fuck" },
  { word: "clusterfuck", severity: "strong", group: "fuck" },
  { word: "fuckwit", severity: "strong", group: "fuck" },
  { word: "fucktard", severity: "strong", group: "fuck" },
  { word: "fuckface", severity: "strong", group: "fuck" },
  { word: "fuckhead", severity: "strong", group: "fuck" },
  // Typos — transpositions
  { word: "fukc", severity: "strong", group: "fuck" },
  { word: "fukcing", severity: "strong", group: "fuck" },
  { word: "fukced", severity: "strong", group: "fuck" },
  { word: "fukcer", severity: "strong", group: "fuck" },
  { word: "fcuk", severity: "strong", group: "fuck" },
  { word: "fcuking", severity: "strong", group: "fuck" },
  { word: "fcuked", severity: "strong", group: "fuck" },
  { word: "fuk", severity: "strong", group: "fuck" },
  { word: "fuking", severity: "strong", group: "fuck" },
  { word: "fuked", severity: "strong", group: "fuck" },
  { word: "fuker", severity: "strong", group: "fuck" },
  { word: "fuxk", severity: "strong", group: "fuck" },
  { word: "fuxking", severity: "strong", group: "fuck" },
  // === SHIT family (strong) ===
  { word: "shit", severity: "strong", group: "shit" },
  { word: "shitty", severity: "strong", group: "shit" },
  { word: "shitting", severity: "strong", group: "shit" },
  { word: "shits", severity: "strong", group: "shit" },
  { word: "shitted", severity: "strong", group: "shit" },
  // Compound words
  { word: "bullshit", severity: "strong", group: "shit" },
  { word: "horseshit", severity: "strong", group: "shit" },
  { word: "dipshit", severity: "strong", group: "shit" },
  { word: "shitshow", severity: "strong", group: "shit" },
  { word: "shithead", severity: "strong", group: "shit" },
  { word: "shithole", severity: "strong", group: "shit" },
  { word: "shitface", severity: "strong", group: "shit" },
  { word: "shitfaced", severity: "strong", group: "shit" },
  { word: "shitstain", severity: "strong", group: "shit" },
  { word: "shitbag", severity: "strong", group: "shit" },
  // Typos
  { word: "hsit", severity: "strong", group: "shit" },
  { word: "siht", severity: "strong", group: "shit" },
  { word: "shti", severity: "strong", group: "shit" },
  { word: "sjit", severity: "strong", group: "shit" },
  { word: "shjt", severity: "strong", group: "shit" },
  { word: "bulshit", severity: "strong", group: "shit" },
  { word: "bullsht", severity: "strong", group: "shit" },
  // === ASS family (moderate) ===
  { word: "ass", severity: "moderate", group: "ass" },
  { word: "asses", severity: "moderate", group: "ass" },
  // Compound words (these are strong)
  { word: "asshole", severity: "strong", group: "ass" },
  { word: "assholes", severity: "strong", group: "ass" },
  { word: "jackass", severity: "strong", group: "ass" },
  { word: "dumbass", severity: "strong", group: "ass" },
  { word: "fatass", severity: "moderate", group: "ass" },
  { word: "asshat", severity: "strong", group: "ass" },
  { word: "asswipe", severity: "strong", group: "ass" },
  { word: "badass", severity: "mild", group: "ass" },
  // === DAMN family (moderate) ===
  { word: "damn", severity: "moderate", group: "damn" },
  { word: "damned", severity: "moderate", group: "damn" },
  { word: "damnit", severity: "moderate", group: "damn" },
  { word: "dammit", severity: "moderate", group: "damn" },
  { word: "goddamn", severity: "moderate", group: "damn" },
  { word: "goddamnit", severity: "moderate", group: "damn" },
  { word: "goddammit", severity: "moderate", group: "damn" },
  // === BITCH family (strong) ===
  { word: "bitch", severity: "strong", group: "bitch" },
  { word: "bitches", severity: "strong", group: "bitch" },
  { word: "bitching", severity: "strong", group: "bitch" },
  { word: "bitchy", severity: "strong", group: "bitch" },
  { word: "bitchass", severity: "strong", group: "bitch" },
  // === BASTARD (strong) ===
  { word: "bastard", severity: "strong", group: "bastard" },
  { word: "bastards", severity: "strong", group: "bastard" },
  // === PISS family (moderate) ===
  { word: "piss", severity: "moderate", group: "piss" },
  { word: "pissed", severity: "moderate", group: "piss" },
  { word: "pissing", severity: "moderate", group: "piss" },
  { word: "pissoff", severity: "moderate", group: "piss" },
  // === DICK (moderate) ===
  { word: "dick", severity: "moderate", group: "dick" },
  { word: "dickhead", severity: "strong", group: "dick" },
  // === CRAP (moderate) ===
  { word: "crap", severity: "moderate", group: "crap" },
  { word: "crappy", severity: "moderate", group: "crap" },
  { word: "crapping", severity: "moderate", group: "crap" },
  // === HELL (mild) ===
  { word: "hell", severity: "mild", group: "hell" },
  // === Abbreviations (mild) ===
  { word: "wtf", severity: "mild", group: "wtf" },
  { word: "stfu", severity: "mild", group: "stfu" },
  { word: "lmfao", severity: "mild", group: "lmfao" },
  { word: "lmao", severity: "mild", group: "lmao" },
  // === CUNT (strong) ===
  { word: "cunt", severity: "strong", group: "cunt" },
  { word: "cunts", severity: "strong", group: "cunt" }
] satisfies { word: string; severity: Severity; group: string }[];
function collapseRepeats(text) {
  return text.replace(/(.)\1+/g, "$1");
}
function buildPattern(words) {
  const sorted = [...words].sort((a, b) => b.word.length - a.word.length);
  const pattern = sorted.map((w) => w.word).join("|");
  return new RegExp(`\\b(${pattern})\\b`, "gi");
}
var DEFAULT_PATTERN = buildPattern(WORDLIST);
var WORD_MAP = new Map(WORDLIST.map((w) => [w.word.toLowerCase(), w]));
export function detect(text) {
  const matches = [];
  const seen = /* @__PURE__ */ new Set();
  runPattern(text, text.toLowerCase(), matches, seen);
  const collapsed = collapseRepeats(text.toLowerCase());
  if (collapsed !== text.toLowerCase()) {
    runPattern(text, collapsed, matches, seen);
  }
  return { count: matches.length, matches };
}
function runPattern(_originalText, searchText, matches, seen) {
  DEFAULT_PATTERN.lastIndex = 0;
  let match;
  while ((match = DEFAULT_PATTERN.exec(searchText)) !== null) {
    if (seen.has(match.index)) continue;
    const word = match[0].toLowerCase();
    const entry = WORD_MAP.get(word);
    if (!entry) continue;
    seen.add(match.index);
    matches.push({
      word,
      index: match.index,
      severity: entry.severity,
      group: entry.group
    });
  }
}
