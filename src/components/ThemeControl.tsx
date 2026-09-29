import { Laptop, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";

export function ThemeControl() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("testpaq-theme") as Theme) || "system");
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => (document.documentElement.dataset.theme = theme === "system" ? (query.matches ? "dark" : "light") : theme);
    apply();
    query.addEventListener("change", apply);
    localStorage.setItem("testpaq-theme", theme);
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
