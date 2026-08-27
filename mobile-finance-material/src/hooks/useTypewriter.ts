// Direct port of the typewriter hook from src/pages/Login.tsx (web) — no DOM
// dependency, so it moves over unchanged.
import { useEffect, useState } from "react";

export function useTypewriter(words: string[], speed = 80, pause = 2400) {
  const [wordIdx, setWordIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const word = words[wordIdx % words.length];
    let t: ReturnType<typeof setTimeout>;
    if (!deleting && charIdx < word.length) t = setTimeout(() => setCharIdx((c) => c + 1), speed);
    else if (!deleting && charIdx === word.length) t = setTimeout(() => setDeleting(true), pause);
    else if (deleting && charIdx > 0) t = setTimeout(() => setCharIdx((c) => c - 1), speed / 2);
    else {
      setDeleting(false);
      setWordIdx((i) => i + 1);
    }
    return () => clearTimeout(t);
  }, [charIdx, deleting, wordIdx, words, speed, pause]);

  return words[wordIdx % words.length].slice(0, charIdx);
}
