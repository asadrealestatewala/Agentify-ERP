import { bindUser } from './fieldLocation.js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, setQueueOwner } from './api.js';

const AuthCtx = createContext(null);
const MetaCtx = createContext(null);
const ToastCtx = createContext(null);

export function AppProviders({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading, null = anonymous
  const [meta, setMeta] = useState(null);
  const [toasts, setToasts] = useState([]);

  const pending = useRef(new Map()); // id -> { timer, commit }
  const notify = useCallback((message, kind = '') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 6000 : 3200);
  }, []);
  /**
   * Run `commit` after `seconds` (default 8) unless the user presses Undo. The confirm dialog (if any) comes first;
   * this is the second safety net. Pending commits are flushed if the tab closes so nothing is silently dropped.
   */
  const undoable = useCallback((message, { commit, onUndo, onDone, seconds = 8 } = {}) => {
    const id = Math.random();
    const finish = async () => {
      pending.current.delete(id);
      setToasts((t) => t.filter((x) => x.id !== id));
      try { await commit?.(); onDone?.(); } catch (e) { notify(e.message || 'Could not complete the action', 'err'); onUndo?.(); }
    };
    const timer = setTimeout(finish, seconds * 1000);
    pending.current.set(id, { timer, commit: finish });
    setToasts((t) => [...t, { id, message, kind: 'undo', seconds, undo: () => { clearTimeout(timer); pending.current.delete(id); setToasts((x) => x.filter((y) => y.id !== id)); onUndo?.(); } }]);
  }, [notify]);
  /** Rich "new notification" toast: icon, title, body; click runs onClick. */
  const live = useCallback((n) => {
    const id = Math.random();
    setToasts((t) => [...t, { id, kind: 'live', n }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 8000);
  }, []);
  const toast = useMemo(() => Object.assign((m, k) => notify(m, k), { undoable, live }), [notify, undoable, live]);
  useEffect(() => {
    const flush = () => { for (const [, p] of pending.current) { clearTimeout(p.timer); p.commit(); } };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  const loadMeta = useCallback(async () => { try { setMeta(await api.get('/api/settings/meta')); } catch { /* not staff */ } }, []);
  const refreshUser = useCallback(async () => {
    try { const u = await api.get('/api/auth/me'); setUser(u); if (!u.portal) await loadMeta(); } catch { setUser(null); setMeta(null); }
  }, [loadMeta]);

  useEffect(() => { refreshUser(); }, [refreshUser]);
  // offline queue: only the signed-in user's own saved actions are replayed
  useEffect(() => { setQueueOwner(user || null); }, [user?.id, user?.portal]);
  useEffect(() => {
    const h = () => { setUser(null); setMeta(null); };
    window.addEventListener('erp:unauthorized', h);
    return () => window.removeEventListener('erp:unauthorized', h);
  }, []);

  const auth = useMemo(() => ({
    user, refreshUser,
    /** Returns the user, or { mfa_required, mfa_token } when an authenticator code is still needed (see loginMfa). */
    login: async (identifier, password, portal = false) => { const u = await api.post('/api/auth/login', { identifier, password, portal }); if (u.mfa_required || u.otp_required) return u; setUser(u); if (!u.portal) await loadMeta(); return u; },
    /** Second step when the workspace asks for an emailed code (otp_required): the token from login() and the code typed. */
    loginOtp: async (otp_token, code) => { const u = await api.post('/api/auth/login/otp', { otp_token, code }); setUser(u); if (!u.portal) await loadMeta(); return u; },
    resendOtp: (otp_token) => api.post('/api/auth/login/otp/resend', { otp_token }),
    loginMfa: async (mfa_token, code) => { const u = await api.post('/api/auth/login/mfa', { mfa_token, code }); setUser(u); if (!u.portal) await loadMeta(); return u; },
    /** Adopt a session the server already created (accepting an invitation signs the user in). */
    adopt: async (u) => { setUser(u); if (!u.portal) await loadMeta(); return u; },
    logout: async () => { bindUser(null); try { await api.post('/api/auth/logout'); } finally { setUser(null); setMeta(null); } },
    can: (module, action = 'view') => !!user && !user.portal && (user.isSuper || user.perms.includes(`${module}:${action}`)),
  }), [user, refreshUser, loadMeta]);

  const metaApi = useMemo(() => ({ meta, reload: loadMeta }), [meta, loadMeta]);

  return (
    <ToastCtx.Provider value={toast}>
      <AuthCtx.Provider value={auth}>
        <MetaCtx.Provider value={metaApi}>
          {children}
          <div className="toasts" role="status">{toasts.map((t) => (t.kind === 'live'
            ? <div key={t.id} className="toast live" role="alert" onClick={() => { t.n.onClick?.(); setToasts((x) => x.filter((y) => y.id !== t.id)); }}><div className="live-toast"><div><b>{t.n.title}</b>{t.n.body && <small>{t.n.body}</small>}</div></div></div>
            : t.undo
            ? <div key={t.id} className="toast undo"><span className="grow">{t.message}</span><button onClick={t.undo}>Undo</button><i className="bar" style={{ animationDuration: `${t.seconds}s` }} /></div>
            : <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>))}</div>
        </MetaCtx.Provider>
      </AuthCtx.Provider>
    </ToastCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
export const useMeta = () => useContext(MetaCtx);
export const useToast = () => useContext(ToastCtx);

// Rows removed "with undo" stay hidden (per scope) for the 8 s grace period, even across page navigation.
const hiddenStore = new Map();
const hiddenSet = (scope) => hiddenStore.get(scope) || new Set();
const setHiddenSet = (scope, set) => { hiddenStore.set(scope, set); window.dispatchEvent(new Event('erp:hidden')); };

/**
 * Delete-with-undo: the row disappears at once, the real delete happens 8 s later unless the user presses Undo.
 * (The confirm dialog still comes first.)  const { hidden, remove } = useUndoDelete('contacts');
 * Filter lists with `hidden` (a Set of ids) and call remove(idOrIds, 'Contact deleted', () => api.del(url)).
 */
export function useUndoDelete(scope = 'default', afterCommit) {
  const toast = useToast();
  const [, tick] = useState(0);
  useEffect(() => { const h = () => tick((n) => n + 1); window.addEventListener('erp:hidden', h); return () => window.removeEventListener('erp:hidden', h); }, []);
  const remove = useCallback((id, message, commit, opts = {}) => {
    const ids = Array.isArray(id) ? id : [id];
    setHiddenSet(scope, new Set([...hiddenSet(scope), ...ids]));
    const unhide = () => { const n = new Set(hiddenSet(scope)); ids.forEach((x) => n.delete(x)); setHiddenSet(scope, n); };
    toast.undoable(message, { commit, seconds: opts.seconds, onUndo: unhide, onDone: () => { afterCommit?.(); opts.onDone?.(); setTimeout(unhide, 1500); window.dispatchEvent(new Event('erp:data-changed')); } });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, scope]);
  return { hidden: hiddenSet(scope), remove };
}

/** Lookup helpers derived from meta. */
export function useLookups() {
  const { meta } = useMeta();
  return useMemo(() => {
    const L = meta?.lookups || {};
    const list = (t) => (L[t] || []).map((x) => x.value);
    const byId = (t) => Object.fromEntries((L[t] || []).map((x) => [x.id, x]));
    return {
      L, list, stages: L.lead_stage || [], stageById: byId('lead_stage'),
      users: meta?.users || [], agents: (meta?.users || []).filter((u) => u.role === 'Sales Agent'),
      managers: (meta?.users || []).filter((u) => ['Sales Manager', 'Admin', 'Super Admin'].includes(u.role)),
      projects: meta?.projects || [], accounts: meta?.accounts || [],
      treasury: (meta?.accounts || []).filter((a) => ['cash', 'bank', 'custody', 'online'].includes(a.subtype)),
      expenseAccounts: (meta?.accounts || []).filter((a) => a.type === 'expense' && !(meta.accounts || []).some((c) => c.parent_id === a.id)),
      customFields: meta?.custom_fields || [], settings: meta?.settings || {},
    };
  }, [meta]);
}

/** Generic data hook: GET url?params, with reload. */
export function useFetch(url, params, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const key = url ? url + JSON.stringify(params || {}) : null;
  const reload = useCallback(async () => {
    if (!url) return;
    setState((s) => ({ ...s, loading: true }));
    try { const data = await api.get(url, params); setState({ data, loading: false, error: null }); }
    catch (e) { setState({ data: null, loading: false, error: e.message }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { reload(); }, [reload, ...deps]);
  useEffect(() => { if (!url) return undefined; const h = () => reload(); window.addEventListener('erp:data-changed', h); return () => window.removeEventListener('erp:data-changed', h); }, [reload, url]);
  return { ...state, reload, setData: (data) => setState((s) => ({ ...s, data })) };
}
