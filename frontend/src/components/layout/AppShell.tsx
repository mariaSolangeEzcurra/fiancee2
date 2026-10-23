import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { MenuIcon, XIcon } from 'lucide-react';
import { Role } from '../../types';
import { Sidebar } from './Sidebar';

export function AppShell({ role }: {role: Role;}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen w-full bg-ivory text-cocoa">
      <aside className="hidden w-64 shrink-0 border-r border-line bg-cream/60 lg:block">
        <div className="sticky top-0 h-screen overflow-y-auto">
          <Sidebar role={role} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line bg-cream/60 px-5 py-3 lg:hidden">
          <span className="font-display text-2xl font-semibold">Fiancée</span>
          <button type="button" onClick={() => setOpen(true)} aria-label="Abrir menú" className="rounded-lg p-2 hover:bg-paper">
            <MenuIcon className="h-5 w-5" />
          </button>
        </header>

        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-[1360px] px-5 py-8 md:px-8 lg:px-10 lg:py-10">
            <Outlet />
          </div>
        </main>
      </div>

      <AnimatePresence>
        {open &&
        <>
            <motion.div
            className="fixed inset-0 z-40 bg-cocoa/30 lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setOpen(false)} />
          
            <motion.aside
            className="fixed inset-y-0 left-0 z-50 w-72 bg-cream lg:hidden"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}>
            
              <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar menú" className="absolute right-3 top-4 rounded-lg p-2 hover:bg-paper">
                <XIcon className="h-5 w-5" />
              </button>
              <Sidebar role={role} onNavigate={() => setOpen(false)} />
            </motion.aside>
          </>
        }
      </AnimatePresence>
    </div>);

}