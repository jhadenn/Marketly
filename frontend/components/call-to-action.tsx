import Link from 'next/link'
import { ArrowRightIcon, SparklesIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TextEffect } from './motion-primitives/text-effect'
import { AnimatedGroup } from '@/components/motion-primitives/animated-group'
import { transitionVariants } from '@/lib/utils'

const ctaPills = ['Search across marketplaces', 'Save repeat searches', 'Built for deal hunters']

export default function CallToAction() {
    return (
        <section className="relative px-2 py-20 md:py-24">
            <div className="relative mx-auto max-w-6xl overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/85 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset] md:p-10 lg:p-12">

                <div className="relative">
                    <div className="mx-auto max-w-3xl text-center">
                        <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-300">
                            <SparklesIcon className="size-3.5 text-zinc-400" />
                            Ready to launch your search workflow
                        </p>

                        <TextEffect
                            triggerOnView
                            preset="fade-in-blur"
                            speedSegment={0.3}
                            as="h2"
                            className="mt-4 text-balance text-4xl font-semibold tracking-tight lg:text-5xl"
                        >
                            Search the entire market without the tab chaos.
                        </TextEffect>

                        <TextEffect
                            triggerOnView
                            preset="fade-in-blur"
                            speedSegment={0.3}
                            delay={0.001}
                            as="p"
                            className="mx-auto mt-4 max-w-2xl text-pretty text-sm leading-relaxed text-zinc-400 sm:text-base"
                        >
                            Start with a live search, then create an account when you want saved workflows and faster repeat checks.
                        </TextEffect>
                    </div>

                    <AnimatedGroup
                        triggerOnView
                        variants={{
                            container: {
                                visible: {
                                    transition: {
                                        staggerChildren: 0.05,
                                        delayChildren: 0.35,
                                    },
                                },
                            },
                            ...transitionVariants,
                        }}
                        className="mx-auto mt-6 flex max-w-3xl flex-wrap justify-center gap-2"
                    >
                        {ctaPills.map((pill) => (
                            <div
                                key={pill}
                                className="rounded-full border border-white/10 bg-white/[0.02] px-3 py-1.5 text-xs text-zinc-300"
                            >
                                {pill}
                            </div>
                        ))}
                    </AnimatedGroup>

                    <AnimatedGroup
                        triggerOnView
                        variants={{
                            container: {
                                visible: {
                                    transition: {
                                        staggerChildren: 0.05,
                                        delayChildren: 0.5,
                                    },
                                },
                            },
                            ...transitionVariants,
                        }}
                        className="mt-10 flex flex-wrap justify-center gap-3"
                    >
                        <Button asChild size="lg" className="h-11 rounded-xl px-6">
                            <Link href="/search">
                                <span>Start searching</span>
                                <ArrowRightIcon className="size-4" />
                            </Link>
                        </Button>

                        <Button
                            asChild
                            size="lg"
                            variant="outline"
                            className="h-11 rounded-xl border-white/10 bg-white/[0.02] text-white hover:bg-white/[0.05] hover:text-white"
                        >
                            <Link href="/login">
                                <span>Create account</span>
                            </Link>
                        </Button>
                    </AnimatedGroup>
                </div>
            </div>
        </section>
    )
}
