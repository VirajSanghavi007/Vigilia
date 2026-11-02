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
  ["ALT-92841", "Orion Trading FZE", "C-10842", "AE · Corporate", "Critical", "Rapid movement of funds", "TM-014 · Velocity anomaly", 482750, 12, 96, "Sep 28, 09:42", "8 min ago", false, "M. Alvarez", "Escalated"],
  ["ALT-92796", "Novara Capital SA", "C-07219", "CH · Corporate", "Critical", "Layering / circular flows", "TM-032 · Network pattern", 928300, 18, 94, "Sep 28, 07:18", "SLA overdue · 32m", true, null, "New"],
  ["ALT-92836", "Kofi Mensah", "C-20931", "GH · Individual", "Critical", "Structuring / smurfing", "TM-008 · Cash threshold", 74980, 9, 91, "Sep 28, 09:36", "14 min ago", false, null, "New"],
  ["ALT-92829", "Baltic Meridian OÜ", "C-08726", "EE · Corporate", "High", "High-risk jurisdiction", "TM-021 · Cross-border flow", 1240000, 4, 88, "Sep 28, 09:27", "23 min ago", false, "D. Cho", "In review"],
  ["ALT-92817", "Rosa Delgado", "C-31508", "PA · Individual", "High", "Unusual cash activity", "TM-006 · Profile deviation", 39600, 6, 84, "Sep 28, 09:09", "41 min ago", false, "N. Karim", "In review"],
  ["ALT-92782", "Ibrahim Hassan", "C-28174", "NG · Individual", "High", "Rapid movement of funds", "TM-014 · Velocity anomaly", 126850, 7, 82, "Sep 28, 06:42", "SLA overdue · 1h 08m", true, "S. Okafor", "In review"],
  ["ALT-92804", "Harborline Imports Ltd", "C-14620", "HK · Corporate", "High", "Sanctions proximity", "SC-003 · Related entity", 612400, 2, 79, "Sep 28, 08:50", "1 hour ago", false, "A. Patel", "Pending info"],
  ["ALT-92765", "Westbridge Services Ltd", "C-19240", "GB · Corporate", "Medium", "Dormant account activity", "TM-019 · Reactivation", 58200, 3, 67, "Sep 28, 05:38", "SLA overdue · 2h 12m", true, null, "New"],
];

const extraEntities = [
  "Nordvik Holdings AS", "Samir Haddad", "Golden Reef Mining", "Lena Vogel", "Pacific Crest Shipping",
  "Aurora Freight LLC", "Mateo Rinaldi", "Crescent Exchange LLC", "Juniper Agro Ltd", "Yusuf Demir",
  "Silverline Metals", "Priya Raman", "Kestrel Logistics BV", "Omar Farouk", "Lumen Digital Ltd",
  "Hana Kobayashi", "Tidewater Partners", "Elena Petrova", "Cobalt Ridge Inc",
];
// Home jurisdiction of each extra entity, in the same order.
const extraCountries = ["NO", "LB", "GH", "DE", "SG", "US", "IT", "AE", "KE", "TR", "ZA", "IN", "NL", "EG", "GB", "JP", "KY", "CY", "US"];
const typologies: [string, string][] = [
  ["Rapid movement of funds", "TM-014 · Velocity anomaly"],
  ["Structuring / smurfing", "TM-008 · Cash threshold"],
  ["High-risk jurisdiction", "TM-021 · Cross-border flow"],
  ["Unusual cash activity", "TM-006 · Profile deviation"],
];
const scores = [90, 89, 89, 88, 87, 86, 82, 81, 80, 78, 77, 76, 66, 63, 60, 55, 44, 41, 38];
const others = ["M. Alvarez", "D. Cho", "N. Karim", "S. Okafor"];
const BREACHED = new Set([1, 3, 7, 12]);

