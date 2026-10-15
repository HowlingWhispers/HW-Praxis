// Stroke icons, drawn inline so they take the text colour. Decorative: every button that
// carries one also carries words or an aria-label.
import type { ReactNode } from 'react';

function Icon({ size = 20, width = 1.9, children }: { size?: number; width?: number; children: ReactNode }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export const MenuIcon = () => <Icon size={22} width={1.8}><path d="M4 7h16M4 12h16M4 17h10" /></Icon>;
export const BackIcon = () => <Icon><path d="M15 6l-6 6 6 6" /></Icon>;
export const ChevronRight = ({ className = 'chev' }: { className?: string }) => <span className={className}><Icon size={18}><path d="m9 6 6 6-6 6" /></Icon></span>;
export const ChevronDown = ({ className = 'accchev' }: { className?: string }) => <span className={className}><Icon size={22}><path d="m6 9 6 6 6-6" /></Icon></span>;
export const PlusIcon = () => <Icon size={20} width={1.8}><path d="M12 5v14M5 12h14" /></Icon>;
export const SendIcon = () => <Icon size={22} width={2.2}><path d="M12 19V5M6 11l6-6 6 6" /></Icon>;
export const RerollIcon = () => <Icon size={18} width={1.8}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></Icon>;
export const UndoIcon = () => <Icon size={18} width={1.8}><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></Icon>;
export const StopIcon = () => <Icon size={18} width={1.8}><rect x="6" y="6" width="12" height="12" rx="2" /></Icon>;
export const LockIcon = ({ size = 16 }: { size?: number }) => <Icon size={size} width={2}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Icon>;
export const SearchIcon = () => <Icon size={18}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></Icon>;
export const BookIcon = () => <Icon size={22} width={1.8}><path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4z" /><path d="M5 16a4 4 0 0 1 4-4h10" /></Icon>;
export const DownloadIcon = () => <Icon size={18}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></Icon>;
export const UploadIcon = () => <Icon size={18}><path d="M12 20V9M7 14l5-5 5 5M5 4h14" /></Icon>;
export const ListIcon = () => <Icon size={18}><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></Icon>;
export const PulseIcon = () => <Icon size={18}><path d="M4 12h4l3-7 4 14 3-7h2" /></Icon>;
export const PenIcon = () => <Icon size={18}><path d="M4 20h4L19 9l-4-4L4 16z" /></Icon>;
export const CloseIcon = () => <Icon size={18}><path d="M6 6l12 12M18 6 6 18" /></Icon>;
export const ArchiveIcon = () => <Icon size={18}><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10h14V9M10 13h4" /></Icon>;
export const Diamond = ({ color, filled, size = 11 }: { color: string; filled: boolean; size?: number }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 12 12">
    {filled ? <path d="M6 1 11 6 6 11 1 6z" fill={color} /> : <path d="M6 1.7 10.3 6 6 10.3 1.7 6z" fill="none" stroke="#4a5160" />}
  </svg>
);
export const DiamondIcon = () => <Icon size={16} width={1.8}><path d="M12 3 21 12 12 21 3 12z" /></Icon>;
