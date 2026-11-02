// Mock data copied from the Figma design. Replace getDashboard() with an API
// call once the backend exposes these aggregates; nothing else should change.
import type { Alert, Dashboard } from "./types";

const riskTrend = [
  70, 68, 74, 79, 76, 82, 88, 84, 91, 95, 89, 97, 102, 98, 106, 111, 104, 113, 119, 115, 124, 129,
  126, 134, 141, 137, 146, 152,
].map((high, i) => ({
  date: `Sep ${String(i + 1).padStart(2, "0")}`,
  high,
  medium: Math.round(high * 0.62 + 8 * Math.sin(i / 2)),
}));

const volumeByHour = [
  28, 24, 22, 20, 25, 31, 38, 46, 55, 63, 70, 74, 78, 81, 84, 88, 92, 96, 86, 72, 58, 44, 36, 30,
].map((value, hour) => ({ hour, value }));

const alerts: Alert[] = [
  { id: "a1", entity: "Orion Trading FZE", entityId: "ALF-55961", meta: "AE · 6 min ago", amount: 482750, score: 95, typology: "Rapid movement of funds", status: "Escalated", analyst: "M. Alvarez" },
  { id: "a2", entity: "Kofi Mensah", entityId: "ALF-50936", meta: "GH · 14 min ago", amount: 74980, score: 91, typology: "Structuring / smurfing", status: "Unassigned", analyst: null },
  { id: "a3", entity: "Baltic Meridian OU", entityId: "ALF-50929", meta: "EE · 23 min ago", amount: 1240000, score: 88, typology: "High-risk jurisdiction", status: "In review", analyst: "D. Chiu" },
  { id: "a4", entity: "Rosa Delgado", entityId: "ALF-50917", meta: "PA · 41 min ago", amount: 38600, score: 84, typology: "Unusual cash activity", status: "In review", analyst: "N. Karim" },
  { id: "a5", entity: "Harbourline Imports Ltd", entityId: "ALF-50904", meta: "HK · 1 h ago", amount: 612400, score: 79, typology: "Sanctions proximity", status: "Pending info", analyst: "A. Patel" },
  { id: "a6", entity: "Nordvik Holdings AS", entityId: "ALF-50896", meta: "NO · 1 h ago", amount: 905300, score: 78, typology: "Rapid movement of funds", status: "Unassigned", analyst: null },
  { id: "a7", entity: "Samir Haddad", entityId: "ALF-50881", meta: "LB · 2 h ago", amount: 49900, score: 77, typology: "Structuring / smurfing", status: "In review", analyst: "M. Alvarez" },
  { id: "a8", entity: "Golden Reef Mining", entityId: "ALF-50874", meta: "GH · 2 h ago", amount: 2310000, score: 76, typology: "High-risk jurisdiction", status: "Escalated", analyst: "D. Chiu" },
  { id: "a9", entity: "Lena Vogel", entityId: "ALF-50862", meta: "DE · 3 h ago", amount: 27450, score: 75, typology: "Unusual cash activity", status: "Pending info", analyst: "N. Karim" },
  { id: "a10", entity: "Pacific Crest Shipping", entityId: "ALF-50855", meta: "SG · 3 h ago", amount: 1785000, score: 75, typology: "Sanctions proximity", status: "In review", analyst: "A. Patel" },
];

export function getDashboard(): Dashboard {
  return {
    slaBreaches: 7,
    refreshedMinsAgo: 2,
    kpis: [
      { id: "volume", label: "Transaction volume", value: "$2.48B", delta: 8.2, deltaUnit: "%", higherIsBetter: true, sub: "184M transactions", icon: "volume" },
      { id: "flagged", label: "Flagged transactions", value: "12,684", delta: 4.7, deltaUnit: "%", higherIsBetter: false, sub: "0.69% of total", icon: "flag" },
      { id: "high", label: "High-risk alerts", value: "248", delta: 18.4, deltaUnit: "%", higherIsBetter: false, sub: "62 require review", icon: "alert" },
      { id: "cases", label: "Open cases", value: "1,436", delta: -3.1, deltaUnit: "%", higherIsBetter: false, sub: "84 nearing SLA", icon: "case" },
      { id: "fpr", label: "False-positive rate", value: "21.7%", delta: -2.0, deltaUnit: " pts", higherIsBetter: false, sub: "30-day rolling", icon: "target" },
    ],
    riskTrend,
    volumeByHour,
    volumeTotal: "68.4K",
    volumeDelta: 6.8,
    severity: [
      { level: "Critical", count: 62, color: "var(--critical)" },
      { level: "High", count: 186, color: "var(--high)" },
      { level: "Medium", count: 644, color: "var(--medium)" },
      { level: "Low", count: 1082, color: "var(--low)" },
    ],
    severityNote: "Critical alerts up 11% this week",
    typologies: [
      { name: "Structuring / smurfing", count: 486, color: "var(--accent)" },
      { name: "Rapid movement of funds", count: 372, color: "var(--accent-2)" },
      { name: "High-risk jurisdiction", count: 294, color: "var(--violet)" },
      { name: "Unusual cash activity", count: 251, color: "var(--medium)" },
      { name: "Sanctions proximity", count: 188, color: "var(--critical)" },
    ],
    typologyCoverage: "79.5% of active alerts",
    hotspots: [
      { name: "Dubai 66", x: 63, y: 44 },
      { name: "Hong Kong", x: 82, y: 47 },
      { name: "Panama 41", x: 27, y: 56 },
      { name: "Lagos 58", x: 49, y: 58 },
    ],
    elevatedJurisdictions: 18,
    newGeoAlerts: 12,
    activity: [
      { title: "Case #AML-4821 assigned", sub: "to Daniel Chiu · 6 min", kind: "assign" },
      { title: "SAR draft approved", sub: "Case #AML-4778 · 18 min", kind: "sar" },
      { title: "Note added to investigation", sub: "Nadia Karim · 34 min", kind: "note" },
      { title: "Case escalated to L2", sub: "Case #AML-4833 · 52 min", kind: "escalate" },
    ],
    activityToday: { actions: 37, escalations: 12 },
    alerts,
    highRiskAlerts: 248,
    user: { name: "Amina Patel", role: "Senior investigator" },
  };
}
