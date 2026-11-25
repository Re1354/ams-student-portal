'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Camera } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  clearProctoringSession,
  loadWatcher,
  PROCTORING_API_BASE,
  PROCTORING_ASSET_BASE,
  PROCTORING_ENABLED,
  proctoringAvailable,
  readConsent,
  saveConsent,
} from '@/components/use-proctoring';

function loggedInStudentId(): number | null {
  try {
    const raw = localStorage.getItem('studentData');
    if (!raw) return null;
    const id = Number(JSON.parse(raw)?.studentId);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * On every page after login: asks for consent once per login, then keeps the
 * camera preview and the full-screen lock on (the watcher's preview mode).
 * On the login page it switches everything off (logout).
 */
export function ProctoringShell() {
  const pathname = usePathname();
  const router = useRouter();
  const [consentFor, setConsentFor] = useState<number | null>(null);

  useEffect(() => {
    if (!PROCTORING_ENABLED) return;
    if (pathname === '/') {
      setConsentFor(null);
      clearProctoringSession();
      void window.AMSProctor?.shutdown();
      return;
    }
    const studentId = loggedInStudentId();
    if (studentId === null) {
      setConsentFor(null);
      return;
    }
    let cancelled = false;
    (async () => {
      if (!(await proctoringAvailable()) || cancelled) return;
      const proctor = await loadWatcher();
      if (cancelled) return;
      if (!readConsent(studentId)) {
        setConsentFor(studentId);
        return;
      }
      setConsentFor(null);
      await proctor.preview({ apiBase: PROCTORING_API_BASE, assetBase: PROCTORING_ASSET_BASE, studentId });
    })().catch((err) => console.warn('Proctoring unavailable:', err));
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (consentFor === null) return null;

  const agree = () => {
    const studentId = consentFor;
    saveConsent(studentId);
    setConsentFor(null);
    // Called inside the click, so the watcher can enter full screen.
    void window.AMSProctor?.preview({
      apiBase: PROCTORING_API_BASE,
      assetBase: PROCTORING_ASSET_BASE,
      studentId,
    });
  };

  const logOut = () => {
    localStorage.removeItem('studentData');
    localStorage.removeItem('examSchedule');
    localStorage.removeItem('selectedExamId');
    localStorage.removeItem('selectedExamSchedule');
    setConsentFor(null);
    router.push('/');
  };

  return (
    <div
      className="fixed inset-0 z-[2147483000] flex items-center justify-center bg-gray-900/90 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="proctoring-consent-title"
    >
      <div className="w-full max-w-lg rounded-xl bg-white p-6 text-gray-900 shadow-2xl">
        <div className="mb-3 flex items-center gap-3">
          <div className="rounded-full bg-blue-100 p-2 text-blue-700">
            <Camera className="h-5 w-5" />
          </div>
          <h2 id="proctoring-consent-title" className="text-xl font-semibold">
            Exam proctoring
          </h2>
        </div>
        <p className="mb-3 text-sm text-gray-700">
          Your written exam is proctored. Before you continue, please read what is checked.
        </p>
        <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-gray-700">
          <li>Your camera is on while you are logged in. A small preview shows at the bottom right.</li>
          <li>
            During the exam, a photo is saved only when a rule is broken, for example another person or a
            phone in view.
          </li>
          <li>Leaving the exam window or leaving full screen is recorded.</li>
          <li>Only the exam controller sees these records.</li>
          <li>This portal stays in full screen until you log out.</li>
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={agree} className="bg-blue-700 hover:bg-blue-800 text-white">
            I agree, start camera
          </Button>
          <Button type="button" variant="ghost" onClick={logOut} className="text-gray-600">
            Log out
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ProctoringShell;
