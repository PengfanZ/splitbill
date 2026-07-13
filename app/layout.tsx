import type { Metadata } from 'next'
import '../src/styles.css'

export const metadata: Metadata = {
  title: 'Tally — Split shared expenses',
  description: 'Create an activity, add friends, and see exactly who owes whom.',
  icons: { icon: '/favicon.svg', shortcut: '/favicon.svg' },
  openGraph: {
    title: 'Tally — Split shared expenses',
    description: 'Create an activity, add friends, and see exactly who owes whom.',
    images: [{ url: '/og.png', width: 1662, height: 946, alt: 'Friends splitting shared expenses with Tally' }],
  },
  twitter: { card: 'summary_large_image', images: ['/og.png'] },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
