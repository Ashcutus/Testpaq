import { Laptop, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";

export function ThemeControl() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem("testpaq-theme");
      return saved === "light" || saved === "dark" ? saved : "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => (document.documentElement.dataset.theme = theme === "system" ? (query.matches ? "dark" : "light") : theme);
    apply();
    query.addEventListener("change", apply);
    try {
      localStorage.setItem("testpaq-theme", theme);
    } catch {
      /* Theme remains usable without browser storage. */
    }
    return () => query.removeEventListener("change", apply);
  }, [theme]);
  const items: Array<[Theme, typeof Sun]> = [
    ["system", Laptop],
    ["light", Sun],
    ["dark", Moon],
  ];
  return (
    <div className="theme-control" aria-label="Colour theme">
      {items.map(([value, Icon]) => (
        <button key={value} aria-label={`${value} theme`} aria-pressed={theme === value} onClick={() => setTheme(value)}>
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}
