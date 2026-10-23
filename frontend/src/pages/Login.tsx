
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, LockKeyhole } from 'lucide-react';

import { useAuth } from '../contexts/AuthContext';
import { roleHome } from '../services/auth';

export function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (user) {
    return <Navigate to={roleHome(user.rol)} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const authenticatedUser = await login(username.trim(), password);
      navigate(roleHome(authenticatedUser.rol), { replace: true });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No se pudo iniciar sesión.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-ivory lg:grid-cols-2">
      <aside className="flex flex-col justify-between bg-cream px-8 py-10 md:px-14">
        <div>
          <p className="font-display text-5xl font-semibold text-cocoa">
            Fiancée
          </p>
          <p className="mt-2 text-xs uppercase tracking-[0.3em] text-gold">
            Alta Costura · Arequipa
          </p>
        </div>

        <div className="my-12 max-w-md">
          <p className="font-display text-3xl italic leading-snug text-cocoa">
            Cada detalle cuenta. Cada vestido tiene una historia.
          </p>
          <p className="mt-4 text-sm text-cocoa-muted">
            Ingresa a tu espacio de trabajo para continuar.
          </p>
        </div>

        <p className="text-xs text-cocoa-muted">
          Acceso exclusivo para el equipo Fiancée
        </p>
      </aside>

      <section className="flex items-center justify-center px-6 py-12">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-md rounded-2xl border border-line bg-white p-7 shadow-sm md:p-10"
        >
          <div className="mb-7 flex h-12 w-12 items-center justify-center rounded-full bg-blush-soft text-cocoa">
            <LockKeyhole size={22} />
          </div>

          <h1 className="font-display text-3xl font-semibold text-cocoa">
            Bienvenida a Fiancée
          </h1>

          <p className="mt-2 text-sm text-cocoa-muted">
            Ingresa con las credenciales que te asignaron.
          </p>

          <label
            htmlFor="username"
            className="mt-7 block text-sm font-medium text-cocoa"
          >
            Usuario
          </label>
          <input
            id="username"
            name="username"
            autoComplete="username"
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="mt-2 w-full rounded-lg border border-line bg-ivory px-4 py-3 text-cocoa outline-none focus:border-gold"
            placeholder="Tu nombre de usuario"
          />

          <label
            htmlFor="password"
            className="mt-5 block text-sm font-medium text-cocoa"
          >
            Contraseña
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-2 w-full rounded-lg border border-line bg-ivory px-4 py-3 text-cocoa outline-none focus:border-gold"
            placeholder="Tu contraseña"
          />

          {error && (
            <p role="alert" className="mt-4 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-7 flex w-full items-center justify-center gap-2 rounded-lg bg-cocoa px-4 py-3 font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Verificando...' : 'Ingresar'}
            {!loading && <ArrowRight size={18} />}
          </button>
        </form>
      </section>
    </main>
  );
}
