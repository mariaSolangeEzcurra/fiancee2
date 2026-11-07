import { MessageCircleIcon } from 'lucide-react';

import { whatsapp } from '../../services/comercialApi';
import { cn } from '../../utils/format';

/** Botón redondo que abre WhatsApp con un mensaje ya escrito. */
export function WhatsAppButton({ phone, text, className }: { phone: string; text?: string; className?: string }) {
  const href = whatsapp(phone, text);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title="Escribir por WhatsApp"
      aria-label="Escribir por WhatsApp"
      onClick={(e) => e.stopPropagation()}
      className={cn('shrink-0 rounded-full border border-emerald-200 bg-paper p-2 text-emerald-700 hover:bg-emerald-50', className)}
    >
      <MessageCircleIcon className="h-4 w-4" />
    </a>
  );
}

/** Mensajes rápidos para la clienta (se abren en WhatsApp). */
export function WhatsAppQuick({
  phone,
  client,
  code,
  ready,
}: {
  phone: string;
  client: string;
  code: string;
  ready?: boolean;
}) {
  const nombre = client.split(/\s+/)[0] || '';
  const mensajes = [
    { label: 'Coordinar prueba', text: `Hola ${nombre}, te escribimos del taller de Fiancée. ¿Qué día puedes venir para la prueba de tu vestido (${code})?` },
    ready
      ? { label: 'Avisar que está listo', text: `Hola ${nombre}, ¡tu vestido (${code}) ya está listo! Puedes pasar a recogerlo cuando gustes.` }
      : { label: 'Contar cómo va', text: `Hola ${nombre}, te escribimos del taller de Fiancée para contarte cómo va tu vestido (${code}).` },
    { label: 'Escribir', text: `Hola ${nombre}, te escribimos de Fiancée por tu vestido (${code}).` },
  ];
  if (!whatsapp(phone)) {
    return <p className="text-xs text-cocoa-faint">La clienta no tiene celular registrado.</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-800">
        <MessageCircleIcon className="h-3.5 w-3.5" /> WhatsApp · {phone}
      </span>
      {mensajes.map((m) => (
        <a
          key={m.label}
          href={whatsapp(phone, m.text) ?? '#'}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-emerald-200 bg-paper px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50"
        >
          {m.label}
        </a>
      ))}
    </div>
  );
}
