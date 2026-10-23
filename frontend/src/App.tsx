
import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';

import { AppProvider } from './contexts/AppContext';
import { AuthProvider } from './contexts/AuthContext';
import { AppShell } from './components/layout/AppShell';
import { Login } from './pages/Login';
import { ProtectedRoute } from './components/auth/ProtectedRoute';

import { FioHome } from './pages/fio/FioHome';
import { Simulator } from './pages/fio/Simulator';
import { Contracts } from './pages/fio/Contracts';
import { FioSummary } from './pages/fio/FioSummary';

import { Finance } from './pages/shared/Finance';
import { Capacity } from './pages/shared/Capacity';
import { Staff } from './pages/shared/Staff';
import { Settings } from './pages/shared/Settings';
import { Dresses } from './pages/shared/Dresses';

import { JefaHome } from './pages/taller/JefaHome';
import { Queue } from './pages/taller/Queue';
import { Alerts } from './pages/taller/Alerts';

import { MyDay } from './pages/trabajador/MyDay';
import { LogHours } from './pages/trabajador/LogHours';
import { MyDresses } from './pages/trabajador/MyDresses';
import { MyNotes } from './pages/trabajador/MyNotes';

import { Dashboard } from './pages/gerencia/Dashboard';
import { Hours } from './pages/gerencia/Hours';
import { Kpi } from './pages/gerencia/Kpi';

export function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Login />} />

            {/* COMERCIAL */}
            <Route
              path="/fio"
              element={
                <ProtectedRoute allowedRoles={['comercial']}>
                  <AppShell role="fio" />
                </ProtectedRoute>
              }
            >
              <Route index element={<FioHome />} />
              <Route path="simulador" element={<Simulator />} />
              <Route path="contratos" element={<Contracts />} />
              <Route path="finanzas" element={<Finance />} />
              <Route path="resumen" element={<FioSummary />} />
              <Route path="configuracion" element={<Settings />} />
            </Route>

            {/* JEFATURA DE TALLER */}
            <Route
              path="/taller"
              element={
                <ProtectedRoute allowedRoles={['jefa_taller']}>
                  <AppShell role="jefa" />
                </ProtectedRoute>
              }
            >
              <Route index element={<JefaHome />} />
              <Route path="vestidos" element={<Dresses />} />
              <Route path="cola" element={<Queue />} />
              <Route path="capacidad" element={<Capacity />} />
              <Route path="personal" element={<Staff />} />
              <Route path="alertas" element={<Alerts />} />
              <Route path="configuracion" element={<Settings />} />
            </Route>

            {/* TRABAJADOR DE TALLER */}
            <Route
              path="/trabajador"
              element={
                <ProtectedRoute allowedRoles={['taller']}>
                  <AppShell role="trabajador" />
                </ProtectedRoute>
              }
            >
              <Route index element={<MyDay />} />
              <Route path="registrar" element={<LogHours />} />
              <Route path="vestidos" element={<MyDresses />} />
              <Route path="observaciones" element={<MyNotes />} />
            </Route>

            {/* GERENCIA */}
            <Route
              path="/gerencia"
              element={
                <ProtectedRoute allowedRoles={['gerencia']}>
                  <AppShell role="gerencia" />
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="personal" element={<Staff />} />
              <Route path="horas" element={<Hours />} />
              <Route path="produccion" element={<Dresses readOnly />} />
              <Route path="capacidad" element={<Capacity />} />
              <Route path="finanzas" element={<Finance />} />
              <Route path="kpi" element={<Kpi />} />
              <Route path="configuracion" element={<Settings />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>

          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: '#FFFDF9',
                border: '1px solid #E7DCCE',
                color: '#4A3428',
              },
            }}
          />
        </BrowserRouter>
      </AppProvider>
    </AuthProvider>
  );
}
