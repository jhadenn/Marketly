'use client'
import Link from 'next/link'
import {ChevronDown, LogOut, Menu, X} from 'lucide-react'
import {Button} from '@/components/ui/button'
import React from 'react'
import V0Icon from "@/components/icons/v0-icon";
import {useAuth} from '@/app/providers'

export const HeroHeader = () => {
    const [menuState, setMenuState] = React.useState(false)
    const {user, loading, signOut} = useAuth()
    return (
        <header>
            <nav
                data-state={menuState && 'active'}
                className="bg-background/50 fixed z-20 w-full border-b backdrop-blur-3xl">
                <div className="mx-auto max-w-6xl px-6 transition-all duration-300">
                    <div className="relative flex flex-wrap items-center justify-between gap-6 py-3 lg:gap-0 lg:py-4">
                        <div className="flex w-full items-center justify-between gap-12 lg:w-auto">
                            <Link
                                href="/"
                                aria-label="home"
                                className="flex items-center space-x-2">
                                <span className='font-mono'>Marketly</span>
                            </Link>

                            <button
                                onClick={() => setMenuState(!menuState)}
                                aria-label={menuState ? 'Close Menu' : 'Open Menu'}
                                className="relative z-20 -m-2.5 -mr-4 block cursor-pointer p-2.5 lg:hidden">
                                <Menu
                                    className="in-data-[state=active]:rotate-180 in-data-[state=active]:scale-0 in-data-[state=active]:opacity-0 m-auto size-6 duration-200"/>
                                <X className="in-data-[state=active]:rotate-0 in-data-[state=active]:scale-100 in-data-[state=active]:opacity-100 absolute inset-0 m-auto size-6 -rotate-180 scale-0 opacity-0 duration-200"/>
                            </button>
                        </div>

                        <div
                            className="bg-background in-data-[state=active]:block lg:in-data-[state=active]:flex mb-6 hidden w-full flex-wrap items-center justify-end space-y-8 rounded-3xl border p-6 shadow-2xl shadow-zinc-300/20 md:flex-nowrap lg:m-0 lg:flex lg:w-fit lg:gap-6 lg:space-y-0 lg:border-transparent lg:bg-transparent lg:p-0 lg:shadow-none dark:shadow-none dark:lg:bg-transparent">
                            <div className="flex w-full flex-col space-y-3 sm:flex-row sm:gap-3 sm:space-y-0 md:w-fit">
                                {loading ? (
                                    <span className="inline-flex items-center rounded-md border px-3 py-2 text-xs text-muted-foreground">
                                        Loading auth...
                                    </span>
                                ) : user ? (
                                    <details className="relative w-full sm:w-auto">
                                        <summary className="flex w-full cursor-pointer list-none items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs transition hover:bg-muted/40 sm:justify-start [&::-webkit-details-marker]:hidden">
                                            <span className="hidden max-w-[220px] truncate sm:inline">
                                                {user.email ?? 'Signed in'}
                                            </span>
                                            <span className="sm:hidden">Account</span>
                                            <ChevronDown className="size-3.5 text-muted-foreground" />
                                        </summary>
                                        <div className="mt-2 w-full overflow-hidden rounded-xl border bg-background/95 p-1 shadow-xl backdrop-blur-xl sm:absolute sm:right-0 sm:z-50 sm:w-56">
                                            <Link
                                                href="/facebook-configuration"
                                                className="block rounded-lg px-3 py-2 text-sm transition hover:bg-muted/40"
                                                onClick={() => setMenuState(false)}
                                            >
                                                Facebook configuration
                                            </Link>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setMenuState(false)
                                                    void signOut()
                                                }}
                                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-muted/40"
                                            >
                                                <LogOut className="size-4 text-muted-foreground" />
                                                Logout
                                            </button>
                                        </div>
                                    </details>
                                ) : (
                                    <Button
                                        asChild
                                        size="sm">
                                        <Link href="/login">
                                            <span>Login</span>
                                        </Link>
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </nav>
        </header>
    )
}
