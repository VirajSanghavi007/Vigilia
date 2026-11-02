// Mock data for the Transactions, Customers, Investigators, Reports, Rules &
// models, Audit log, Settings and Profile pages, copied from the Figma frames.
// Every metric here (including model precision/recall/PSI and rule
// false-positive rates) is DESIGN MOCK DATA, not output of the Elliptic
// benchmark or any trained Vigilia model. Replace with API calls later.
import type { Severity } from "./types";

// ---------- Transactions ----------
export type TxnStatus = "Flagged" | "In review" | "On hold" | "Cleared";
export interface Txn {
  id: string; customer: string; customerMeta: string; counterparty: string; corridor: string;
  amount: number; channel: string; direction: "Inbound" | "Outbound"; score: number; date: string; status: TxnStatus;
}
const t = (id: string, customer: string, customerMeta: string, counterparty: string, corridor: string, amount: number,
  channel: string, direction: Txn["direction"], score: number, date: string, status: TxnStatus): Txn =>
  ({ id, customer, customerMeta, counterparty, corridor, amount, channel, direction, score, date, status });

export const transactions = {
  population: 1840216,
  tabCounts: { all: "1.84M", flagged: "12,684", high: "248", hold: "36", cleared: "1.82M" },
  rows: [
    t("TXN-984218", "Orion Trading FZE", "C-10842 · AE · Corporate", "Al Noor General Trading LLC", "AE → HK · Cross-border", 98500, "SWIFT wire", "Outbound", 96, "Sep 28, 09:42", "Flagged"),
    t("TXN-984201", "Novara Capital SA", "C-07219 · CH · Corporate", "Meridian Holdings Ltd", "CH → CY · Cross-border", 215300, "SWIFT wire", "Outbound", 94, "Sep 28, 09:38", "Flagged"),
    t("TXN-984186", "Kofi Mensah", "C-20931 · GH · Individual", "Cash deposit · Accra Central", "GH → GH · Domestic", 9480, "Cash deposit", "Inbound", 91, "Sep 28, 09:36", "Flagged"),
    t("TXN-984153", "Baltic Meridian OÜ", "C-08726 · EE · Corporate", "Caspian Export Partners", "EE → AE · Cross-border", 310000, "SWIFT wire", "Outbound", 88, "Sep 28, 09:27", "In review"),
    t("TXN-984097", "Rosa Delgado", "C-31508 · PA · Individual", "Cash deposit · Panama City", "PA → PA · Domestic", 6600, "Cash deposit", "Inbound", 84, "Sep 28, 09:09", "In review"),
    t("TXN-984026", "Harborline Imports Ltd", "C-14620 · HK · Corporate", "Eastern Maritime Co Ltd", "HK → SG · Cross-border", 306200, "SWIFT wire", "Outbound", 79, "Sep 28, 08:50", "On hold"),
    t("TXN-983984", "Westbridge Services Ltd", "C-19240 · GB · Corporate", "Northfield Consulting Ltd", "GB → GB · Domestic", 19400, "Bank transfer", "Outbound", 67, "Sep 28, 08:42", "Flagged"),
    t("TXN-983951", "Crescent Exchange LLC", "C-22816 · AE · MSB", "Gulf Commercial Bank", "AE → AE · Domestic", 42750, "Bank transfer", "Inbound", 24, "Sep 28, 08:35", "Cleared"),
  ],
  // Investigation detail the frame shows for the selected transaction; other rows fall back to a generic summary.
  detail: {
    "TXN-984218": {
      narrative: "Orion Trading FZE sent $98,500 to Al Noor General Trading LLC. Part of 12 transfers totaling $482,750 in 38 minutes, 6.4× its 30-day baseline across 3 elevated-risk jurisdictions.",
      facts: [["Originating account", "•••• 4821 · Orion Trading FZE"], ["Beneficiary account", "•••• 9036 · Hong Kong"], ["Triggered rule", "TM-014 · Velocity anomaly"]],
      alert: "ALT-92841", case: "AML-4821", paymentRef: "INV-2026-0928-OT",
      nextStep: "Review linked transfers and verify source-of-funds evidence. Related alert escalated to L2 by M. Alvarez at 09:46 UTC on Sep 28.",
      screening: "Sanctions screening: no direct match",
    },
  } as Record<string, TxnDetail>,
};
export interface TxnDetail {
  narrative: string; facts: [string, string][]; alert: string; case: string; paymentRef: string; nextStep: string; screening: string;
}

