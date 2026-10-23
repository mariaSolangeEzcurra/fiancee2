
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';

import {
  getStoredUser,
  login as loginRequest,
  type AuthUser,
} from '../services/auth';

interface AuthContextValue {
  user: AuthUser | null;
  accessToken: string | null;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(getStoredUser);
  const [accessToken, setAccessToken] = useState<string | null>(
    () => localStorage.getItem('fio_access')
  );

  const login = useCallback(
    async (username: string, password: string) => {
      const data = await loginRequest(username, password);

      localStorage.setItem('fio_access', data.access);
      localStorage.setItem('fio_refresh', data.refresh);
      localStorage.setItem('fio_user', JSON.stringify(data.usuario));

      setAccessToken(data.access);
      setUser(data.usuario);

      return data.usuario;
    },
    []
  );

  const logout = useCallback(() => {
    localStorage.removeItem('fio_access');
    localStorage.removeItem('fio_refresh');
    localStorage.removeItem('fio_user');

    setAccessToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, accessToken, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth debe utilizarse dentro de AuthProvider.');
  }

  return context;
}
