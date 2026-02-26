import React from 'react'
import {
    BellRingIcon,
    Layers3Icon,
    SparklesIcon,
    type LucideIcon,
} from 'lucide-react'
import { TextEffect } from '@/components/motion-primitives/text-effect'
import { AnimatedGroup } from '@/components/motion-primitives/animated-group'
import { transitionVariants } from '@/lib/utils'

type FeatureCardDef = {
    icon: LucideIcon
    eyebrow: string
    title: string
    description: string
    bullets: string[]
}

const featureCards: FeatureCardDef[] = [
    {
        icon: Layers3Icon,
        eyebrow: 'Unified feed',
        title: 'All sources. One interface.',
        description:
            'Search Kijiji, eBay, and Facebook Marketplace from one interface without jumping between tabs.',
        bullets: ['Source labels stay visible', 'Normalized cards for faster scanning', 'Built for high-volume browsing'],
    },
    {
        icon: SparklesIcon,
        eyebrow: 'Live search',
        title: 'Live data. No stale results',
        description:
            'Run a search and Marketly pulls current results from your selected sources so your view stays relevant.',
        bullets: ['Source toggles per search', 'Fast re-run workflow', 'Designed for repeat checks'],
    },
    {
        icon: BellRingIcon,
        eyebrow: 'Saved workflows',
        title: 'Search once. Monitor forever.',
        description:
            'Keep your best queries ready to re-run so you can check for new listings in seconds.',
        bullets: ['One-click re-runs', 'Cleaner recurring monitoring', 'Less copy-paste friction'],
    },
]

export default function Features() {
    return (
        <section className="relative overflow-hidden py-20 md:py-28">
            <div className="relative mx-auto max-w-6xl px-6">
                <div className="mx-auto max-w-3xl text-center">

                    <TextEffect
                        triggerOnView
                        preset="fade-in-blur"
                        speedSegment={0.3}
                        as="h2"
                        className="mt-4 text-balance text-4xl font-semibold tracking-tight lg:text-5xl"
                    >
                        Move faster than the market.
                    </TextEffect>

                    <p className="mx-auto mt-4 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
                        Marketly is built for fast iteration: search, compare, save the winners, and re-run when the market moves.
                    </p>
                </div>


                <AnimatedGroup
                    triggerOnView
                    variants={{
                        container: {
                            visible: {
                                transition: {
                                    staggerChildren: 0.06,
                                    delayChildren: 0.35,
                                },
                            },
                        },
                        ...transitionVariants,
                    }}
                    className="mt-6 grid items-stretch gap-4 lg:grid-cols-3"
                >
                    {featureCards.map((feature) => (
                        <FeatureCard key={feature.title} feature={feature} />
                    ))}
                </AnimatedGroup>
            </div>
        </section>
    )
}

function FeatureCard({ feature }: { feature: FeatureCardDef }) {
    const Icon = feature.icon

    return (
        <div className="group relative h-full overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/85 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset] sm:p-5">
            <div className="relative flex h-full flex-col">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1">
                    <div className="rounded-md border border-white/10 bg-white/[0.04] p-1.5">
                        <Icon className="size-4 text-zinc-100" />
                    </div>
                    <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-400">{feature.eyebrow}</span>
                </div>

                <h3 className="mt-4 text-xl font-semibold tracking-tight text-white">{feature.title}</h3>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-zinc-400">{feature.description}</p>

                <ul className="mt-5 space-y-2 text-sm text-zinc-300">
                    {feature.bullets.map((bullet) => (
                        <li key={bullet} className="flex items-start gap-2">
                            <span className="mt-1 size-1.5 rounded-full bg-zinc-500" />
                            <span>{bullet}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    )
}