// ---------- Customers ----------
export type Kyc = "EDD required" | "In review" | "Documents due" | "Verified" | "Review due";
export interface Customer {
  id: string; name: string; meta: string; score: number; kyc: Kyc; lastReview: string; next: string; nextWarn: boolean;
  linked: string; owner: string | null; ownerRole: string;
}
const c = (id: string, name: string, meta: string, score: number, kyc: Kyc, lastReview: string, next: string,
  nextWarn: boolean, linked: string, owner: string | null, ownerRole: string): Customer =>
  ({ id, name, meta, score, kyc, lastReview, next, nextWarn, linked, owner, ownerRole });

export const customers = {
  population: 24816,
  tabCounts: { all: "24,816", high: "486", due: "64", evidence: "23" },
  distribution: [
    { label: "High / critical", count: 486, color: "var(--critical)" },
    { label: "Medium", count: 4218, color: "var(--medium)" },
    { label: "Low", count: 20112, color: "var(--good)" },
  ],
  priorities: [
    { label: "Overdue", count: 18, tone: "bad" }, { label: "Due today", count: 12, tone: "warn" }, { label: "Due this week", count: 34, tone: "accent" },
  ],
  rows: [
    c("C-10842", "Orion Trading FZE", "C-10842 · AE · Corporate", 96, "EDD required", "Sep 12, 2026", "Next: Oct 12", false, "3 alerts · 1 case", "D. Cho", "L2 investigator"),
    c("C-07219", "Novara Capital SA", "C-07219 · CH · Corporate", 94, "In review", "Sep 18, 2026", "Next: Oct 18", false, "2 alerts · 1 case", "M. Alvarez", "L2 investigator"),
    c("C-20931", "Kofi Mensah", "C-20931 · GH · Individual", 91, "Documents due", "Jun 26, 2026", "Overdue · 2 days", true, "1 alert · 1 case", null, "Awaiting owner"),
    c("C-08726", "Baltic Meridian OÜ", "C-08726 · EE · Corporate", 88, "In review", "Sep 21, 2026", "Next: Oct 21", false, "1 alert · 1 case", "D. Cho", "L2 investigator"),
    c("C-31508", "Rosa Delgado", "C-31508 · PA · Individual", 84, "Verified", "Sep 09, 2026", "Next: Dec 09", false, "1 alert · 1 case", "N. Karim", "L1 investigator"),
    c("C-14620", "Harborline Imports Ltd", "C-14620 · HK · Corporate", 79, "Documents due", "Sep 05, 2026", "Evidence requested", true, "1 alert · 1 case", "A. Patel", "Senior investigator"),
    c("C-19240", "Westbridge Services Ltd", "C-19240 · GB · Corporate", 67, "Review due", "Jun 30, 2026", "Due: Sep 30", true, "1 alert · 1 case", "A. Patel", "Senior investigator"),
    c("C-22816", "Crescent Exchange LLC", "C-22816 · AE · MSB", 24, "Verified", "Sep 24, 2026", "Next: Dec 24", false, "No open alerts", null, "Standard monitoring"),
  ],
  activity: [
    { title: "EDD opened · Orion Trading FZE", sub: "Daniel Cho · Linked to AML-4821", ago: "6 min", kind: "escalate" },
    { title: "Evidence requested · Harborline Imports", sub: "Amina Patel · Source-of-funds documents", ago: "34 min", kind: "note" },
    { title: "KYC verified · Crescent Exchange LLC", sub: "Nadia Karim · Review completed", ago: "52 min", kind: "assign" },
    { title: "Review started · Novara Capital SA", sub: "Miguel Alvarez · Enhanced due diligence", ago: "1h ago", kind: "sar" },
  ] as Activity[],
};

export interface Activity { title: string; sub: string; ago: string; kind: "assign" | "sar" | "note" | "escalate" }

