const AVATAR_PALETTE = [
  "#4f5bed",
  "#2aa36b",
  "#e2558a",
  "#f0a43a",
  "#e26d4a",
  "#2f88d8",
  "#8b62d9",
  "#1aa7a1",
];

export function avatarColor(userId?: string): string {
  const s = userId || "";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

export function avatarInitial(userId?: string): string {
  const s = (userId || "").trim();
  return s ? s[0].toUpperCase() : "消";
}

export function authorName(userId?: string, currentUserId = "444"): string {
  const s = (userId || "").trim();
  const fallback = (currentUserId || "444").trim() || "444";
  const name = s || fallback;
  return name.length > 10 ? name.slice(0, 8) + "..." : name;
}

export function shortTime(createAt?: number): string {
  if (!createAt || !Number.isFinite(createAt)) return "";
  const d = new Date(createAt);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return hh + ":" + mm;
}
