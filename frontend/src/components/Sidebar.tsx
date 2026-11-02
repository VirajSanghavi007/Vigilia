import {
  Bell, Briefcase, FileText, LayoutGrid, LineChart, Network, ScrollText, Search, Settings2,
  Users, ArrowLeftRight, SlidersHorizontal, UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link, NavLink } from "react-router-dom";
import { initials } from "../lib/format";
import { paths } from "../routes";
import { Logo } from "./Logo";

interface NavItem { to: string; label: string; icon: LucideIcon; badge?: number }

const workspace: NavItem[] = [
  { to: paths.overview, label: "Overview", icon: LayoutGrid },
  { to: paths.alerts, label: "Alert queue", icon: Bell, badge: 27 },
  { to: paths.cases, label: "Cases", icon: Briefcase, badge: 14 },
  { to: paths.transactions, label: "Transactions", icon: ArrowLeftRight },
  { to: paths.analytics, label: "Transaction analytics", icon: LineChart },
  { to: paths.customers, label: "Customers", icon: Users },
  { to: paths.investigations, label: "Investigations", icon: Network },
  { to: paths.investigators, label: "Investigators", icon: Search },
];
const management: NavItem[] = [
  { to: paths.reports, label: "Reports", icon: FileText },
  { to: paths.rules, label: "Rules & models", icon: Settings2 },
  { to: paths.audit, label: "Audit log", icon: ScrollText },
];
const administration: NavItem[] = [
  { to: paths.settings, label: "Settings", icon: SlidersHorizontal },
  { to: paths.profile, label: "Profile", icon: UserRound },
];

interface Props {
  user: { name: string; role: string };
}

export function Sidebar({ user }: Props) {
  const renderItem = (item: NavItem) => (
    <NavLink key={item.to} to={item.to} end={item.to === paths.overview} className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
      <item.icon size={15} />
      <span>{item.label}</span>
      {item.badge !== undefined && <span className="nav-badge">{item.badge}</span>}
    </NavLink>
  );

  return (
    <aside className="sidebar">
      <Link className="brand" to={paths.overview} aria-label="Vigilia AML home"><Logo tone="inverse" sub="Operations" /></Link>
      <nav aria-label="Main">
        <div className="nav-section">Workspace</div>
        {workspace.map(renderItem)}
        <div className="nav-section">Management</div>
        {management.map(renderItem)}
        <div className="nav-section">Administration</div>
        {administration.map(renderItem)}
      </nav>
      <div className="user">
        <div className="avatar">{initials(user.name)}</div>
        <div className="user-text">
          <div className="user-name">{user.name}</div>
          <div className="user-role">{user.role}</div>
        </div>
      </div>
    </aside>
  );
}
