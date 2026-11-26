// Direct port of the typewriter hook from src/pages/Login.tsx (web) — no DOM
// dependency, so it moves over unchanged.
import { useEffect, useRef, useState } from "react";

export function useTypewriter(words: string[], speed = 80, pause = 2400) {
  const [wordIdx, setWordIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);

  // Callers usually pass an inline array literal (a new array every render).
  // Depend on its *content* instead, so the effect doesn't re-run on every render.
  const wordsRef = useRef(words);
  wordsRef.current = words;
  const wordsKey = words.join("\u0000");

  useEffect(() => {
    const list = wordsRef.current;
    if (list.length === 0) return;
    const word = list[wordIdx % list.length] ?? "";
    let t: ReturnType<typeof setTimeout>;
    if (!deleting && charIdx < word.length) t = setTimeout(() => setCharIdx((c) => c + 1), speed);
    else if (!deleting) t = setTimeout(() => setDeleting(true), pause);
    else if (charIdx > 0) t = setTimeout(() => setCharIdx((c) => c - 1), speed / 2);
    else {
      // Move to the next word on a timer too — never setState synchronously in the effect.
      t = setTimeout(() => {
        setDeleting(false);
        setWordIdx((i) => i + 1);
      }, speed);
    }
    return () => clearTimeout(t);
  }, [charIdx, deleting, wordIdx, wordsKey, speed, pause]);

  const list = words.length ? words : [""];
  return list[wordIdx % list.length].slice(0, charIdx);
}
