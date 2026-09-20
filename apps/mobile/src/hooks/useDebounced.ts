import { useEffect, useState } from 'react';

/**
 * Delays a fast-changing value.
 *
 * Search boxes fire a request per keystroke otherwise, and the public search
 * bucket allows 60 a minute — a two-word query typed at speed can use a fifth
 * of that on results nobody reads.
 */
export function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
