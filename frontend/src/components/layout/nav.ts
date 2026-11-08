import {
  Boxes,
  Building2,
  ClipboardList,
  Gauge,
  GraduationCap,
  HardDrive,
  LayoutDashboard,
  type LucideIcon,
  Microchip,
  Network,
  Package,
  Rows3,
  Settings,
  Terminal,
  Trophy,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  group: 'Operate' | 'Train' | 'System';
  /** Phase in which the screen becomes fully interactive (absent = available now). */
  phase?: number;
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, group: 'Operate' },
  { to: '/workorders', label: 'Work Orders', icon: ClipboardList, group: 'Operate' },
  { to: '/datacenter', label: 'Virtual Data Center', icon: Building2, group: 'Operate' },
  { to: '/racks', label: 'Rack Explorer', icon: Rows3, group: 'Operate' },
  { to: '/hardware', label: 'Hardware Lab', icon: HardDrive, group: 'Operate' },
  { to: '/network', label: 'Network Lab', icon: Network, group: 'Operate' },
  { to: '/gpu', label: 'GPU Diagnostics', icon: Microchip, group: 'Operate' },
  { to: '/facility', label: 'Cooling & Power', icon: Gauge, group: 'Operate' },
  { to: '/terminal', label: 'Terminal', icon: Terminal, group: 'Operate' },
  { to: '/learn', label: 'Learning Center', icon: GraduationCap, group: 'Train' },
  { to: '/inventory', label: 'Inventory', icon: Package, group: 'Train' },
  { to: '/progress', label: 'Progress & Achievements', icon: Trophy, group: 'Train' },
  { to: '/settings', label: 'Settings', icon: Settings, group: 'System' },
];

export const BRAND_ICON = Boxes;
