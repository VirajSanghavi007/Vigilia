import {
  Bell, Briefcase, FileText, LayoutGrid, MoreHorizontal, ScrollText, Search, Settings2,
  ShieldCheck, Users, ArrowLeftRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { initials } from "../lib/format";

interface NavItem { id: string; label: string; icon: LucideIcon; badge?: number }

const workspace: NavItem[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "alerts", label: "Alert queue", icon: Bell, badge: 27 },
  { id: "cases", label: "Cases", icon: Briefcase, badge: 14 },
  { id: "transactions", label: "Transactions", icon: ArrowLeftRight },
  { id: "customers", label: "Customers", icon: Users },
  { id: "investigations", label: "Investigations", icon: Search },
];
const management: NavItem[] = [
  { id: "reports", label: "Reports", icon: FileText },
  { id: "rules", label: "Rules & models", icon: Settings2 },
  { id: "audit", label: "Audit log", icon: ScrollText },
];

interface Props {
  active: string;
  onSelect: (id: string) => void;
  user: { name: string; role: string };
}

export function Sidebar({ active, onSelect, user }: Props) {
  const renderItem = (item: NavItem) => (
    <button
      key={item.id}
      className={`nav-item${active === item.id ? " active" : ""}`}
      aria-current={active === item.id ? "page" : undefined}
      onClick={() => onSelect(item.id)}
    >
      <item.icon size={15} />
      <span>{item.label}</span>
      {item.badge !== undefined && <span className="nav-badge">{item.badge}</span>}
    </button>
  );

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><ShieldCheck size={16} /></div>
        <div>
          <div className="brand-name">Vigilia AML</div>
          <div className="brand-sub">Operations</div>
        </div>
      </div>
      <nav aria-label="Main">
        <div className="nav-section">Workspace</div>
        {workspace.map(renderItem)}
        <div className="nav-section">Management</div>
        {management.map(renderItem)}
      </nav>
      <div className="engine">
        <div className="engine-head">
          <span>Detection engine</span>
          <span className="live"><span className="dot" />LIVE</span>
        </div>
        <div className="engine-sub">Rules updated 8 min ago</div>
        <div className="engine-sub">Model v4.8.2</div>
        <div className="engine-bar"><span style={{ width: "82%" }} /></div>
      </div>
      <div className="user">
        <div className="avatar">{initials(user.name)}</div>
        <div className="user-text">
          <div className="user-name">{user.name}</div>
          <div className="user-role">{user.role}</div>
        </div>
        <MoreHorizontal size={15} className="muted-icon" />
      </div>
    </aside>
  );
}