// The other 19 open alerts behind pages 2-4, laid out so the tab and KPI counts
// match the frame: 12 unassigned, 6 for the current user, 7 breached, 9 critical.
const extra: Row[] = extraEntities.map((entity, i) => {
  const severity: Severity = i < 6 ? "Critical" : i < 12 ? "High" : i < 16 ? "Medium" : "Low";
  const assignee = i === 0 || (i >= 6 && i <= 13) ? null : i >= 14 ? "A. Patel" : others[i % 4];
  const breached = BREACHED.has(i);
  const [typology, rule] = typologies[i % 4];
  const corporate = /(AS|LLC|Ltd|Inc|BV|Mining|Shipping|Metals|Partners)$/.test(entity);
  return [
    `ALT-${92700 - i * 7}`, entity, `C-${30000 + i * 1373}`, `${extraCountries[i]} · ${corporate ? "Corporate" : "Individual"}`,
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
  nextStep: `Review linked transfers and source-of-funds evidence. ${r[13] ? `Assigned to ${r[13]}` : "Assign an analyst"}${r[12] ? ", SLA already breached." : "."}`,
});

export function getAlertQueue(): AlertQueue {
  const alerts = [...shown, ...extra].map(toAlert);
  alerts[0].narrative =
    "Orion Trading FZE moved $482,750 through 12 transactions in 38 minutes, exceeding its 30-day baseline by 6.4×. Funds passed through 3 elevated-risk jurisdictions.";
  alerts[0].customerRisk = "High · KYC reviewed Sep 12";
  alerts[0].linked = "3 related alerts · 1 open case";
  alerts[0].nextStep = "Review linked transfers and source-of-funds evidence. Escalated to L2 by M. Alvarez at 09:46 UTC.";
  return {
    alerts, closed: 148, newToday: 8, medianTriage: "18 min", medianTriageDelta: "-6 min",
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
// (Patel 4, Cho 3, Alvarez 3, Karim 2, unassigned 2) and tab counts match.
const cases: Case[] = [
  c("AML-4821", "Opened Sep 24", "Orion Trading FZE", "C-10842", "AE · Corporate", "Rapid movement of funds", "Cross-border layering", "Critical", "Escalated", "D. Cho", 6, "Sep 27, 16:00", "Overdue · 18h"),
  c("AML-4819", "Opened Sep 25", "Novara Capital SA", "C-07219", "CH · Corporate", "Layering / circular flows", "Linked counterparty network", "Critical", "In progress", "M. Alvarez", 5, "Today, 09:00", "Overdue · 1h"),
  c("AML-4818", "Opened Sep 26", "Kofi Mensah", "C-20931", "GH · Individual", "Structuring / smurfing", "Repeated sub-threshold deposits", "Critical", "New", null, 4, "Today, 16:00", "6h remaining"),
  c("AML-4816", "Opened Sep 23", "Baltic Meridian OÜ", "C-08726", "EE · Corporate", "High-risk jurisdiction", "Source-of-funds review", "High", "Pending approval", "D. Cho", 3, "Today, 14:00", "4h remaining"),
  c("AML-4812", "Opened Sep 25", "Rosa Delgado", "C-31508", "PA · Individual", "Unusual cash activity", "Activity inconsistent with profile", "High", "In progress", "N. Karim", 3, "Today, 18:00", "8h remaining"),
  c("AML-4809", "Opened Sep 22", "Harborline Imports Ltd", "C-14620", "HK · Corporate", "Sanctions proximity", "Related-party screening", "High", "Pending info", "A. Patel", 2, "Sep 29, 12:00", "1d 2h remaining"),
  c("AML-4805", "Opened Sep 24", "Westbridge Services Ltd", "C-19240", "GB · Corporate", "Dormant account activity", "Reactivation and rapid outflows", "High", "Pending info", "A. Patel", 4, "Sep 30, 10:00", "2d remaining"),
  c("AML-4801", "Opened Sep 27", "Crescent Exchange LLC", "C-22816", "AE · MSB", "Unusual remittance activity", "High-volume corridor review", "Medium", "New", null, 2, "Sep 30, 16:00", "2d 6h remaining"),
  c("AML-4797", "Opened Sep 19", "Nordvik Holdings AS", "C-30000", "NO · Corporate", "Trade-based laundering", "Invoice mismatch", "Medium", "In progress", "A. Patel", 3, "Oct 01, 12:00", "3d remaining"),
  c("AML-4793", "Opened Sep 18", "Samir Haddad", "C-31373", "LB · Individual", "Structuring / smurfing", "ATM cash deposits", "Medium", "Pending approval", "M. Alvarez", 2, "Oct 01, 16:00", "3d remaining"),
  c("AML-4790", "Opened Sep 16", "Golden Reef Mining", "C-32746", "GH · Corporate", "High-risk jurisdiction", "Gold export proceeds", "Medium", "In progress", "D. Cho", 2, "Oct 01, 18:00", "3d 8h remaining"),
  c("AML-4786", "Opened Sep 15", "Lena Vogel", "C-34119", "DE · Individual", "Unusual cash activity", "Cash-intensive pattern", "Low", "In progress", "M. Alvarez", 1, "Oct 02, 10:00", "4d remaining"),
  c("AML-4781", "Opened Sep 14", "Pacific Crest Shipping", "C-35492", "SG · Corporate", "Sanctions proximity", "Vessel ownership check", "Low", "In progress", "N. Karim", 1, "Oct 03, 12:00", "5d remaining"),
  c("AML-4777", "Opened Sep 12", "Aurora Freight LLC", "C-36865", "US · Corporate", "Rapid movement of funds", "Pass-through account", "Low", "New", "A. Patel", 1, "Oct 04, 12:00", "6d remaining"),
];

export function getCases(): Cases {
  return {
    cases, closed: 38, openedThisWeek: 2, oldestOverdue: "18h", currentUser: "A. Patel",
    activity: [
      { title: "AML-4821 assigned to Daniel Cho", sub: "Assigned by Amina Patel", ago: "6 min ago", kind: "assign" },
      { title: "SAR draft approved · AML-4778", sub: "Approved by Miguel Alvarez", ago: "18 min ago", kind: "sar" },
      { title: "Evidence requested · AML-4809", sub: "Source-of-funds documents · Amina Patel", ago: "34 min ago", kind: "note" },
    ],
  };
}
