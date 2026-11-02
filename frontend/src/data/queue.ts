// Mock data for the Alert queue and Cases pages, copied from the Figma frames.
// Replace getAlertQueue()/getCases() with API calls once the backend has them.
import type { AlertQueue, Case, Cases, QueueAlert, QueueStatus, Severity } from "./types";

type Row = [
  id: string, entity: string, entityId: string, entityType: string, severity: Severity, typology: string,
  rule: string, amount: number, txCount: number, score: number, detected: string, sla: string,
  slaBreached: boolean, assignee: string | null, status: QueueStatus,
];

// The eight rows visible in the Figma frame.
const shown: Row[] = [
  ["ALT-92841", "Orion Trading FZE", "C-18842", "AE · Corporate", "Critical", "Rapid movement of funds", "TM-014 · Velocity anomaly", 482750, 12, 96, "Sep 28, 09:42", "SLA overdue · 4h 12m", true, "M. Alvarez", "Escalated"],
  ["ALT-92756", "Novara Capital SA", "C-07718", "CH · Corporate", "Critical", "Layering / circular flows", "TM-022 · Round-trip transfers", 928300, 9, 94, "Sep 28, 07:18", "SLA overdue · 2h 05m", true, null, "New"],
  ["ALT-92838", "Kofi Mensah", "C-33601", "GH · Individual", "Critical", "Structuring / smurfing", "TM-003 · Sub-threshold deposits", 74980, 8, 91, "Sep 28, 09:36", "SLA overdue · 1h 30m", true, null, "New"],
  ["ALT-92829", "Baltic Meridian OÜ", "C-48726", "EE · Corporate", "High", "High-risk jurisdiction", "GE-007 · Cross-border corridor", 1340000, 4, 88, "Sep 28, 09:27", "23 min ago", false, "D. Chiu", "In review"],
  ["ALT-92817", "Rosa Delgado", "C-21508", "PA · Individual", "High", "Unusual cash activity", "TM-031 · Profile deviation", 39600, 6, 84, "Sep 28, 09:09", "41 min ago", false, "N. Karim", "In review"],
  ["ALT-92762", "Ibrahim Hassan", "C-19924", "LB · Individual", "High", "Rapid movement of funds", "TM-014 · Velocity anomaly", 126850, 7, 83, "Sep 28, 08:42", "1h 08m ago", false, "S. Okafor", "In review"],
  ["ALT-92804", "Harborline Imports Ltd", "C-14821", "HK · Corporate", "High", "Sanctions proximity", "SN-002 · Counterparty screening", 612400, 3, 79, "Sep 28, 08:58", "52 min ago", false, "A. Patel", "Pending info"],
  ["ALT-92765", "Westbridge Services Ltd", "C-76140", "GB · Corporate", "Medium", "Dormant account activity", "TM-040 · Reactivation", 58200, 5, 67, "Sep 28, 06:31", "SLA overdue · 3h 19m", true, null, "New"],
];

const extraEntities = [
  "Nordvik Holdings AS", "Samir Haddad", "Golden Reef Mining", "Lena Vogel", "Pacific Crest Shipping",
  "Aurora Freight LLC", "Mateo Rinaldi", "Crescent Exchange LLC", "Juniper Agro Ltd", "Yusuf Demir",
  "Silverline Metals", "Priya Raman", "Kestrel Logistics BV", "Omar Farouk", "Lumen Digital Ltd",
  "Hana Kobayashi", "Tidewater Partners", "Elena Petrova", "Cobalt Ridge Inc",
];
const typologies: [string, string][] = [
  ["Rapid movement of funds", "TM-014 · Velocity anomaly"],
  ["Structuring / smurfing", "TM-003 · Sub-threshold deposits"],
  ["High-risk jurisdiction", "GE-007 · Cross-border corridor"],
  ["Unusual cash activity", "TM-031 · Profile deviation"],
];
const scores = [90, 89, 89, 88, 87, 86, 82, 81, 80, 78, 77, 76, 66, 63, 60, 55, 44, 41, 38];
const others = ["M. Alvarez", "D. Chiu", "N. Karim", "S. Okafor"];
const BREACHED = new Set([1, 7, 12]);