// ---------- Investigators ----------
export interface Investigator { name: string; role: string; openCases: number; alerts: number; capacity: number; note: string }
export interface Assignment {
  id: string; kind: string; entity: string; typology: string; priority: Severity; owner: string | null; ownerNote: string;
  deadline: string; deadlineNote: string; late: boolean; suggested: string; suggestedNote: string; action: "Assign" | "Review";
}
const a = (id: string, kind: string, entity: string, typology: string, priority: Severity, owner: string | null, ownerNote: string,
  deadline: string, deadlineNote: string, late: boolean, suggested: string, suggestedNote: string): Assignment =>
  ({ id, kind, entity, typology, priority, owner, ownerNote, deadline, deadlineNote, late, suggested, suggestedNote, action: owner ? "Review" : "Assign" });

export const investigators = {
  team: [
    { name: "Amina Patel", role: "Senior investigator · Team lead", openCases: 4, alerts: 3, capacity: 88, note: "2 pending evidence · 1 approval" },
    { name: "Daniel Cho", role: "L2 investigator · Corporate", openCases: 3, alerts: 4, capacity: 82, note: "1 overdue case · 1 approval" },
    { name: "Miguel Alvarez", role: "L2 investigator · Cross-border", openCases: 3, alerts: 3, capacity: 71, note: "1 overdue case · 1 SAR review" },
    { name: "Nadia Karim", role: "L1 investigator · Retail", openCases: 2, alerts: 5, capacity: 63, note: "Available for 2 new assignments" },
  ] as Investigator[],
  tabCounts: { attention: 5, all: 29, completed: 11 },
  stages: [
    { label: "In progress", count: 6, color: "var(--accent)" }, { label: "Pending information", count: 3, color: "var(--high)" },
    { label: "Pending approval", count: 2, color: "var(--violet)" }, { label: "Escalated to L2", count: 1, color: "var(--critical)" },
  ],
  rows: [
    a("AML-4818", "Case · Opened Sep 26", "Kofi Mensah", "Structuring / smurfing", "Critical", null, "L2 review required", "Today, 16:00", "6h remaining", false, "N. Karim", "Capacity available"),
    a("AML-4801", "Case · Opened Sep 27", "Crescent Exchange LLC", "Unusual remittance activity", "Medium", null, "L1 review required", "Sep 30, 16:00", "2d 6h remaining", false, "N. Karim", "Retail / MSB coverage"),
    a("ALT-92796", "Alert · Sep 28, 07:18", "Novara Capital SA", "Layering / circular flows", "Critical", null, "L2 review required", "SLA overdue", "32 min past target", true, "M. Alvarez", "Cross-border specialist"),
    a("AML-4821", "Case · Opened Sep 24", "Orion Trading FZE", "Rapid movement of funds", "Critical", "D. Cho", "Assigned 6 min ago", "Sep 27, 16:00", "Overdue · 18h", true, "A. Patel", "Escalation oversight"),
    a("AML-4819", "Case · Opened Sep 25", "Novara Capital SA", "Layering / circular flows", "Critical", "M. Alvarez", "In progress", "Today, 09:00", "Overdue · 1h", true, "A. Patel", "Escalation oversight"),
  ],
  activity: [
    { title: "AML-4821 assigned to Daniel Cho", sub: "Assigned by Amina Patel", ago: "09:54", kind: "assign" },
    { title: "SAR draft approved · AML-4778", sub: "Miguel Alvarez · Quality review", ago: "09:42", kind: "sar" },
    { title: "Evidence requested · AML-4809", sub: "Amina Patel · Source-of-funds documents", ago: "09:26", kind: "note" },
    { title: "Alert escalated to L2 · ALT-92841", sub: "Miguel Alvarez · Critical risk", ago: "09:46", kind: "escalate" },
  ] as Activity[],
};

