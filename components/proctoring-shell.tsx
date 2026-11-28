'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Info } from 'lucide-react';

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
 * The rules the candidate confirms before the exam (supervisor review 1).
 * Each one matches something the proctoring checks; the last is the declaration.
 */
export const AGREEMENT_RULES: ReadonlyArray<{ label: string; text: string }> = [
  {
    label: 'Examination window',
    text: 'I will remain on the examination page in full-screen mode. I will not switch tabs, open other windows or use other applications.',
  },
  {
    label: 'Camera presence',
    text: 'I will keep my face clearly visible to the camera throughout the examination.',
  },
  {
    label: 'Attention',
    text: 'I will keep my attention on my screen and my answer paper. I will not look to the left, to the right or upward.',
  },
  {
    label: 'Independent work',
    text: "I will not view another candidate's screen or paper, and no other person will be present within the camera's view.",
  },
  {
    label: 'Electronic devices',
    text: 'I will not use a mobile phone, an additional computer or any other electronic device.',
  },
  {
    label: 'Permitted materials',
    text: 'I will not use books, notes or any printed material. Only pen and paper are permitted.',
  },
  {
    label: 'Camera',
    text: 'I will keep my camera switched on and will not cover, block or disconnect it.',
  },
  {
    label: 'Declaration',
    text: 'I have read and understood these rules. I agree to abide by them and accept the examination terms and conditions.',
  },
];

/**
 * On every page after login: asks for the agreement once per login, then keeps the
 * camera preview and the full-screen lock on (the watcher's preview mode).
 * If the camera cannot start, the portal works as normal and the report records it.
 * On the login page it switches everything off (logout).
 */
export function ProctoringShell() {
  const pathname = usePathname();
  const router = useRouter();
  const [consentFor, setConsentFor] = useState<number | null>(null);
  const [ticked, setTicked] = useState<boolean[]>(() => AGREEMENT_RULES.map(() => false));

  useEffect(() => {
    setTicked(AGREEMENT_RULES.map(() => false));
  }, [consentFor]);

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

  const allTicked = ticked.every(Boolean);

  const agree = () => {
    if (!allTicked) return;
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

  const toggle = (index: number) => {
    setTicked((current) => current.map((value, i) => (i === index ? !value : value)));
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
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col rounded-xl bg-white text-gray-900 shadow-2xl">
        <div className="border-b border-gray-200 px-6 pb-4 pt-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-blue-100 text-blue-700">
            <Info className="h-6 w-6" aria-hidden="true" />
          </div>
          <h2 id="proctoring-consent-title" className="text-xl font-semibold">
            Proctored Examination Agreement
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Please read and confirm each statement below before you begin your examination.
          </p>
        </div>
        <ul className="flex-1 space-y-2 overflow-y-auto px-6 py-4">
          {AGREEMENT_RULES.map((rule, index) => {
            const id = `proctoring-rule-${index}`;
            return (
              <li key={rule.label}>
                <label
                  htmlFor={id}
                  className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
                    ticked[index] ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <input
                    id={id}
                    type="checkbox"
                    checked={ticked[index]}
                    onChange={() => toggle(index)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-blue-700"
                  />
                  <span className="text-sm">
                    <span className="block font-semibold text-gray-900">{rule.label}</span>
                    <span className="block text-gray-700">{rule.text}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="border-t border-gray-200 px-6 pb-6 pt-4 text-center">
          <p className="mb-3 text-xs text-gray-600">
            Any breach of these rules may result in your examination being reported.
          </p>
          <Button
            type="button"
            onClick={agree}
            disabled={!allTicked}
            className="w-full bg-blue-700 text-white hover:bg-blue-800 sm:w-auto sm:px-8"
          >
            I understand and agree
          </Button>
          <div className="mt-2">
            <Button type="button" variant="ghost" onClick={logOut} className="text-gray-600">
              Log out
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProctoringShell;
