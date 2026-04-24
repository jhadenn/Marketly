'use client'

import { useState } from 'react'
import Image from 'next/image'
import { AnimatePresence, motion } from 'motion/react'
import {
    ArrowUpRightIcon,
    BotIcon,
    CheckCircle2Icon,
    SearchIcon,
    SparklesIcon,
    type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type ShowcasePanel = {
    id: string
    label: string
    kicker: string
    title: string
    description: string
    image: string
    icon: LucideIcon
    chips: string[]
    bullets: string[]
}

const panels: ShowcasePanel[] = [
    {
        id: 'search',
        label: 'Live feed',
        kicker: 'Search state',
        title: 'A merged results feed that still feels readable.',
        description:
            'This is the actual search surface: filters on the left, results in the center, and quick context panels that make scanning easier.',
        image: '/screenshots/marketly-search-feed.png',
        icon: SearchIcon,
        chips: ['Live query', '3 sources selected', 'Nearby ranking active'],
        bullets: [
            'Source badges stay visible while you scan the grid.',
            'Filters, sort, and location live in one stable surface.',
            'The UI keeps the search state easy to re-run later.',
        ],
    },
    {
        id: 'copilot',
        label: 'Copilot',
        kicker: 'Assist state',
        title: 'Ask questions without leaving the search context.',
        description:
            'The copilot view sits on top of the live search so you can shortlist listings, compare value, and stay grounded in what is on screen.',
        image: '/screenshots/marketly-copilot-panel.png',
        icon: BotIcon,
        chips: ['Shortlist aware', 'Context from visible listings', 'Value discussion'],
        bullets: [
            'Move from browsing to decision support in the same session.',
            'Shortlisted cards stay visible inside the assistant panel.',
            'The interaction feels like a continuation of the search, not a detour.',
        ],
    },
]

export default function LandingShowcase() {
    const [activeId, setActiveId] = useState(panels[0].id)
    const activePanel = panels.find((panel) => panel.id === activeId) ?? panels[0]
    const ActiveIcon = activePanel.icon

    return (
        <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950/80 shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.05),transparent_28%)]" />
            <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,0.75)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.75)_1px,transparent_1px)] [background-size:20px_20px]" />

            <div className="relative border-b border-white/10 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                            <SparklesIcon className="size-3.5" />
                            Real product states
                        </p>
                        <p className="mt-3 max-w-md text-sm leading-relaxed text-zinc-400">
                            Switch between live search and copilot views to see how Marketly behaves after the hero.
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {panels.map((panel) => {
                            const PanelIcon = panel.icon
                            const isActive = panel.id === activePanel.id

                            return (
                                <button
                                    key={panel.id}
                                    type="button"
                                    onClick={() => setActiveId(panel.id)}
                                    className={cn(
                                        'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition',
                                        isActive
                                            ? 'border-white/20 bg-white/[0.08] text-white'
                                            : 'border-white/10 bg-black/20 text-zinc-400 hover:border-white/20 hover:text-zinc-200'
                                    )}
                                >
                                    <PanelIcon className="size-4" />
                                    <span>{panel.label}</span>
                                </button>
                            )
                        })}
                    </div>
                </div>
            </div>

            <div className="grid gap-5 p-4 sm:p-5 xl:grid-cols-[minmax(0,1fr)_280px]">
                <div className="relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-black/30">
                    <div className="pointer-events-none absolute inset-x-6 top-0 z-10 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

                    <AnimatePresence mode="wait">
                        <motion.div
                            key={activePanel.id}
                            initial={{ opacity: 0, y: 18, scale: 0.985 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -18, scale: 0.985 }}
                            transition={{ duration: 0.35, ease: 'easeOut' }}
                        >
                            <Image
                                src={activePanel.image}
                                alt={activePanel.title}
                                width={1512}
                                height={982}
                                className="h-auto w-full object-cover"
                            />
                        </motion.div>
                    </AnimatePresence>

                    <div className="pointer-events-none absolute inset-x-4 bottom-4 flex flex-wrap gap-2">
                        {activePanel.chips.map((chip) => (
                            <span
                                key={chip}
                                className="rounded-full border border-white/10 bg-zinc-950/80 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300 backdrop-blur"
                            >
                                {chip}
                            </span>
                        ))}
                    </div>
                </div>

                <AnimatePresence mode="wait">
                    <motion.div
                        key={`${activePanel.id}-copy`}
                        initial={{ opacity: 0, x: 14 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -14 }}
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                        className="flex flex-col gap-4"
                    >
                        <div className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset]">
                            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                                <ActiveIcon className="size-3.5" />
                                {activePanel.kicker}
                            </div>

                            <h3 className="mt-4 text-xl font-semibold tracking-tight text-white">{activePanel.title}</h3>
                            <p className="mt-3 text-sm leading-relaxed text-zinc-400">{activePanel.description}</p>
                        </div>

                        <div className="grid gap-3">
                            {activePanel.bullets.map((bullet) => (
                                <div
                                    key={bullet}
                                    className="flex items-start gap-3 rounded-2xl border border-white/10 bg-zinc-950/70 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset]"
                                >
                                    <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-zinc-200" />
                                    <span className="text-sm leading-relaxed text-zinc-300">{bullet}</span>
                                </div>
                            ))}
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-zinc-300">
                            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                                Interactive
                            </div>
                            <p className="mt-2 leading-relaxed text-zinc-400">
                                This module is intentionally clickable so the landing page feels like a product tour instead of a static brochure.
                            </p>
                            <div className="mt-4 inline-flex items-center gap-2 text-zinc-100">
                                <span>Explore the flow</span>
                                <ArrowUpRightIcon className="size-4" />
                            </div>
                        </div>
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>
    )
}