// ---------- Reports ----------
export type ReportStatus = "Draft" | "In review" | "Approved" | "Submitted" | "Accepted";
export interface ReportDetail { narrative: string; preparer: string; reviewer: string; attachments: string; nextStep: string }
export interface Report {
  id: string; subject: string; type: "SAR" | "CTR"; ref: string; status: ReportStatus; preparer: string; reviewer: string | null;
  deadline: string; deadlineNote: string; updated: string; note: string;
}
const r = (id: string, subject: string, type: Report["type"], ref: string, status: ReportStatus, preparer: string,
  reviewer: string | null, deadline: string, deadlineNote: string, updated: string, note: string): Report =>
  ({ id, subject, type, ref, status, preparer, reviewer, deadline, deadlineNote, updated, note });

export const reports = {
  population: 40,
  tabCounts: { all: 40, draft: 6, review: 3, approved: 3, filed: 28 },
  overview: [
    { label: "Filed this month", value: "28", note: "+4 vs. August" },
    { label: "Draft reports", value: "6", note: "3 narratives pending" },
    { label: "Awaiting approval", value: "3", note: "2 due today" },
    { label: "On-time filing rate", value: "100%", note: "No overdue filings" },
    { label: "Scheduled reports", value: "8", note: "Next: today 18:00" },
  ],
  rows: [
    r("SAR-2026-0148", "Orion Trading FZE", "SAR", "AML-4821", "Draft", "D. Cho", "A. Patel", "Sep 30, 17:00", "2d 7h remaining", "Sep 28, 09:54", "Narrative in progress"),
    r("SAR-2026-0147", "Novara Capital SA", "SAR", "AML-4819", "In review", "M. Alvarez", "A. Patel", "Sep 29, 17:00", "1d 7h remaining", "Sep 28, 09:38", "Evidence attached"),
    r("SAR-2026-0146", "Baltic Meridian OÜ", "SAR", "AML-4816", "Approved", "D. Cho", "M. Alvarez", "Sep 28, 17:00", "7h remaining", "Sep 28, 09:42", "Ready for submission"),
    r("SAR-2026-0145", "Case AML-4778", "SAR", "AML-4778", "Approved", "N. Karim", "M. Alvarez", "Sep 28, 17:00", "7h remaining", "Sep 28, 09:42", "Quality review passed"),
    r("CTR-2026-0082", "Cash activity · Sep 27", "CTR", "12 cash transactions", "Submitted", "A. Patel", null, "Sep 28, 12:00", "Filed on time", "Sep 28, 08:15", "Receipt: ACK-68421"),
    r("SAR-2026-0144", "Case AML-4764", "SAR", "AML-4764", "Accepted", "M. Alvarez", null, "Sep 26, 17:00", "Filed Sep 25", "Sep 28, 07:32", "Receipt: ACK-68398"),
  ],
  schedules: [
    { name: "Daily AML operations digest", cadence: "Every weekday · 18:00 · PDF", next: "Today, 18:00", owner: "A. Patel" },
    { name: "Weekly alert & case summary", cadence: "Every Monday · 08:00 · XLSX", next: "Oct 05, 08:00", owner: "M. Alvarez" },
    { name: "High-risk customer review", cadence: "Every Friday · 09:00 · CSV", next: "Oct 02, 09:00", owner: "N. Karim" },
    { name: "Monthly compliance pack", cadence: "Monthly · Last day · 18:00 · PDF + XLSX", next: "Sep 30, 18:00", owner: "A. Patel" },
    { name: "Weekly sanctions exposure", cadence: "Every Monday · 08:00 · PDF", next: "Oct 05, 08:00", owner: "A. Patel" },
  ],
  detail: {
    "SAR-2026-0148": {
      narrative: "12 transfers totaling $482,750 in 38 minutes across 3 elevated-risk jurisdictions. Source-of-funds evidence is outstanding; narrative drafting is in progress.",
      preparer: "Daniel Cho", reviewer: "Amina Patel", attachments: "8 evidence files",
      nextStep: "Next step: complete source-of-funds narrative before approval.",
    },
  } as Record<string, ReportDetail>,
  performance: [
    { label: "Accepted", value: "26" }, { label: "Awaiting acknowledgment", value: "2" }, { label: "Rejected / resubmission", value: "0" },
    { label: "Median preparation", value: "2.4 days" }, { label: "Median approval", value: "4.2 hours" },
  ],
  activity: [
    { title: "SAR draft approved · AML-4778", sub: "Miguel Alvarez · Four-eyes review", ago: "09:42", kind: "sar" },
    { title: "SAR-2026-0147 sent for review", sub: "Miguel Alvarez → Amina Patel", ago: "09:38", kind: "note" },
    { title: "CTR-2026-0082 submitted", sub: "Amina Patel · Receipt ACK-68421", ago: "08:15", kind: "assign" },
    { title: "SAR-2026-0144 accepted", sub: "Regulatory gateway · ACK-68398", ago: "07:32", kind: "assign" },
  ] as Activity[],
};