// The other 19 open alerts behind pages 2-4, laid out so the tab and KPI counts
// match the frame: 12 unassigned, 6 for the current user, 7 breached, 9 critical.
const extra: Row[] = extraEntities.map((entity, i) => {
  const severity: Severity = i < 6 ? "Critical" : i < 12 ? "High" : i < 16 ? "Medium" : "Low";
  const assignee = i === 0 || (i >= 6 && i <= 13) ? null : i >= 14 ? "A. Patel" : others[i % 4];
  const breached = BREACHED.has(i);
  const [typology, rule] = typologies[i % 4];
  const corporate = /(AS|LLC|Ltd|Inc|BV|Mining|Shipping|Metals|Partners)$/.test(entity);
  return [
    `ALT-${92700 - i * 7}`, entity, `C-${30000 + i * 1373}`, corporate ? "Corporate" : "Individual",
    severity, typology, rule, 25000 + i * 41300, 2 + (i % 9), scores[i],
    `Sep 28, 0${(i % 9) + 1}:${String((i * 13) % 60).padStart(2, "0")}`,
    breached ? `SLA overdue · ${1 + (i % 3)}h ${String((i * 7) % 60).padStart(2, "0")}m` : `${i + 1}h ago`,
    breached, assignee, assignee ? (i % 2 ? "In review" : "Pending info") : "New",
  ];
});

const toAlert = (r: Row): QueueAlert => ({
  id: r[0], entity: r[1], entityId: r[2], entityType: r[3], severity: r[4], typology: r[5], rule: r[6],
  amount: r[7], txCount: r[8], score: r[9], detected: r[10], sla: r[11], slaBreached: r[12],
  assignee: r[13], status: r[14],
  narrative: `${r[1]} triggered ${r[6]} across ${r[8]} transactions totalling $${r[7].toLocaleString("en-US")}.`,
  customerRisk: r[4] === "Critical" || r[4] === "High" ? "High" : "Medium",
  linked: `${1 + (r[8] % 4)} related alerts`,
});

export function getAlertQueue(): AlertQueue {
  const alerts = [...shown, ...extra].map(toAlert);
  alerts[0].narrative =
    "Orion Trading FZE moved $482,750 through 12 transactions in 38 minutes, exceeding its 30-day baseline by 6.4x. Funds passed through 3 elevated-risk jurisdictions.";
  alerts[0].customerRisk = "High · KYC reviewed Sep 12";
  alerts[0].linked = "3 related alerts · 1 open case";
  return {
    alerts, closed: 184, newToday: 8, medianTriage: "18 min", medianTriageDelta: "-6 min",
    oldestBreach: "4h 12m", currentUser: "A. Patel",
  };
}

const c = (
  id: string, opened: string, entity: string, entityId: string, entityType: string, type: string, typeSub: string,
  priority: Severity, status: Case["status"], investigator: string | null, alerts: number, due: string, dueNote: string,
): Case => ({
  id, opened, entity, entityId, entityType, type, typeSub, priority, status, investigator, alerts, due, dueNote,
  overdue: dueNote.startsWith("Overdue"), dueToday: due.startsWith("Today"),
});

