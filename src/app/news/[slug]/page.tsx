import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import { PublicStoryView } from "@/components/news/public/PublicNews";
import { publicStory, SITE } from "@/lib/news/public";
import { idFromSlug } from "@/lib/news/slug";

type Params = { params: Promise<{ slug: string }> };

/** One read per request, shared by the metadata and the page. Public data only: no user is passed in. */
const load = cache(async (slug: string) => {
  const id = idFromSlug(slug);
  return id ? publicStory(id) : null;
});

const describe = (s: NonNullable<Awaited<ReturnType<typeof publicStory>>>) =>
  (s.summary?.bullets?.[0] ?? s.summary?.why ?? `${s.categoryLabel} news from ${s.sources.slice(0, 3).map((x) => x.name).join(", ")}.`).slice(0, 200);

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const s = await load((await params).slug);
  if (!s) return { title: "Story not found", robots: { index: false } };
  const url = `${SITE}/news/${s.slug}`;
  const description = describe(s);
  return {
    title: s.headline,
    description,
    alternates: { canonical: url },
    keywords: [...s.tickers, ...s.names, s.categoryLabel].slice(0, 10),
    openGraph: { type: "article", url, title: s.headline, description, siteName: "YouBank Newsroom", publishedTime: s.firstSeenAt, modifiedTime: s.updatedAt, section: s.categoryLabel, tags: s.tickers },
    twitter: { card: "summary_large_image", title: s.headline, description },
    robots: { index: true, follow: true },
  };
}

/**
 * A public story page, for anyone (no sign-in): the headline, our summary and figures, the chart,
 * timeline and relationship map, and every source linked to its publisher, ending in an invitation to
 * read it in YouBank. The address carries the headline's words; an old address redirects to the
 * current one.
 */
export default async function PublicStoryPage({ params }: Params) {
  const { slug } = await params;
  const s = await load(slug);
  if (!s) notFound();
  if (slug !== s.slug) permanentRedirect(`/news/${s.slug}`);
  const url = `${SITE}/news/${s.slug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: s.headline.slice(0, 110),
    description: describe(s),
    datePublished: s.firstSeenAt,
    dateModified: s.updatedAt,
    articleSection: s.categoryLabel,
    mainEntityOfPage: url,
    image: [`${url}/opengraph-image`],
    publisher: { "@type": "Organization", name: "YouBank", url: SITE },
    author: { "@type": "Organization", name: "YouBank Newsroom", url: `${SITE}/news` },
    isBasedOn: s.sources.slice(0, 8).map((x) => x.url),
    about: s.names.map((n) => ({ "@type": "Organization", name: n })),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      {/* eslint-disable-next-line react-hooks/purity -- a server render's clock, passed down so the client renders the same relative times */}
      <PublicStoryView s={s} url={url} now={Date.now()} />
    </>
  );
}