// ---------- Rules & models (DESIGN MOCK, not real model metrics) ----------
export interface RuleDetail { version: string; logic: string; facts: [string, string][]; note: string }
export interface Rule {
  id: string; name: string; logic: string; logicSub: string; status: "Active" | "Testing"; alerts: number; alertsNote: string;
  fpr: number; fprDelta: string; owner: string; ownerTeam: string; updated: string; updatedNote: string;
}
const rl = (id: string, name: string, logic: string, logicSub: string, status: Rule["status"], alerts: number, alertsNote: string,
  fpr: number, fprDelta: string, owner: string, ownerTeam: string, updated: string, updatedNote: string): Rule =>
  ({ id, name, logic, logicSub, status, alerts, alertsNote, fpr, fprDelta, owner, ownerTeam, updated, updatedNote });

export const rules = {
  population: 47,
  tabCounts: { rules: 47, models: 3, changes: 2, validation: 0 },
  overview: [
    { label: "Active detection rules", value: "42", note: "5 in shadow testing" },
    { label: "Screening coverage", value: "99.8%", note: "Within target" },
    { label: "False-positive rate", value: "21.7%", note: "−2.6 pts" },
    { label: "Model health", value: "Stable", note: "PSI: 0.08" },
    { label: "Pending changes", value: "2", note: "1 rule · 1 model" },
    { label: "Active model", value: "v4.8.2", note: "Production since Sep 12" },
  ],
  model: { version: "v4.8.2", precision: 78.3, precisionDelta: "+2.6 pts", recall: 94.6, recallDelta: "+0.8 pts", psi: 0.08 },
  // 28 daily points ending at the headline 78.3% precision.
  precisionTrend: Array.from({ length: 28 }, (_, i) => ({
    date: `Sep ${String(i + 1).padStart(2, "0")}`,
    precision: +(75.7 + (2.6 * i) / 27 + (i === 27 ? 0 : Math.sin(i * 1.7) * 0.6)).toFixed(1),
  })),
  rows: [
    rl("TM-014", "Velocity anomaly", "Rapid movement of funds", "12+ transfers / 60 min · ≥5× baseline", "Active", 372, "18.8% of alerts", 18.2, "−2.1 pts", "M. Alvarez", "Transaction monitoring", "Sep 28, 09:52", "Threshold unchanged"),
    rl("TM-008", "Cash threshold", "Structuring / smurfing", "Repeated deposits below reporting threshold", "Active", 486, "24.6% of alerts", 24.8, "−1.4 pts", "N. Karim", "Retail monitoring", "Sep 25, 14:20", "Window updated"),
    rl("TM-021", "Cross-border flow", "High-risk jurisdiction", "Elevated-risk corridor · Risk-weighted value", "Active", 294, "14.9% of alerts", 19.4, "−0.6 pts", "D. Cho", "Corporate monitoring", "Sep 24, 11:06", "Jurisdiction list synced"),
    rl("TM-006", "Profile deviation", "Unusual cash activity", "Activity inconsistent with customer profile", "Active", 251, "12.7% of alerts", 26.1, "+0.8 pts", "N. Karim", "Retail monitoring", "Sep 22, 16:45", "Baseline recalibrated"),
    rl("SC-003", "Related entity", "Sanctions proximity", "Linked counterparty / ownership screening", "Active", 168, "8.5% of alerts", 12.6, "−0.9 pts", "A. Patel", "Sanctions operations", "Sep 28, 08:00", "Watchlists refreshed"),
    rl("TM-032", "Network pattern", "Layering / circular flows", "Multi-hop movement within linked network", "Active", 182, "9.2% of alerts", 17.3, "−1.2 pts", "M. Alvarez", "Transaction monitoring", "Sep 21, 10:30", "Network depth updated"),
    rl("TM-019", "Reactivation", "Dormant account activity", "Rapid outflows after 180+ days inactivity", "Active", 96, "4.9% of alerts", 22.4, "−0.3 pts", "A. Patel", "Customer monitoring", "Sep 18, 12:15", "Review completed"),
    rl("TM-041", "Remittance corridor", "Unusual remittance activity", "New corridor / unusual beneficiary concentration", "Testing", 125, "Shadow mode only", 23.0, "Validation sample", "D. Cho", "Model validation", "Sep 27, 15:20", "Pending approval"),
  ],
  detail: {
    "TM-014": {
      version: "Velocity anomaly · Version 12",
      logic: "Trigger when 12 or more transfers occur within 60 minutes and value exceeds 5× the customer's baseline.",
      facts: [["Latest match", "ALT-92841 · Score 96"], ["Customer", "Orion Trading FZE"]] as [string, string][],
      note: "12 transfers in 38 minutes · $482,750 · 6.4× baseline. Escalated to L2 at 09:46 UTC.",
    },
  } as Record<string, RuleDetail>,
  changes: [
    { title: "TM-041 · Promote shadow rule", sub: "Daniel Cho · Validation sample attached", state: "Pending" },
    { title: "v4.8.3 · Candidate model review", sub: "Miguel Alvarez · Not in production", state: "Pending" },
    { title: "TM-014 · Configuration checked", sub: "Miguel Alvarez · No threshold change", state: "09:52" },
  ],
};

