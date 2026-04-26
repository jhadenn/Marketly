import Image from 'next/image'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { InfiniteSlider } from '@/components/ui/infinite-slider'
import { TextEffect } from "@/components/motion-primitives/text-effect";
import { AnimatedGroup } from "@/components/motion-primitives/animated-group";
import DecryptedText from "@/components/DecryptedText";
import { transitionVariants } from "@/lib/utils";

export default function HeroSection() {
    return (
        <main className="overflow-x-hidden">
            <section className="min-h-[58svh] lg:min-h-[68svh]">
                <div
                    className="pb-4 pt-12 md:pb-6 lg:pb-8 lg:pt-40">
                    <div className="relative mx-auto flex max-full flex-col px-6 lg:block">
                        <div className="mx-auto w-full text-center">
                            <div className="mb-4 flex justify-center lg:mb-6">
                                <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/60 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-300 backdrop-blur-sm">
                                    <span className="relative flex size-1.5">
                                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                                        <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
                                    </span>
                                    Live · scanning marketplaces
                                </span>
                            </div>
                             <div className='relative mt-8 inline-block lg:mt-12'>
                                <span aria-hidden className="pointer-events-none absolute -left-2 -top-2 size-2 border-l border-t border-white/30" />
                                <span aria-hidden className="pointer-events-none absolute -right-2 -top-2 size-2 border-r border-t border-white/30" />
                                <span aria-hidden className="pointer-events-none absolute -bottom-2 -left-2 size-2 border-b border-l border-white/30" />
                                <span aria-hidden className="pointer-events-none absolute -bottom-2 -right-2 size-2 border-b border-r border-white/30" />
                                <DecryptedText
                                    text="The fastest way to search the entire market."
                                    animateOn="view"
                                    revealDirection="start"
                                    sequential
                                    useOriginalCharsOnly={false}
                                    speed={70}
                                    className='font-mono text-muted-foreground bg-black rounded-md uppercase'
                                />
                            </div>
                            <TextEffect
                                preset="fade-in-blur"
                                speedSegment={0.3}
                                as="h1"
                                className="mx-auto max-w-4xl text-balance text-6xl font-semibold sm:text-7xl md:text-8xl xl:text-9xl">
                                All Marketplaces.
                            </TextEffect>
                            <TextEffect
                                preset="fade-in-blur"
                                speedSegment={0.3}
                                as="h1"
                                className="mx-auto max-w-4xl text-balance text-6xl font-semibold sm:text-7xl md:text-8xl xl:text-9xl">
                                One Search.
                            </TextEffect>
                            <TextEffect
                                per="line"
                                preset="fade-in-blur"
                                speedSegment={0.3}
                                delay={0.5}
                                as="p"
                                className="mx-auto mt-10 max-w-3xl text-pretty text-xl leading-relaxed text-muted-foreground bg-black p-3 rounded-md sm:text-2xl">
                                Search across Kijiji, eBay, and Facebook Marketplace - all in one place.
                                Compare listings instantly.
                            </TextEffect>
                            <AnimatedGroup
                                variants={{
                                    container: {
                                        visible: {
                                            transition: {
                                                staggerChildren: 0.05,
                                                delayChildren: 0.75,
                                            },
                                        },
                                    },
                                    ...transitionVariants,
                                }}
                                className="mt-14 flex flex-col items-center justify-center gap-2 sm:flex-row lg:justify-center"
                            >
                                <Button
                                    asChild
                                    size="lg"
                                    className="h-12 px-8 text-lg">
                                    <Link href="/search">
                                        <span className="text-nowrap">Start Searching</span>
                                    </Link>
                                </Button>

                            </AnimatedGroup>
                            <AnimatedGroup
                                variants={{
                                    container: {
                                        visible: {
                                            transition: {
                                                staggerChildren: 0.08,
                                                delayChildren: 1.0,
                                            },
                                        },
                                    },
                                    ...transitionVariants,
                                }}
                                className="mx-auto mt-10 grid max-w-2xl grid-cols-3 gap-px overflow-hidden rounded-md border border-white/10 bg-white/5 font-mono text-zinc-300"
                            >
                                <div className="bg-black/70 px-3 py-3 text-center">
                                    <div className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">03</div>
                                    <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-zinc-500">Marketplaces</div>
                                </div>
                                <div className="bg-black/70 px-3 py-3 text-center">
                                    <div className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">01</div>
                                    <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-zinc-500">Search bar</div>
                                </div>
                                <div className="bg-black/70 px-3 py-3 text-center">
                                    <div className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">∞</div>
                                    <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-zinc-500">Possibilities</div>
                                </div>
                            </AnimatedGroup>
                        </div>
                    </div>
                </div>
            </section>
            <section className="bg-background pt-2 pb-28 md:pt-3 md:pb-44">
                <AnimatedGroup
                    variants={{
                        container: {
                            visible: {
                                transition: {
                                    staggerChildren: 0.05,
                                    delayChildren: 0.75,
                                },
                            },
                        },
                        ...transitionVariants,
                    }}
                    className="group relative m-auto max-w-6xl px-6"
                >

                    <div className="flex flex-col items-center md:flex-row">
                        <div className="md:max-w-44 md:border-r md:pr-6">
                            <p className="text-end text-xl font-mono uppercase">Search From</p>
                        </div>
                        <div
                            className="relative py-6 md:w-[calc(100%-11rem)]"
                            style={{
                                maskImage: "linear-gradient(to right, transparent, black 10%, black 90%, transparent)",
                                WebkitMaskImage: "linear-gradient(to right, transparent, black 10%, black 90%, transparent)",
                            }}
                        >
                            <InfiniteSlider
                                speedOnHover={20}
                                speed={40}
                                gap={112}>
                                <div className="flex items-center">
                                    <Image
                                        src="/marketplaces/facebook_logo.svg"
                                        alt="Facebook Marketplace"
                                        width={190}
                                        height={36}
                                        className="h-9 w-auto opacity-90"
                                    />
                                </div>
                                <div className="flex items-center">
                                    <Image
                                        src="/marketplaces/EBay_logo.svg"
                                        alt="eBay"
                                        width={150}
                                        height={44}
                                        className="h-11 w-auto opacity-90"
                                    />
                                </div>
                                <div className="flex items-center">
                                    <Image
                                        src="/marketplaces/kijiji_logo.svg"
                                        alt="Kijiji"
                                        width={360}
                                        height={120}
                                        className="h-16 w-auto opacity-100"
                                    />
                                </div>
                            </InfiniteSlider>
                        </div>
                    </div>

                    <div className="mt-10 overflow-hidden rounded-lg border border-white/10 bg-black/50 backdrop-blur-sm">
                        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                            <span className="inline-flex items-center gap-2">
                                <span className="relative flex size-1.5">
                                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                                    <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
                                </span>
                                Recent finds · sample feed
                            </span>
                            <span className="hidden sm:inline">market_stream :: 24h</span>
                        </div>
                        <div
                            className="relative py-3"
                            style={{
                                maskImage: "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
                                WebkitMaskImage: "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
                            }}
                        >
                            <InfiniteSlider speed={28} speedOnHover={10} gap={32}>
                                {[
                                    { source: "Kijiji", title: "1998 BMW M3 coupe · 142k km", price: "$18,400", tag: "underpriced" },
                                    { source: "Facebook", title: "Specialized Allez Sport, 56cm", price: "$1,250", tag: "fair" },
                                    { source: "eBay", title: "iPhone 15 Pro 256GB · unlocked", price: "$1,099", tag: "watch" },
                                    { source: "Kijiji", title: "Yamaha P-125 digital piano", price: "$625", tag: "fair" },
                                    { source: "Facebook", title: "KitchenAid Artisan stand mixer", price: "$375", tag: "underpriced" },
                                    { source: "eBay", title: "DJI Mavic 3 Pro · fly more", price: "$2,650", tag: "fair" },
                                    { source: "Kijiji", title: "Mid-century walnut credenza", price: "$880", tag: "watch" },
                                    { source: "Facebook", title: "Herman Miller Aeron, size B", price: "$540", tag: "underpriced" },
                                    { source: "eBay", title: "Sony A7 IV body · 4k shutter", price: "$2,150", tag: "fair" },
                                ].map((entry, idx) => (
                                    <div
                                        key={`${entry.source}-${idx}`}
                                        className="flex items-center gap-3 whitespace-nowrap font-mono text-[12px] text-zinc-300"
                                    >
                                        <span className="rounded-sm border border-white/15 bg-white/[0.04] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em] text-zinc-400">
                                            {entry.source}
                                        </span>
                                        <span className="text-zinc-200">{entry.title}</span>
                                        <span className="text-emerald-300/90">{entry.price}</span>
                                        <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">· {entry.tag}</span>
                                        <span className="text-zinc-700">|</span>
                                    </div>
                                ))}
                            </InfiniteSlider>
                        </div>
                    </div>
                </AnimatedGroup>
            </section>
        </main>
    )
}
