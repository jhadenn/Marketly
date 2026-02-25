import Image from 'next/image'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { InfiniteSlider } from '@/components/ui/infinite-slider'
import { ProgressiveBlur } from '@/components/ui/progressive-blur'
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
                             <div className='mt-8 lg:mt-16'>
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
                                        <span className="text-nowrap">Try It Out</span>
                                    </Link>
                                </Button>
                            
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
                        <div className="relative py-6 md:w-[calc(100%-11rem)]">
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
                            <div
                                className="bg-linear-to-r from-background absolute inset-y-0 left-0 w-20"></div>
                            <div
                                className="bg-linear-to-l from-background absolute inset-y-0 right-0 w-20"></div>
                            <ProgressiveBlur
                                className="pointer-events-none absolute left-0 top-0 h-full w-20"
                                direction="left"
                                blurIntensity={1}
                            />
                            <ProgressiveBlur
                                className="pointer-events-none absolute right-0 top-0 h-full w-20"
                                direction="right"
                                blurIntensity={1}
                            />
                        </div>
                    </div>
                </AnimatedGroup>
            </section>
        </main>
    )
}