// ---------- Audit log ----------
export interface AuditEvent {
  id: string; time: string; actor: string; role: string; action: string; actionSub: string; record: string; recordSub: string;
  result: "Success" | "Denied"; source: string; ip: string;
  change?: { field: string; before: string; after: string; reason: string };
}
export interface AuditDetail {
  narrative: string; request: string; session: string; authentication: string; authorization: string; digest: string;
}
const e = (id: string, time: string, actor: string, role: string, action: string, actionSub: string, record: string,
  recordSub: string, result: AuditEvent["result"], source: string, ip: string): AuditEvent =>
  ({ id, time, actor, role, action, actionSub, record, recordSub, result, source, ip });

const auditRows = [
  e("EVT-20260928-095412-4821", "Sep 28, 09:54:12", "Amina Patel", "Senior investigator", "Case assigned", "Investigation workflow", "AML-4821", "Orion Trading FZE", "Success", "Web app", "10.24.8.16"),
  e("EVT-20260928-095208-0014", "Sep 28, 09:52:08", "Miguel Alvarez", "L2 investigator", "Rule reviewed", "Configuration check", "TM-014", "Velocity anomaly", "Success", "Web app", "10.24.8.22"),
  e("EVT-20260928-094631-2841", "Sep 28, 09:46:31", "Miguel Alvarez", "L2 investigator", "Alert escalated to L2", "Critical risk review", "ALT-92841", "Orion Trading FZE", "Success", "Web app", "10.24.8.22"),
  e("EVT-20260928-094219-4778", "Sep 28, 09:42:19", "Miguel Alvarez", "L2 investigator", "SAR draft approved", "Four-eyes approval", "AML-4778", "SAR-2026-0145", "Success", "Web app", "10.24.8.22"),
  e("EVT-20260928-093844-0147", "Sep 28, 09:38:44", "Miguel Alvarez", "L2 investigator", "Report sent for review", "Regulatory reporting", "SAR-2026-0147", "Novara Capital SA", "Success", "Web app", "10.24.8.22"),
  e("EVT-20260928-092603-4809", "Sep 28, 09:26:03", "Amina Patel", "Senior investigator", "Evidence requested", "Source-of-funds documents", "AML-4809", "Harborline Imports Ltd", "Success", "Web app", "10.24.8.16"),
  e("EVT-20260928-081547-0082", "Sep 28, 08:15:47", "Amina Patel", "Senior investigator", "CTR submitted", "Regulatory gateway", "CTR-2026-0082", "Receipt ACK-68421", "Success", "API gateway", "svc-reporting"),
  e("EVT-20260928-080452-0001", "Sep 28, 08:04:52", "svc-export", "Service account", "Export access denied", "Insufficient scope", "Customer export", "Bulk PII access", "Denied", "API gateway", "10.24.12.8"),
];
auditRows[0].change = {
  field: "assigned_investigator", before: "Unassigned", after: "Daniel Cho · USR-0042",
  reason: "Escalated case routed to L2 corporate investigator.",
};

