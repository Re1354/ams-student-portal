'use client';

import { useCallback, useEffect } from 'react';

/**
 * Optional exam proctoring (separate ams-proctoring service).
 * Does nothing unless NEXT_PUBLIC_PROCTORING_URL is set.
 */
const PROCTORING_URL = (process.env.NEXT_PUBLIC_PROCTORING_URL || '').replace(/\/+$/, '');
const SCRIPT_ID = 'ams-proctor-script';

type AMSProctor = {
  start: (opts: {
    serverUrl: string;
    studentId: number;
    examId: number;
    username: string;
    fullName: string;
  }) => Promise<void>;
  stop: (opts: { end: boolean; reason?: 'LEFT_EXAM' }) => Promise<void>;
};

declare global {
  interface Window {
    AMSProctor?: AMSProctor;
  }
}

let scriptPromise: Promise<AMSProctor> | null = null;

function loadWatcher(): Promise<AMSProctor> {
  if (window.AMSProctor) return Promise.resolve(window.AMSProctor);
  scriptPromise ??= new Promise<AMSProctor>((resolve, reject) => {
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = `${PROCTORING_URL}/static/proctoring/watcher.js`;
    script.async = true;
    script.onload = () =>
      window.AMSProctor ? resolve(window.AMSProctor) : reject(new Error('watcher missing'));
    script.onerror = () => {
      scriptPromise = null;
      script.remove();
      reject(new Error('Could not load the proctoring watcher'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

const isSubmitted = (key?: string) => !!key && localStorage.getItem(key) === 'true';

export function useProctoring(opts: {
  studentId?: number;
  examId?: number;
  username?: string;
  fullName?: string;
  submittedKey?: string;
}): { leftExam: () => void } {
  const { studentId, examId, username, fullName, submittedKey } = opts;
  const enabled = !!PROCTORING_URL && studentId != null && examId != null;

  useEffect(() => {
    if (!enabled || isSubmitted(submittedKey)) return;
    let cancelled = false;
    loadWatcher()
      .then((proctor) => {
        if (cancelled) return;
        return proctor.start({
          serverUrl: PROCTORING_URL,
          studentId: studentId!,
          examId: examId!,
          username: username || '',
          fullName: fullName || '',
        });
      })
      .catch((err) => console.warn('Proctoring unavailable:', err));
    return () => {
      cancelled = true;
      // Every submit path sets the submitted key before leaving the page.
      void window.AMSProctor?.stop({ end: isSubmitted(submittedKey) });
    };
  }, [enabled, studentId, examId, username, fullName, submittedKey]);

  const leftExam = useCallback(() => {
    if (!enabled) return;
    void window.AMSProctor?.stop({ end: false, reason: 'LEFT_EXAM' });
  }, [enabled]);

  return { leftExam };
}
