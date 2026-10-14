import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
export function useRememberedState<T>(key: string, initial: T, valid: (value: unknown) => boolean): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = sessionStorage.getItem(`testpaq-view:${key}`);
      if (saved !== null) {
        const parsed: unknown = JSON.parse(saved);
        if (valid(parsed)) return parsed as T;
      }
    } catch {
      /* Preferences are optional. */
    }
    return initial;
  });
  useEffect(() => {
    try {
      const text = JSON.stringify(value);
      if (text === undefined) sessionStorage.removeItem(`testpaq-view:${key}`);
      else sessionStorage.setItem(`testpaq-view:${key}`, text);
    } catch {
      /* Keep this session usable without storage. */
    }
  }, [key, value]);
  return [value, setValue];
}
