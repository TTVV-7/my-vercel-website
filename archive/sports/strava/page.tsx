"use client";

import Navbar from "../../../components/Navbar";
import Link from "next/link";
import { useStravaAuth } from "./StravaAuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function StravaPage() {
  const { users, currentUser, setCurrentUserId, addOrUpdateUser, removeUser, clearAll } = useStravaAuth();
  const router = useRouter();
  // Avoid using Next's `useSearchParams` here to prevent prerender bailout during build.
  // Read `code` from window.location.search on the client instead.
  const [code, setCode] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState("");
  const [name, setName] = useState("");
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // OAuth exchange - POST code to backend API
  useEffect(() => {
    let cancelled = false;
    async function exchangeCode() {
      if (!code) return;
      try {
        setError(null);
        const res = await fetch('/api/strava/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code })
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error || 'Token exchange failed');
          return;
        }
        if (cancelled) return;
        const displayName = data?.athlete ? (data.athlete.firstname || data.athlete.username || 'Athlete') : 'Strava User';
        const id = (data?.athlete?.id ? String(data.athlete.id) : `athlete-${Date.now()}`);
        addOrUpdateUser({
          id,
            athleteId: data?.athlete?.id ? String(data.athlete.id) : undefined,
          name: displayName,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: data.expires_at,
        });
        setRedirecting(true);
        router.replace('/fitness/stats');
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to exchange code');
      }
    }
    exchangeCode();
    return () => { cancelled = true; };
  }, [code, addOrUpdateUser, router]);

  // Extract `code` from the URL on mount (client-side only)
  useEffect(() => {
    try {
      const p = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
      const c = p ? p.get('code') : null;
      if (c) setCode(c);
    } catch (e) {
      // ignore
    }
  }, []);

  function handleSelectUser(id: string) {
    setCurrentUserId(id);
    setRedirecting(true);
    router.push('/fitness/stats');
  }

  // Use environment-configured client id and redirect (NEXT_PUBLIC_* are exposed to the browser)
  const clientId = typeof process !== 'undefined' && process.env.NEXT_PUBLIC_STRAVA_CLIENT_ID
    ? process.env.NEXT_PUBLIC_STRAVA_CLIENT_ID
    : '177489';
  const redirectUri = typeof process !== 'undefined' && process.env.NEXT_PUBLIC_STRAVA_REDIRECT_URL
    ? process.env.NEXT_PUBLIC_STRAVA_REDIRECT_URL
    : (typeof window !== 'undefined' ? window.location.origin + '/strava' : 'http://localhost:3000/strava');
  const stravaAuthUrl = `https://www.strava.com/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&approval_prompt=force&scope=activity:read_all`;

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-950 to-black text-white">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 py-10">
        <h1 className="text-3xl font-bold mb-6 flex items-center gap-2">🏃‍♂️ Strava Access</h1>

        {error && (
          <div className="mb-6 p-4 rounded bg-red-900/40 border border-red-600 text-sm">
            {error}
          </div>
        )}

        {redirecting && (
          <div className="mb-6 p-3 rounded bg-emerald-800/40 border border-emerald-500 text-sm animate-pulse">
            Redirecting to activities...
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-10">
          {/* Saved Users */}
          <div>
            <h2 className="text-xl font-semibold mb-4">Saved Users</h2>
            {users.length === 0 && (
              <p className="text-gray-400 text-sm mb-4">No saved users yet. Connect with Strava to get started.</p>
            )}
            <ul className="space-y-3">
              {users.map(u => (
                <li key={u.id} className={`p-4 rounded border flex items-center justify-between ${currentUser?.id === u.id ? 'border-emerald-500 bg-emerald-500/10' : 'border-gray-700 bg-gray-800/40'}`}>
                  <div>
                    <div className="font-medium">{u.name}</div>
                    <div className="text-xs text-gray-400 break-all">{u.accessToken.slice(0, 20)}...</div>
                    {u.expiresAt && (
                      <div className="text-xs text-gray-500">
                        Expires: {new Date(u.expiresAt * 1000).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSelectUser(u.id)}
                      className="px-3 py-1.5 text-xs rounded bg-emerald-600 hover:bg-emerald-500 transition"
                    >Use</button>
                    <button
                      onClick={() => removeUser(u.id)}
                      className="px-2 py-1 text-xs rounded bg-red-600/70 hover:bg-red-600 transition"
                    >✕</button>
                  </div>
                </li>
              ))}
            </ul>
            {users.length > 0 && (
              <button
                onClick={clearAll}
                className="mt-4 text-xs text-red-400 hover:text-red-300 underline"
              >Clear all saved</button>
            )}
          </div>

          {/* Strava OAuth Connection */}
          <div>
            <h2 className="text-xl font-semibold mb-4">Connect with Strava</h2>
            <div className="space-y-4">
              <p className="text-sm text-gray-300">
                Authorize your Strava account to access your activities and segment data. 
                This will securely exchange your authorization for access tokens.
              </p>
              
              {error && error.includes('Server missing') && (
                <div className="p-3 rounded bg-yellow-900/40 border border-yellow-500 text-sm">
                  <strong>Setup Required:</strong> Environment variables missing. 
                  Add STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET to .env.local and restart the server.
                </div>
              )}
              
              <Link
                href={stravaAuthUrl}
                className="inline-flex items-center gap-2 px-6 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition font-medium"
              >
                <span>🔗</span>
                Connect with Strava
              </Link>
              
              <div className="text-xs text-gray-500 space-y-1">
                <p>• You'll be redirected to Strava to authorize access</p>
                <p>• We only request read access to your activities</p>
                <p>• Tokens are stored locally in your browser</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-12 text-xs text-gray-500 space-y-1">
          <p>Tokens are stored locally in your browser (localStorage) only.</p>
          <p>The OAuth flow exchanges authorization codes securely through our backend API for access and refresh tokens.</p>
        </div>
      </div>
    </div>
  );
}