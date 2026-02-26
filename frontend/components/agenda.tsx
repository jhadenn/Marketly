import React from 'react'
import {
    BellRingIcon,
    Layers3Icon,
    SearchIcon,
    SlidersHorizontalIcon,
    SparklesIcon,
    type LucideIcon,
} from 'lucide-react'
import { TextEffect } from '@/components/motion-primitives/text-effect'
import { AnimatedGroup } from '@/components/motion-primitives/animated-group'
import { transitionVariants } from '@/lib/utils'

type WorkflowStep = {
    step: string
    title: string
    description: string
    detail: string
    icon: LucideIcon
}

const steps: WorkflowStep[] = [
    {
        step: '01',
        title: 'Enter your search',
        description: "Type what you're looking for and choose the marketplaces you want to include.",
        detail: 'Start broad, then narrow as you learn what the market looks like.',
        icon: SearchIcon,
    },
    {
        step: '02',
        title: 'Aggregate results',
        description: 'Marketly pulls live listings from your selected sources into one combined feed.',
        detail: 'No tab juggling. One place to scan and compare.',
        icon: Layers3Icon,
    },
    {
        step: '03',
        title: 'Compare instantly',
        description: 'Review normalized cards side-by-side so price and listing quality stand out faster.',
        detail: 'Spend less time re-orienting to different marketplace layouts.',
        icon: SlidersHorizontalIcon,
    },
    {
        step: '04',
        title: 'Save and monitor',
        description: 'Save the queries that matter and come back to them when you want another pass.',
        detail: 'A repeatable workflow for active deal hunting.',
        icon: BellRingIcon,
    },
]

const workflowSignals = [
    'No tab switching loop',
    'Live multi-source search',
    'Repeatable saved workflows',
]

export default function Agenda() {
    return (
        <section className="relative scroll-py-16 py-20 md:scroll-py-32 md:py-28">
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute left-10 top-8 h-40 w-40 rounded-full bg-white/5 blur-3xl" />
                <div className="absolute right-10 top-20 h-48 w-48 rounded-full bg-indigo-400/10 blur-3xl" />
            </div>

            <div className="relative mx-auto max-w-6xl px-6">
                <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
                    <div className="lg:sticky lg:top-24">
                        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/60 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset] backdrop-blur-xl">
                            <div className="relative">
                                <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                                    <SparklesIcon className="size-3.5" />
                                    Workflow
                                </p>

                                <TextEffect
                                    triggerOnView
                                    preset="fade-in-blur"
                                    speedSegment={0.3}
                                    as="h2"
                                    className="mt-4 text-balance text-3xl font-semibold tracking-tight md:text-4xl"
                                >
                                    From search to decision — faster.
                                </TextEffect>

                                <p className="mt-4 text-sm leading-relaxed text-zinc-400">
                                    Built for people who don’t want to search twice. One interface. Live data. No tab switching.
                                </p>

                                <div className="mt-6 space-y-2">
                                    {workflowSignals.map((signal) => (
                                        <div
                                            key={signal}
                                            className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-zinc-200"
                                        >
                                            {signal}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    <AnimatedGroup
                        triggerOnView
                        variants={{
                            container: {
                                visible: {
                                    transition: {
                                        staggerChildren: 0.05,
                                        delayChildren: 0.2,
                                    },
                                },
                            },
                            ...transitionVariants,
                        }}
                        className="grid gap-3"
                    >
                        {steps.map((entry) => (
                            <WorkflowCard key={entry.step} entry={entry} />
                        ))}
                    </AnimatedGroup>
                </div>
            </div>
        </section>
    )
}

function WorkflowCard({ entry }: { entry: WorkflowStep }) {
    const Icon = entry.icon

    return (
        <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/50 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset] backdrop-blur-xl sm:p-5">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white/[0.03] via-transparent to-transparent opacity-70" />

            <div className="relative flex gap-4">
                <div className="flex shrink-0 flex-col items-center">
                    <div className="inline-flex min-w-12 items-center justify-center rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs tracking-[0.18em] text-zinc-300">
                        {entry.step}
                    </div>
                    <div className="mt-2 h-full w-px bg-gradient-to-b from-white/10 to-transparent" />
                </div>

                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2 text-zinc-100">
                            <Icon className="size-4" />
                        </div>
                        <h3 className="text-base font-semibold tracking-tight text-white sm:text-lg">{entry.title}</h3>
                    </div>

                    <p className="mt-3 text-sm leading-relaxed text-zinc-300">{entry.description}</p>
                    <p className="mt-2 text-xs leading-relaxed text-zinc-500">{entry.detail}</p>
                </div>
            </div>
        </div>
    )
}
