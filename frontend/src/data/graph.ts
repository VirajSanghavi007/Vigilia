// Transaction graph explorer mock data (Figma "Transaction graph explorer").
// Node centres are in the 760 x 620 graph canvas; every node is NODE_W x NODE_H.

export const CANVAS = { w: 760, h: 620 };
export const NODE_W = 200;
export const NODE_H = 84;

export type NodeKind = "entity" | "account" | "selected" | "cluster" | "alert" | "case" | "evidence";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  title: string;
  lines: string[];
  x: number;
  y: number;
  /** Inspector heading under the title, e.g. "Outbound SWIFT wire". */
  role: string;
  details: [string, string][];
}

/** payment: recorded money movement (solid). context: linked records (dashed). risk: alerting path (dashed orange). */
export type EdgeKind = "payment" | "context" | "risk";

export interface GraphEdge {
  from: string; to: string; label: string; kind: EdgeKind;
  /** Where along the edge its label sits (0-1); moved off-centre where two edges cross. */
  at?: number;
}

export const nodes: GraphNode[] = [
  {
    id: "orion", kind: "entity", title: "Orion Trading FZE", lines: ["Customer C-10842", "Corporate · United Arab Emirates"], x: 110, y: 60,
    role: "Originating customer",
    details: [["Customer", "C-10842 · Corporate"], ["Jurisdiction", "United Arab Emirates"], ["KYC status", "EDD required"], ["Customer risk", "High"], ["Linked case", "AML-4821"]],
  },
  {
    id: "alnoor", kind: "entity", title: "Al Noor General Trading LLC", lines: ["Beneficiary entity", "Hong Kong"], x: 650, y: 60,
    role: "Beneficiary entity",
    details: [["Jurisdiction", "Hong Kong"], ["Relationship", "Historical counterparty of C-10842"], ["Corridor", "AE → HK"], ["Sanctions result", "No direct match"]],
  },
  {
    id: "acct4821", kind: "account", title: "Account •••• 4821", lines: ["Originating account", "AE · Outbound funds"], x: 110, y: 210,
    role: "Originating account",
    details: [["Held by", "Orion Trading FZE"], ["Country", "United Arab Emirates"], ["Direction", "Outbound funds"], ["Outbound transfers (38 min)", "12"]],
  },
  {
    id: "txn", kind: "selected", title: "TXN-984218", lines: ["$98,500 USD · SWIFT wire", "Sep 28, 09:42 UTC"], x: 380, y: 210,
    role: "Outbound SWIFT wire",
    details: [
      ["Value", "$98,500 USD"], ["Risk score", "96/100"], ["Linked activity", "12 transfers"],
      ["Timestamp", "Sep 28 2026 · 09:42 UTC"], ["Corridor", "AE → HK"], ["Originator", "Orion Trading FZE"],
      ["Beneficiary", "Al Noor General Trading LLC"], ["Originating account", "ending 4821"], ["Beneficiary account", "ending 9036"],
      ["Payment reference", "INV-2026-0928-OT"], ["Customer", "C-10842 · Corporate"], ["Linked alert", "ALT-92841"],
      ["Linked case", "AML-4821"], ["Triggering rule", "TM-014 Velocity anomaly"], ["Assigned investigator", "Amina Patel"],
    ],
  },
  {
    id: "acct9036", kind: "account", title: "Account •••• 9036", lines: ["Beneficiary account", "HK · AE → HK"], x: 650, y: 210,
    role: "Beneficiary account",
    details: [["Held by", "Al Noor General Trading LLC"], ["Country", "Hong Kong"], ["Direction", "Inbound funds"], ["Corridor", "AE → HK"]],
  },
  {
    id: "linked", kind: "cluster", title: "12 linked transfers", lines: ["$482,750 total · 38 minutes", "6.4× 30-day baseline"], x: 380, y: 360,
    role: "Linked activity cluster",
    details: [["Total linked value", "$482,750"], ["Transfer count", "12 transfers"], ["Burst duration", "38 minutes"], ["Baseline multiplier", "6.4×"], ["Elevated-risk jurisdictions", "3"]],
  },
  {
    id: "alert", kind: "alert", title: "ALT-92841", lines: ["TM-014", "Velocity anomaly"], x: 110, y: 450,
    role: "Triggered alert",
    details: [["Rule", "TM-014 Velocity anomaly"], ["Severity", "Critical"], ["Triggered by", "TXN-984218 and linked activity"], ["Linked case", "AML-4821"]],
  },
  {
    id: "case", kind: "case", title: "AML-4821", lines: ["Linked case", "Review supporting evidence"], x: 650, y: 450,
    role: "Linked case",
    details: [["Status", "Escalated"], ["Typology", "Rapid movement of funds"], ["Assigned investigator", "Amina Patel"], ["Next step", "Review supporting evidence"]],
  },
  {
    id: "evidence", kind: "evidence", title: "Evidence requested", lines: ["Source-of-funds documents", "No direct sanctions match"], x: 380, y: 560,
    role: "Open evidence request",
    details: [["Requested", "Source-of-funds documents"], ["Customer", "C-10842 · KYC review"], ["Sanctions result", "No direct match"], ["Review status", "Not complete"]],
  },
];

export const edges: GraphEdge[] = [
  { from: "orion", to: "acct4821", label: "owns account", kind: "payment" },
  { from: "acct4821", to: "txn", label: "debits", kind: "payment" },
  { from: "txn", to: "acct9036", label: "credits", kind: "payment" },
  { from: "acct9036", to: "alnoor", label: "held by", kind: "payment" },
  { from: "txn", to: "linked", label: "part of linked activity", kind: "context" },
  { from: "linked", to: "alert", label: "triggered alert", kind: "risk" },
  { from: "alert", to: "case", label: "linked to case", kind: "context", at: 0.72 },
  { from: "linked", to: "evidence", label: "requires evidence review", kind: "context" },
];

export const linkedSummary: [string, string][] = [
  ["Total linked value", "$482,750"], ["Transfer count", "12 transfers"], ["Burst duration", "38 minutes"],
  ["Baseline multiplier", "6.4×"], ["Elevated-risk jurisdictions", "3"], ["Sanctions result", "No direct match"],
];

export const investigationNotes: [string, string][] = [
  ["Source-of-funds evidence", "Requested"], ["KYC review", "Customer C-10842"], ["Linked case", "AML-4821"], ["Assigned investigator", "Amina Patel"],
];
