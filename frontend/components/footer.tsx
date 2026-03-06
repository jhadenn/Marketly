import Link from 'next/link'
import { ArrowUpRightIcon, SparklesIcon } from 'lucide-react'

const quickLinks = [
    { title: 'Search', href: '/search' },
    { title: 'Login', href: '/login' },
]


export default function FooterSection() {
    return (
        <footer className="relative overflow-hidden py-16 md:py-24">
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute left-10 top-8 h-40 w-40 rounded-full bg-white/5 blur-3xl" />
                <div className="absolute right-10 bottom-8 h-44 w-44 rounded-full bg-indigo-400/10 blur-3xl" />
            </div>

            <div className="relative mx-auto max-w-6xl px-6">
                <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/60 shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset] backdrop-blur-xl">
                    <div className="pointer-events-none absolute inset-x-0 top-0 mx-6 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

                    <div className="grid gap-6 p-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:p-8">
                        <div>
                            <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                                <SparklesIcon className="size-3.5" />
                                Marketly
                            </p>

                            <h3 className="mt-4 text-balance text-2xl font-semibold tracking-tight text-white md:text-3xl">
                                Built for fast marketplace research.
                            </h3>
                            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
                                A cleaner workflow for comparing listings across marketplaces without tab sprawl.
                            </p>

                        </div>

                        <div className="grid gap-3 sm:min-w-56">
                            {quickLinks.map((link) => (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    className="group inline-flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.05]"
                                >
                                    <span>{link.title}</span>
                                    <ArrowUpRightIcon className="size-4 text-zinc-500 transition group-hover:text-zinc-200" />
                                </Link>
                            ))}
                        </div>
                    </div>

                    <div className="flex flex-col gap-2 border-t border-white/10 px-6 py-4 text-xs text-zinc-500 md:flex-row md:items-center md:justify-between md:px-8">
                        <span>Built by Jhaden Goy</span>
                        <span className="font-mono uppercase tracking-[0.16em] text-zinc-600">Marketly</span>
                    </div>
                </div>
            </div>
        </footer>
    )
}
