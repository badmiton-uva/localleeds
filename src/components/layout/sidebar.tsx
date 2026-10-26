"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  Building2,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  Menu,
  Radar,
  Search,
  Settings,
  Target,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";
import { signOut } from "@/app/(auth)/actions";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/discover", label: "Descubrir empresas", icon: Search },
  { href: "/companies", label: "Mis empresas", icon: Building2 },
  { href: "/opportunities", label: "Oportunidades", icon: Target },
  { href: "/crm", label: "CRM", icon: KanbanSquare },
  { href: "/reports", label: "Informes", icon: BarChart3 },
  { href: "/settings", label: "Configuración", icon: Settings },
];

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 px-2 font-semibold tracking-tight">
      <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Radar className="size-4" />
      </span>
      LocalLead
    </Link>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Principal">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
              active ? "bg-accent-soft font-medium text-accent" : "text-foreground/75 hover:bg-surface-2 hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function UserBox({ email }: { email: string | null }) {
  return (
    <div className="mt-auto flex items-center gap-1 border-t pt-3">
      <div className="min-w-0 flex-1 px-2">
        <p className="truncate text-xs font-medium">{email ?? "Usuario"}</p>
      </div>
      <ThemeToggle />
      <form action={signOut}>
        <button
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
          className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-surface-2"
        >
          <LogOut className="size-4" />
        </button>
      </form>
    </div>
  );
}

export function Sidebar({ email, devMode }: { email: string | null; devMode: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Escritorio */}
      <aside className="no-print sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-4 border-r bg-surface p-3 lg:flex">
        <Brand />
        <NavList />
        {devMode && (
          <p className="rounded-md border border-warning/30 bg-warning-soft px-2 py-1.5 text-[11px] leading-snug">
            Modo local sin Supabase Auth (AUTH_MODE=dev).
          </p>
        )}
        <UserBox email={email} />
      </aside>

      {/* Móvil */}
      <header className="no-print sticky top-0 z-30 flex h-12 items-center justify-between border-b bg-background/95 px-3 backdrop-blur lg:hidden">
        <Brand />
        <button aria-label="Abrir menú" onClick={() => setOpen(true)} className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-surface-2">
          <Menu className="size-5" />
        </button>
      </header>
      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-4 bg-surface p-3 shadow-xl">
            <div className="flex items-center justify-between">
              <Brand />
              <button aria-label="Cerrar menú" onClick={() => setOpen(false)} className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-surface-2">
                <X className="size-5" />
              </button>
            </div>
            <NavList onNavigate={() => setOpen(false)} />
            <UserBox email={email} />
          </aside>
        </div>
      )}
    </>
  );
}
