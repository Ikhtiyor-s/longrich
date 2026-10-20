import { useCallback, useEffect, useRef, useState } from 'react';

const TOAST_DURATION_MS = 3000;

export interface SoftDisabledState {
  toastVisible: boolean;
  activate: () => void;
}

export function useSoftDisabled(onActivate?: () => void): SoftDisabledState {
  const [toastVisible, setToastVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const activate = useCallback(() => {
    setToastVisible(true);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => setToastVisible(false), TOAST_DURATION_MS);
    onActivate?.();
  }, [onActivate]);

  return { toastVisible, activate };
}
