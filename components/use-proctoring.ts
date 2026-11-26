'use client';

import { useCallback, useEffect } from 'react';
import { API_BASE_URL } from '@/lib/utils';

/**
 * Exam proctoring (camera and full-screen checks), served from this portal's
 * public/proctoring/ folder and talking to the AMS backend.
 * On by default; NEXT_PUBLIC_PROCTORING=off turns it off completely.
 * Fails open: if the watcher or the backend's proctoring endpoints are missing,
 * the exam works exactly as without proctoring.
 */
export const PROCTORING_ENABLED = process.env.NEXT_PUBLIC_PROCTORING !== 'off';
export const PROCTORING_API_BASE = `${API_BASE_URL}/proctoring`;
export const PROCTORING_ASSET_BASE = '/proctoring';

const SCRIPT_ID = 'ams-proctor-script';
const CONSENT_KEY = 'amsProctoringConsent';
const AVAILABLE_KEY = 'amsProctoringAvailable';
export const CONSENT_EVENT = 'ams-proctoring-consent';

type PreviewOptions = { apiBase: string; assetBase: string; studentId: number };

type AMSProctor = {
  preview: (opts: PreviewOptions) => Promise<void>;
  start: (opts: {
    apiBase: string;
    assetBase: string;
    studentId: number;
    examId: number;
    username: string;
    fullName: string;
    consentAt?: string;
  }) => Promise<void>;
  stop: (opts: { end: boolean; reason?: 'LEFT_EXAM' }) => Promise<void>;
  shutdown: () => Promise<void>;
  unlocked: () => { fullscreen: boolean; camera: boolean };
  /** Support staff code: take the exam without camera (the camera is never opened). */
  unlockCamera?: (opts: { apiBase: string; studentId: number; code: string }) => Promise<{ ok: boolean; message: string }>;
};

declare global {
  interface Window {
    AMSProctor?: AMSProctor;
  }
}

let scriptPromise: Promise<AMSProctor> | null = null;

export function loadWatcher(): Promise<AMSProctor> {
  if (window.AMSProctor) return Promise.resolve(window.AMSProctor);
  scriptPromise ??= new Promise<AMSProctor>((resolve, reject) => {
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = `${PROCTORING_ASSET_BASE}/watcher.js`;
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

function safeSession(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Consent given in this login (ISO time), or null. */
export function readConsent(studentId: number): string | null {
  try {
    const raw = safeSession()?.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { studentId?: number; at?: string };
    return parsed.studentId === studentId && typeof parsed.at === 'string' ? parsed.at : null;
  } catch {
    return null;
  }
}

export function saveConsent(studentId: number, at: string = new Date().toISOString()): string {
  try {
    safeSession()?.setItem(CONSENT_KEY, JSON.stringify({ studentId, at }));
  } catch {
    // storage blocked: consent is asked again after a reload
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: { studentId, at } }));
  return at;
}

/** Logout: forget consent and the backend check. */
export function clearProctoringSession() {
  try {
    safeSession()?.removeItem(CONSENT_KEY);
    safeSession()?.removeItem(AVAILABLE_KEY);
  } catch {
    // nothing stored
  }
}

let availablePromise: Promise<boolean> | null = null;

/**
 * Does the backend have the proctoring endpoints? A 404 means an older backend:
 * proctoring stays off for this login. Network trouble counts as available
 * (the watcher retries on its own and never blocks the exam for that).
 */
export function proctoringAvailable(): Promise<boolean> {
  const stored = safeSession()?.getItem(AVAILABLE_KEY);
  if (stored === '1') return Promise.resolve(true);
  if (stored === '0') return Promise.resolve(false);
  availablePromise ??= fetch(`${PROCTORING_API_BASE}/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
    .then((res) => res.status !== 404)
    .catch(() => true)
    .then((available) => {
      try {
        safeSession()?.setItem(AVAILABLE_KEY, available ? '1' : '0');
      } catch {
        // checked again next time
      }
      availablePromise = null;
      return available;
    });
  return availablePromise;
}

function waitForConsent(studentId: number): Promise<string> {
  const existing = readConsent(studentId);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const onConsent = () => {
      const at = readConsent(studentId);
      if (!at) return;
      window.removeEventListener(CONSENT_EVENT, onConsent);
      resolve(at);
    };
    window.addEventListener(CONSENT_EVENT, onConsent);
  });
}

const isSubmitted = (key?: string) => !!key && localStorage.getItem(key) === 'true';

/** Exam page: start the proctoring session (flags count from here), end it on submit. */
export function useProctoring(opts: {
  studentId?: number;
  examId?: number;
  username?: string;
  fullName?: string;
  submittedKey?: string;
}): { leftExam: () => void } {
  const { studentId, examId, username, fullName, submittedKey } = opts;
  const enabled = PROCTORING_ENABLED && studentId != null && examId != null;

  useEffect(() => {
    if (!enabled || isSubmitted(submittedKey)) return;
    let cancelled = false;
    let started = false;
    (async () => {
      if (!(await proctoringAvailable()) || cancelled) return;
      const proctor = await loadWatcher();
      const consentAt = await waitForConsent(studentId!);
      if (cancelled) return;
      // Same camera and full-screen lock as the other pages; waits until the camera is on or skipped.
      await proctor.preview({ apiBase: PROCTORING_API_BASE, assetBase: PROCTORING_ASSET_BASE, studentId: studentId! });
      if (cancelled) return;
      started = true;
      await proctor.start({
        apiBase: PROCTORING_API_BASE,
        assetBase: PROCTORING_ASSET_BASE,
        studentId: studentId!,
        examId: examId!,
        username: username || '',
        fullName: fullName || '',
        consentAt,
      });
    })().catch((err) => console.warn('Proctoring unavailable:', err));
    return () => {
      cancelled = true;
      // Every submit path sets the submitted key before leaving the page.
      if (started) void window.AMSProctor?.stop({ end: isSubmitted(submittedKey) });
    };
  }, [enabled, studentId, examId, username, fullName, submittedKey]);

  const leftExam = useCallback(() => {
    if (!enabled) return;
    void window.AMSProctor?.stop({ end: false, reason: 'LEFT_EXAM' });
  }, [enabled]);

  return { leftExam };
}
