import React, { useState } from 'react';
import { API_BASE_URL, loginWithEmail, type AuthUser } from '../api.js';

interface LoginScreenProps {
  onLoginSuccess: (user: AuthUser) => void;
  authError?: string | null;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess, authError }) => {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(authError || null);

  const handleGoogleLogin = () => {
    // Real Google OAuth 2.0 redirect
    window.location.href = `${API_BASE_URL}/auth/google`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Please enter your email ID');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const user = await loginWithEmail(email.trim(), password);
      onLoginSuccess(user);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="figma-login-wrapper">
      <div className="figma-login-card">
        <h1 className="figma-login-title">Login</h1>

        {error && (
          <div className="figma-login-error">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="figma-error-close">
              &times;
            </button>
          </div>
        )}

        {/* Real Google OAuth Login Button */}
        <button
          type="button"
          className="figma-google-btn"
          onClick={handleGoogleLogin}
          id="google-login-btn"
        >
          <svg className="google-icon" viewBox="0 0 24 24" width="20" height="20">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <span>Login with Google</span>
        </button>

        <div className="figma-login-divider">
          <span className="figma-divider-line"></span>
          <span className="figma-divider-text">Email/password sign-in is unavailable</span>
          <span className="figma-divider-line"></span>
        </div>

        {/* Email & Password Form */}
        <form onSubmit={handleSubmit} className="figma-login-form">
          <div className="figma-input-group">
            <input
              type="email"
              className="figma-input"
              placeholder="Email ID"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              id="login-email-input"
            />
          </div>

          <div className="figma-input-group">
            <input
              type="password"
              className="figma-input"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              id="login-password-input"
            />
          </div>

          <button
            type="submit"
            className="figma-primary-btn"
            disabled={loading}
            id="login-submit-btn"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>

      </div>
    </div>
  );
};