export const audit = {
  population: 18642,
  rows: auditRows,
  detail: {
    "EVT-20260928-095412-4821": {
      narrative: "Amina Patel assigned case AML-4821 to Daniel Cho for L2 investigation of Orion Trading FZE.",
      request: "req-7f28c9a1", session: "session-ap-0928-01",
      authentication: "SSO · MFA verified", authorization: "Case assignment policy",
      digest: "8f4a2d71…c0b9e263 · Verified",
    },
  } as Record<string, AuditDetail>,
  retention: [
    ["Retention period", "7 years · Immutable storage"],
    ["Last verification", "Sep 28, 09:58 UTC"],
    ["Export format", "CSV + signed manifest"],
    ["Time standard", "UTC · Synchronized"],
  ] as [string, string][],
  distribution: [
    { label: "Investigation & customer actions", count: 12408, color: "var(--accent)" },
    { label: "System & reporting events", count: 5842, color: "#3b63c4" },
    { label: "Access & configuration", count: 392, color: "var(--violet)" },
  ],
  denied: [
    { title: "Bulk customer export blocked", sub: "svc-export · Missing customer:export scope", ago: "08:04" },
    { title: "Rule edit denied · TM-021", sub: "Read-only role · Sep 27, 15:18 UTC", ago: "Sep 27" },
    { title: "Unrecognized login blocked", sub: "External sign-in · Sep 26, 19:40 UTC", ago: "Sep 26" },
  ],
};

// ---------- Settings / Profile ----------
export const workspaceSettings = {
  workspaceName: "Vigilia AML Operations",
  complianceContact: "compliance@vigilia-aml.example",
  timeZone: "UTC · Coordinated Universal Time",
  currency: "USD · US Dollar",
  criticalEscalation: true,
  deadlineReminders: true,
  dailyDigest: false,
};
export type WorkspaceSettings = typeof workspaceSettings;

/** Read-only workspace record shown beside the editable settings. */
export const workspaceRecord = {
  id: "WS-VIGILIA-PROD",
  region: "EU region",
  savedBy: "Miguel Alvarez · Administrator",
  savedAt: "Sep 24, 2026 · 14:20:08",
  policy: "POL-2026.09 · Revision 12",
  model: "v4.8.2",
};

export const profile = {
  name: "Amina Patel",
  email: "amina.patel@vigilia-aml.example",
  title: "Senior investigator",
  unit: "Financial crime operations",
  level: "L2 · Cross-border & corporate",
  userId: "USR-0018",
  memberSince: "February 16, 2024",
  lastReview: "Sep 01, 2026 · Approved",
  nextReview: "Dec 01, 2026",
  granted: ["Investigations & case assignment", "SAR preparation & review", "Reports & audit log visibility"],
  locked: ["Production deployments", "Security policy administration"],
  signIn: "Corporate SSO · SAML 2.0",
  mfa: "Security key · Enforced",
  lastSignIn: "Sep 28, 2026 · 07:58:21",
  form: {
    displayName: "Amina Patel",
    language: "English (United Kingdom)",
    timeZone: "UTC · Coordinated Universal Time",
    caseEmails: true,
    dailyDigest: false,
  },
  sessions: [
    { device: "Chrome · Windows 11", ip: "10.24.8.16", when: "Started Sep 28 07:58 UTC", current: true },
    { device: "Edge · Windows 11", ip: "10.24.8.42", when: "Last active Sep 27 16:42 UTC", current: false },
  ],
};
export type ProfileForm = typeof profile.form;
