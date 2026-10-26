import { useEffect, useState } from 'react';
import { flushQueue, myQueue } from '../api.js';
import { useToast } from '../context.jsx';

/** Shows "offline — N saved on this device" and confirms when queued actions sync. */
export default function OfflineBar() {
  const toast = useToast();
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [n, setN] = useState(myQueue().length);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false), q = () => setN(myQueue().length);
    const synced = (e) => {
      const { sent, failed } = e.detail;
      if (sent) toast(`Back online — ${sent} saved action${sent > 1 ? 's' : ''} synced`, 'ok');
      for (const f of failed) toast(`Could not sync: ${f.error}`, 'err');
    };
    window.addEventListener('online', on); window.addEventListener('offline', off); window.addEventListener('erp:queue', q); window.addEventListener('erp:synced', synced);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); window.removeEventListener('erp:queue', q); window.removeEventListener('erp:synced', synced); };
  }, [toast]);
  if (online && !n) return null;
  return (
    <div className={`offline-bar no-print ${online ? 'sync' : ''}`} role="status">
      {online ? `Syncing ${n} saved action${n > 1 ? 's' : ''}…` : `You're offline${n ? ` — ${n} action${n > 1 ? 's' : ''} saved on this device` : ' — notes, tasks and leads will be saved and sent later'}`}
      {online && n > 0 && <button className="btn sm ghost" style={{ color: '#fff', marginLeft: 8 }} onClick={() => flushQueue()}>Retry now</button>}
    </div>
  );
}