// 14 open cases: the 8 rows in the frame plus 6 more, so the workload card
// (Patel 4, Chiu 3, Alvarez 3, Karim 2, unassigned 2) and tab counts match.
const cases: Case[] = [
  c("AML-4821", "Opened Sep 21", "Orion Trading FZE", "C-18842", "AE · Corporate", "Rapid movement of funds", "Cross-border layering", "Critical", "Escalated", "D. Chiu", 6, "Sep 27, 16:00", "Overdue · 18h"),
  c("AML-4819", "Opened Sep 23", "Novara Capital SA", "C-07718", "CH · Corporate", "Layering / circular flows", "Linked counterparty network", "Critical", "In progress", "M. Alvarez", 5, "Today, 09:00", "1h remaining"),
  c("AML-4818", "Opened Sep 24", "Kofi Mensah", "C-33601", "GH · Individual", "Structuring / smurfing", "Repeated sub-threshold deposits", "Critical", "New", null, 4, "Today, 10:00", "2h remaining"),
  c("AML-4815", "Opened Sep 23", "Baltic Meridian OÜ", "C-48726", "EE · Corporate", "High-risk jurisdiction", "Source of funds review", "High", "Pending approval", "D. Chiu", 3, "Today, 14:00", "6h remaining"),
  c("AML-4812", "Opened Sep 25", "Rosa Delgado", "C-21508", "PA · Individual", "Unusual cash activity", "Activity inconsistent with profile", "High", "In progress", "N. Karim", 3, "Today, 16:00", "8h remaining"),
  c("AML-4808", "Opened Sep 22", "Harborline Imports Ltd", "C-14821", "HK · Corporate", "Sanctions proximity", "Related party screening", "High", "Pending info", "A. Patel", 2, "Sep 29, 12:00", "1d remaining"),
  c("AML-4805", "Opened Sep 24", "Westbridge Services Ltd", "C-76140", "GB · Corporate", "Dormant account activity", "Reactivation and rapid outflows", "High", "Pending info", "A. Patel", 4, "Sep 30, 10:00", "2d remaining"),
  c("AML-4801", "Opened Sep 27", "Crescent Exchange LLC", "C-22698", "AE · MSB", "Unusual remittance activity", "High-volume corridor review", "Medium", "New", null, 2, "Sep 30, 16:00", "2d remaining"),
  c("AML-4797", "Opened Sep 19", "Nordvik Holdings AS", "C-30000", "NO · Corporate", "Trade-based laundering", "Invoice mismatch", "Medium", "In progress", "A. Patel", 3, "Oct 01, 12:00", "3d remaining"),
  c("AML-4793", "Opened Sep 18", "Samir Haddad", "C-31373", "LB · Individual", "Structuring / smurfing", "ATM cash deposits", "Medium", "Pending approval", "M. Alvarez", 2, "Oct 01, 16:00", "3d remaining"),
  c("AML-4790", "Opened Sep 16", "Golden Reef Mining", "C-32746", "GH · Corporate", "High-risk jurisdiction", "Gold export proceeds", "Medium", "In progress", "D. Chiu", 2, "Sep 26, 12:00", "Overdue · 2d"),
  c("AML-4786", "Opened Sep 15", "Lena Vogel", "C-34119", "DE · Individual", "Unusual cash activity", "Cash-intensive pattern", "Low", "In progress", "M. Alvarez", 1, "Oct 02, 10:00", "4d remaining"),
  c("AML-4781", "Opened Sep 14", "Pacific Crest Shipping", "C-35492", "SG · Corporate", "Sanctions proximity", "Vessel ownership check", "Low", "In progress", "N. Karim", 1, "Oct 03, 12:00", "5d remaining"),
  c("AML-4777", "Opened Sep 12", "Aurora Freight LLC", "C-36865", "US · Corporate", "Rapid movement of funds", "Pass-through account", "Low", "New", "A. Patel", 1, "Oct 04, 12:00", "6d remaining"),
];

export function getCases(): Cases {
  return {
    cases, closed: 38, openedThisWeek: 2, oldestOverdue: "18h", currentUser: "A. Patel",
    activity: [
      { title: "AML-4821 assigned to Daniel Chiu", sub: "Assigned by Amina Patel", ago: "6 min ago", kind: "assign" },
      { title: "SAR draft approved · AML-4776", sub: "Approved by Miguel Alvarez", ago: "18 min ago", kind: "sar" },
      { title: "Evidence requested · AML-4808", sub: "Source of funds documents · Amina Patel", ago: "34 min ago", kind: "note" },
    ],
  };
}
