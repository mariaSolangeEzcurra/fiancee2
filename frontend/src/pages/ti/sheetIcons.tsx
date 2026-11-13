import {
  FileSpreadsheetIcon,
  FileTextIcon,
  ReceiptIcon,
  ScissorsIcon,
  ShirtIcon,
  UsersIcon,
  WalletIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const SHEET_ICONS: Record<string, LucideIcon> = {
  clientes: UsersIcon,
  personal: ScissorsIcon,
  contratos: FileTextIcon,
  vestidos: ShirtIcon,
  pagos: WalletIcon,
  gastos: ReceiptIcon,
};

export function sheetIcon(clave: string): LucideIcon {
  return SHEET_ICONS[clave] ?? FileSpreadsheetIcon;
}
